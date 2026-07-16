// Auto-generated embedding worker script
// Source: src/embeddings/worker.ts
//
// Do not edit manually. Run: luca build-embedding-worker

export const embeddingWorkerScript = `/**
 * Embedding worker daemon — runs under an EXTERNAL \`bun\`, not the compiled luca binary.
 *
 * Why it exists: the compiled luca single-file executable cannot resolve an external
 * node_modules tree (its module resolver is rooted at $bunfs). node-llama-cpp is a
 * platform-specific native addon installed into ~/.luca/node_modules by \`luca setup\`,
 * so it can only be loaded by a plain \`bun\` process. This worker is that process: the
 * luca binary embeds this script (see src/embeddings/generated.ts), materializes it to
 * disk, and spawns \`bun worker.ts\`, then talks to it over a unix socket as a pure client.
 *
 * The model loads once and stays resident, shared by every luca process on the machine.
 *
 * Protocol: newline-delimited JSON, one request/response per line.
 *   → {"id","type":"embed","texts":[...]}   ← {"id","embeddings":[[...]]}
 *   → {"id","type":"ping"}                    ← {"id","ready":true,"model","dims"}
 *   → {"id","type":"shutdown"}                ← {"id","ok":true}  (then exits)
 *
 * This file is SOURCE ONLY — it is never imported by the luca module graph. It is read
 * as text by \`luca build-embedding-worker\` and embedded as a string constant.
 */
import net from 'node:net'
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

interface Args {
	socket: string
	model: string
	modelPath: string
	home: string
	idleMs: number
}

function parseArgs(argv: string[]): Args {
	const get = (flag: string, def = '') => {
		const i = argv.indexOf(flag)
		return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : def
	}
	return {
		socket: get('--socket'),
		model: get('--model'),
		modelPath: get('--model-path'),
		home: get('--home'),
		idleMs: Number(get('--idle-ms', String(5 * 60 * 1000))),
	}
}

const out = (obj: any) => process.stdout.write(JSON.stringify(obj) + '\\n')

/** True if something is actively listening on the socket (vs a stale leftover file). */
function probeSocket(path: string): Promise<boolean> {
	return new Promise((resolve) => {
		const sock = net.connect(path)
		const done = (alive: boolean) => { try { sock.destroy() } catch {}; resolve(alive) }
		sock.once('connect', () => done(true))
		sock.once('error', () => done(false))
	})
}

async function loadLlama(home: string): Promise<any> {
	// Bare specifier resolves from cwd (set to ~/.luca by the spawner); the absolute
	// path is a fallback. Both work under plain bun; neither works under $bunfs.
	const candidates = ['node-llama-cpp', join(home, 'node_modules', 'node-llama-cpp')]
	for (const c of candidates) {
		try {
			const mod = await import(c)
			if (mod?.getLlama) return mod.getLlama
		} catch {
			continue
		}
	}
	throw new Error(\`Could not load node-llama-cpp from \${home}/node_modules — run installLocalEmbeddings() first\`)
}

async function main() {
	const args = parseArgs(process.argv.slice(2))
	if (!args.socket || !args.modelPath) {
		out({ event: 'error', error: 'missing --socket or --model-path' })
		process.exit(2)
	}

	let context: any
	let dimensions = 0
	try {
		const getLlama = await loadLlama(args.home)
		const llama = await getLlama()
		const model = await llama.loadModel({ modelPath: args.modelPath })
		context = await model.createEmbeddingContext({ contextSize: 2048 })
		// Probe dimensionality once so ping can report it
		const probe = await context.getEmbeddingFor('probe')
		dimensions = probe.vector.length
	} catch (err: any) {
		out({ event: 'error', error: err?.message ?? String(err) })
		process.exit(1)
	}

	async function embedOne(text: string): Promise<number[]> {
		try {
			const e = await context.getEmbeddingFor(text)
			return Array.from(new Float32Array(e.vector))
		} catch {
			// Retry with a word-truncated version before giving up on a zero vector
			const truncated = text.split(/\\s+/).slice(0, 300).join(' ')
			try {
				const e = await context.getEmbeddingFor(truncated)
				return Array.from(new Float32Array(e.vector))
			} catch {
				return new Array(dimensions).fill(0)
			}
		}
	}

	let idleTimer: ReturnType<typeof setTimeout> | null = null
	let activeConnections = 0
	const cleanupAndExit = (code = 0) => {
		try { server.close() } catch {}
		try { if (existsSync(args.socket)) unlinkSync(args.socket) } catch {}
		process.exit(code)
	}
	const resetIdle = () => {
		if (idleTimer) clearTimeout(idleTimer)
		if (args.idleMs <= 0) return
		idleTimer = setTimeout(() => {
			if (activeConnections === 0) cleanupAndExit(0)
			else resetIdle()
		}, args.idleMs)
	}

	const server = net.createServer((sock) => {
		activeConnections++
		let buffer = ''
		sock.on('data', async (chunk) => {
			buffer += chunk.toString()
			let nl: number
			while ((nl = buffer.indexOf('\\n')) >= 0) {
				const line = buffer.slice(0, nl).trim()
				buffer = buffer.slice(nl + 1)
				if (!line) continue
				resetIdle()
				let req: any
				try { req = JSON.parse(line) } catch { continue }
				try {
					if (req.type === 'ping') {
						sock.write(JSON.stringify({ id: req.id, ready: true, model: args.model, dims: dimensions }) + '\\n')
					} else if (req.type === 'shutdown') {
						sock.write(JSON.stringify({ id: req.id, ok: true }) + '\\n')
						cleanupAndExit(0)
					} else if (req.type === 'embed') {
						const texts: string[] = Array.isArray(req.texts) ? req.texts : []
						const embeddings: number[][] = []
						for (const t of texts) embeddings.push(await embedOne(String(t)))
						sock.write(JSON.stringify({ id: req.id, embeddings }) + '\\n')
					} else {
						sock.write(JSON.stringify({ id: req.id, error: \`unknown type: \${req.type}\` }) + '\\n')
					}
				} catch (err: any) {
					sock.write(JSON.stringify({ id: req.id, error: err?.message ?? String(err) }) + '\\n')
				}
			}
		})
		sock.on('close', () => { activeConnections--; resetIdle() })
		sock.on('error', () => { /* client vanished — ignore */ })
	})

	server.on('error', (err: any) => {
		// Another daemon won the bind race — exit quietly and let the client use the winner
		if (err?.code === 'EADDRINUSE') { out({ event: 'exists', socket: args.socket }); process.exit(0) }
		out({ event: 'error', error: err?.message ?? String(err) })
		cleanupAndExit(1)
	})

	// Before binding: if a live daemon already owns the socket, defer to it; only
	// remove the file if it's a stale leftover from a crashed daemon.
	if (existsSync(args.socket)) {
		if (await probeSocket(args.socket)) { out({ event: 'exists', socket: args.socket }); process.exit(0) }
		try { unlinkSync(args.socket) } catch {}
	}

	server.listen(args.socket, () => {
		out({ event: 'ready', model: args.model, dims: dimensions, socket: args.socket })
		resetIdle()
	})

	for (const sig of ['SIGINT', 'SIGTERM'] as const) {
		process.on(sig, () => cleanupAndExit(0))
	}
}

main().catch((err) => {
	out({ event: 'error', error: err?.message ?? String(err) })
	process.exit(1)
})
`
