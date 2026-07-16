import { Feature } from '../feature.js'
import { FeatureStateSchema, FeatureOptionsSchema } from '../schemas.js'
import colors from 'chalk'
import { marked } from 'marked'
import { markedTerminal } from 'marked-terminal'

/**
 * Terminal UI helpers: chalk colors and markdown rendering.
 * A minimal port of luca's UI feature — only the surface contentbase uses.
 */
export class UI extends Feature {
  static override shortcut = 'features.ui' as const
  static override stateSchema = FeatureStateSchema
  static override optionsSchema = FeatureOptionsSchema
  static { Feature.register(this, 'ui') }

  private _markedConfigured = false

  /** The chalk instance — ui.colors.cyan('text'), ui.colors.dim('text'), etc. */
  get colors(): typeof colors {
    return colors
  }

  /**
   * Parse markdown text and render it for terminal display using marked-terminal.
   */
  markdown(text: string): string {
    if (!this._markedConfigured) {
      marked.use(markedTerminal() as any)
      this._markedConfigured = true
    }
    return marked.parse(text) as string
  }
}

export default UI
