import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { contentbaseHome, contentbaseHomeNodeModules } from './paths.js'

export interface PackageManagerAvailability {
	bun: boolean
	npm: boolean
}

/**
 * Pick the install command for adding a package to the shared `~/.luca`
 * node_modules. The compiled luca binary cannot act as a package manager
 * itself, so one must be present on the PATH — bun preferred, npm fallback.
 *
 * Returns null when no supported package manager is available.
 */
export function selectInstallCommand(pkgSpec: string, available: PackageManagerAvailability): string | null {
	if (available.bun) return `bun add --optional ${pkgSpec}`
	if (available.npm) return `npm install --save-optional ${pkgSpec}`
	return null
}

/** Detect which supported package managers are on the PATH. */
export async function detectPackageManagers(): Promise<PackageManagerAvailability> {
	const { execSync } = await import('node:child_process')
	const has = (bin: string) => {
		try {
			execSync(process.platform === 'win32' ? `where ${bin}` : `command -v ${bin}`, { stdio: 'pipe' })
			return true
		} catch {
			return false
		}
	}
	return { bun: has('bun'), npm: has('npm') }
}

/** Ensure `~/.luca` exists and holds a minimal package.json manifest. */
export async function ensureHomeManifest(home: string = contentbaseHome()): Promise<string> {
	const { mkdir, writeFile } = await import('node:fs/promises')
	await mkdir(home, { recursive: true })
	const manifestPath = join(home, 'package.json')
	if (!existsSync(manifestPath)) {
		const manifest = {
			name: 'contentbase-home',
			private: true,
			description: 'Per-machine contentbase dependencies (native addons that cannot be compiled into the cnotes binary)',
		}
		await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
	}
	return manifestPath
}

/** Absolute path where a shared native module would live, e.g. `~/.luca/node_modules/node-llama-cpp`. */
export function sharedModulePath(moduleName: string, home: string = contentbaseHome()): string {
	return join(home, 'node_modules', moduleName)
}

/**
 * True when the shared module appears installed and usable.
 *
 * In dev (plain bun) this verifies via a real import. In the compiled luca binary
 * a native import() can't reach ~/.luca/node_modules at all (the $bunfs resolver
 * limitation this whole subsystem exists for), so a successful-import can't be the
 * signal — we fall back to an on-disk presence check. This is a status probe, so
 * it stays side-effect-free (no process spawn); the deep load-verify runs at
 * install time in installSharedModule.
 */
export async function sharedModuleLoads(moduleName: string, home: string = contentbaseHome()): Promise<boolean> {
	const modulePath = sharedModulePath(moduleName, home)
	if (!existsSync(modulePath)) return false
	try {
		await import(modulePath)
		return true
	} catch {
		const inCompiledBinary = import.meta.url.includes('$bunfs') || import.meta.url.includes('~BUN')
		// Native import always fails in the compiled binary — trust on-disk presence there.
		return inCompiledBinary && existsSync(join(modulePath, 'package.json'))
	}
}

/**
 * Install a package into the per-machine `~/.luca/node_modules` and verify
 * the module loads afterwards. Throws with actionable guidance on failure.
 */
export async function installSharedModule(pkgSpec: string, home: string = contentbaseHome()): Promise<string> {
	await ensureHomeManifest(home)

	const available = await detectPackageManagers()
	const cmd = selectInstallCommand(pkgSpec, available)
	if (!cmd) {
		throw new Error(
			`Installing ${pkgSpec} requires bun or npm on your PATH — the cnotes binary cannot download native addons itself.\n` +
			'Install bun (https://bun.sh) or Node.js, then retry.'
		)
	}

	const { execSync } = await import('node:child_process')
	try {
		execSync(cmd, { cwd: home, stdio: 'pipe', timeout: 300_000 })
	} catch (err: any) {
		const stderr = err?.stderr?.toString() ?? ''
		throw new Error(
			`Failed to install ${pkgSpec} into ${home} via: ${cmd}\n` +
			(stderr ? `stderr: ${stderr}\n` : '') +
			'If this is an ABI mismatch, ensure your Node/Bun version matches the prebuilt binary.'
		)
	}

	const moduleName = pkgSpec.startsWith('@')
		? pkgSpec.split('@').slice(0, 2).join('@')
		: (pkgSpec.split('@')[0] ?? pkgSpec)
	const modulePath = sharedModulePath(moduleName, home)

	await verifySharedModule(moduleName, modulePath, home, available)
	return modulePath
}

/**
 * Confirm an installed shared module can actually load.
 *
 * The compiled luca binary's module resolver is rooted at $bunfs and can't reach
 * ~/.luca/node_modules, so a native `import()` here would always false-fail. When
 * bun is available we verify in a real `bun -e` process (the same runtime that
 * will host it at use time); otherwise we fall back to an on-disk sanity check and
 * let the actual consumer surface any load error.
 */
async function verifySharedModule(
	moduleName: string,
	modulePath: string,
	home: string,
	available: PackageManagerAvailability,
): Promise<void> {
	if (!existsSync(modulePath)) {
		throw new Error(`${moduleName} was installed but is not present at ${modulePath}.`)
	}

	const inCompiledBinary = import.meta.url.includes('$bunfs') || import.meta.url.includes('~BUN')

	// Preferred: load it in a real bun process (works in dev and compiled binary alike)
	if (available.bun) {
		const { execSync } = await import('node:child_process')
		try {
			execSync(`bun -e ${JSON.stringify(`await import(${JSON.stringify(moduleName)})`)}`, {
				cwd: home,
				stdio: 'pipe',
				timeout: 60_000,
			})
			return
		} catch (err: any) {
			throw new Error(
				`${moduleName} was installed but failed to load from ${modulePath}.\n` +
				'This usually means a native addon ABI mismatch.\n' +
				`Error: ${(err?.stderr?.toString() || err?.message || err).toString().split('\n')[0]}`
			)
		}
	}

	// No bun: only native import is available, and that can't work from a compiled
	// binary. In dev, verify natively; in the binary, trust the on-disk check above.
	if (!inCompiledBinary) {
		try {
			await import(modulePath)
		} catch (err: any) {
			throw new Error(
				`${moduleName} was installed but failed to load from ${modulePath}.\n` +
				'This usually means a native addon ABI mismatch.\n' +
				`Error: ${err?.message ?? err}`
			)
		}
	}
}

export { contentbaseHome, contentbaseHomeNodeModules }
