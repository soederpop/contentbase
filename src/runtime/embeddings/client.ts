import net from 'node:net'
import { spawn, execSync } from 'node:child_process'
import { existsSync, openSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { contentbaseHome } from '../setup/paths.js'
import { embeddingWorkerScript } from './generated.js'

/**
 * Client for the resident embedding daemon. The compiled luca binary can't load
 * node-llama-cpp itself (its $bunfs resolver can't reach external node_modules),
 * so local embeddings run in a `bun` worker daemon spawned on demand. The daemon
 * keeps the model resident and is shared by every luca process on the machine via
 * a per-model unix socket. See src/embeddings/worker.ts for the daemon side.
 */

const safe = (model: string) => model.replace(/[^a-z0-9]/gi, '_')

export function daemonSocketPath(model: string, home: string = contentbaseHome()): string {
	return join(home, `embeddings-${safe(model)}.sock`)
}

/** Locate an external `bun` (required to run the worker — the luca binary can't self-host it). */
export function findBun(): string | null {
	if (process.env.CONTENTBASE_BUN && existsSync(process.env.CONTENTBASE_BUN)) return process.env.CONTENTBASE_BUN
	try {
		const cmd = process.platform === 'win32' ? 'where bun' : 'command -v bun'
		const found = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n')[0]
		if (found && existsSync(found)) return found
	} catch { /* not on PATH */ }
	const fallback = join(homedir(), '.bun', 'bin', 'bun')
	return existsSync(fallback) ? fallback : null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One round-trip ping on a throwaway connection — returns the daemon's info or null if not up. */
function pingSocket(sock: string, timeoutMs = 2000): Promise<{ ready: boolean; model?: string; dims?: number } | null> {
	return new Promise((resolve) => {
		const conn = net.connect(sock)
		let buffer = ''
		const finish = (val: any) => { try { conn.destroy() } catch {}; resolve(val) }
		const timer = setTimeout(() => finish(null), timeoutMs)
		conn.once('connect', () => conn.write(JSON.stringify({ id: 'ping', type: 'ping' }) + '\n'))
		conn.on('data', (chunk) => {
			buffer += chunk.toString()
			const nl = buffer.indexOf('\n')
			if (nl >= 0) {
				clearTimeout(timer)
				try { finish(JSON.parse(buffer.slice(0, nl))) } catch { finish(null) }
			}
		})
		conn.once('error', () => { clearTimeout(timer); finish(null) })
	})
}

export interface EnsureDaemonOptions {
	model: string
	modelPath: string
	home?: string
	idleMs?: number
	/** Max time to wait for the model to load and the daemon to answer ping (default 180s). */
	readyTimeoutMs?: number
}

/** Ensure a daemon is serving on the model's socket, spawning one if needed. Returns the socket path. */
export async function ensureDaemon(opts: EnsureDaemonOptions): Promise<string> {
	const home = opts.home ?? contentbaseHome()
	const sock = daemonSocketPath(opts.model, home)

	if (await pingSocket(sock)) return sock

	const bun = findBun()
	if (!bun) {
		throw new Error(
			'Local embeddings run in a bun worker process, but no `bun` was found on your PATH.\n' +
			'Install bun (https://bun.sh) and retry.'
		)
	}

	// Materialize the embedded worker script (overwrite to keep it version-matched to this binary)
	const workerPath = join(home, 'embedding-worker.ts')
	writeFileSync(workerPath, embeddingWorkerScript)

	const logFd = openSync(join(home, `embeddings-${safe(opts.model)}.log`), 'a')
	const child = spawn(
		bun,
		[
			workerPath,
			'--socket', sock,
			'--model', opts.model,
			'--model-path', opts.modelPath,
			'--home', home,
			'--idle-ms', String(opts.idleMs ?? 5 * 60 * 1000),
		],
		{ cwd: home, detached: true, stdio: ['ignore', logFd, logFd] },
	)
	child.unref()

	// Poll until the daemon answers (model load can take several seconds)
	const deadline = Date.now() + (opts.readyTimeoutMs ?? 180_000)
	while (Date.now() < deadline) {
		await sleep(400)
		const info = await pingSocket(sock)
		if (info?.ready) return sock
	}
	throw new Error(
		`Embedding daemon for "${opts.model}" did not become ready in time.\n` +
		`Check the log at ${join(home, `embeddings-${safe(opts.model)}.log`)}`
	)
}

interface Pending { resolve: (v: any) => void; reject: (e: any) => void; timer: ReturnType<typeof setTimeout> }

/** Persistent connection to a daemon with id-matched request/response framing. */
class EmbeddingClient {
	private _conn: net.Socket | null = null
	private _buffer = ''
	private _pending = new Map<string, Pending>()
	private _seq = 0

	constructor(private readonly sock: string) {}

	private async _ensureConnected(): Promise<net.Socket> {
		if (this._conn && !this._conn.destroyed) return this._conn
		return new Promise((resolve, reject) => {
			const conn = net.connect(this.sock)
			// Don't let an idle connection keep a short-lived luca process alive — in-flight
			// requests hold the loop open via their (ref'd) timeout timers instead.
			conn.unref()
			conn.once('connect', () => { this._conn = conn; resolve(conn) })
			conn.once('error', reject)
			conn.on('data', (chunk) => this._onData(chunk))
			conn.on('close', () => {
				this._conn = null
				for (const [, p] of this._pending) { clearTimeout(p.timer); p.reject(new Error('embedding daemon connection closed')) }
				this._pending.clear()
			})
		})
	}

	private _onData(chunk: Buffer | string) {
		this._buffer += chunk.toString()
		let nl: number
		while ((nl = this._buffer.indexOf('\n')) >= 0) {
			const line = this._buffer.slice(0, nl).trim()
			this._buffer = this._buffer.slice(nl + 1)
			if (!line) continue
			let msg: any
			try { msg = JSON.parse(line) } catch { continue }
			const p = this._pending.get(msg.id)
			if (!p) continue
			this._pending.delete(msg.id)
			clearTimeout(p.timer)
			if (msg.error) p.reject(new Error(msg.error))
			else p.resolve(msg)
		}
	}

	private async _request(payload: Record<string, any>, timeoutMs = 60_000): Promise<any> {
		const conn = await this._ensureConnected()
		const id = `r${++this._seq}`
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this._pending.delete(id)
				reject(new Error(`embedding request timed out after ${timeoutMs}ms`))
			}, timeoutMs)
			this._pending.set(id, { resolve, reject, timer })
			conn.write(JSON.stringify({ id, ...payload }) + '\n')
		})
	}

	async embed(texts: string[]): Promise<number[][]> {
		const res = await this._request({ type: 'embed', texts })
		return res.embeddings
	}

	dispose() {
		if (this._conn) { try { this._conn.destroy() } catch {}; this._conn = null }
	}
}

const clients = new Map<string, EmbeddingClient>()

/** Embed texts via the resident daemon, spawning it if necessary. */
export async function embedViaDaemon(model: string, modelPath: string, texts: string[], opts?: Partial<EnsureDaemonOptions>): Promise<number[][]> {
	const sock = await ensureDaemon({ model, modelPath, ...opts })
	let client = clients.get(sock)
	if (!client) { client = new EmbeddingClient(sock); clients.set(sock, client) }
	return client.embed(texts)
}

/** Drop cached connections (does not stop the daemon — it idles out on its own). */
export function disposeEmbeddingClients() {
	for (const [, c] of clients) c.dispose()
	clients.clear()
}
