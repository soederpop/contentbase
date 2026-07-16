import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The per-machine contentbase home directory (`~/.contentbase` by default).
 *
 * Holds the shared `node_modules` where native addons that can't be compiled
 * into the cnotes binary get installed once per machine, plus embedding
 * daemon sockets and logs. Override with the `CONTENTBASE_HOME` env variable.
 */
export function contentbaseHome(): string {
  return process.env.CONTENTBASE_HOME || join(homedir(), '.contentbase')
}

/** The shared per-machine node_modules directory under the contentbase home. */
export function contentbaseHomeNodeModules(): string {
  return join(contentbaseHome(), 'node_modules')
}
