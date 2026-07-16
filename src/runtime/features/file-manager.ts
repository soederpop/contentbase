import { z } from 'zod'
import { Feature } from '../feature.js'
import { FeatureStateSchema, FeatureOptionsSchema } from '../schemas.js'
import { watch, type FSWatcher } from 'node:fs'
import { relative } from 'node:path'

export const FileManagerOptionsSchema = FeatureOptionsSchema.extend({
  rootPath: z.string().optional().describe('The root directory to watch'),
})
export type FileManagerOptions = z.infer<typeof FileManagerOptionsSchema>

/**
 * Recursive file watcher emitting `file:change` events.
 * A minimal port of luca's fileManager — only the watch surface contentbase uses.
 */
export class FileManager extends Feature<any, FileManagerOptions> {
  static override shortcut = 'features.fileManager' as const
  static override stateSchema = FeatureStateSchema
  static override optionsSchema = FileManagerOptionsSchema
  static { Feature.register(this, 'fileManager') }

  private _rootPath?: string
  private _watcher?: FSWatcher

  async start(options: { rootPath?: string } = {}): Promise<this> {
    this._rootPath = options.rootPath || this.options.rootPath || this.container.cwd
    return this
  }

  async watch(): Promise<this> {
    if (this._watcher) return this
    const rootPath = this._rootPath || this.container.cwd

    this._watcher = watch(rootPath, { recursive: true }, (eventType, filename) => {
      if (!filename) return
      const path = String(filename)
      // Absolute path for consumers; fs.watch reports relative to rootPath
      this.emit('file:change', {
        type: eventType,
        path,
        relativePath: relative(rootPath, path) || path,
      })
    })

    return this
  }

  async stop(): Promise<this> {
    if (this._watcher) {
      this._watcher.close()
      this._watcher = undefined
    }
    return this
  }
}

export default FileManager
