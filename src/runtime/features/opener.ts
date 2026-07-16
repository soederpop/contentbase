import { Feature } from '../feature.js'
import { FeatureStateSchema, FeatureOptionsSchema } from '../schemas.js'
import { spawn } from 'node:child_process'

/**
 * Open URLs and files with the platform's default application.
 * A minimal port of luca's opener feature.
 */
export class Opener extends Feature {
  static override shortcut = 'features.opener' as const
  static override stateSchema = FeatureStateSchema
  static override optionsSchema = FeatureOptionsSchema
  static { Feature.register(this, 'opener') }

  async open(target: string): Promise<void> {
    const platform = process.platform
    const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open'
    const args = platform === 'win32' ? ['/c', 'start', '', target] : [target]

    await new Promise<void>((resolve, reject) => {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
      child.once('error', reject)
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
    })
  }
}

export default Opener
