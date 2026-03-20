/**
 * Static imports of all built-in endpoint modules.
 * This allows endpoints to be bundled into a compiled bun binary
 * instead of relying on runtime filesystem scanning.
 */
import * as actions from './actions.js'
import * as doc from './doc.js'
import * as docsIndex from './docs-index.js'
import * as document from './document.js'
import * as documents from './documents.js'
import * as inspect from './inspect.js'
import * as models from './models.js'
import * as query from './query.js'
import * as root from './root.js'
import * as searchReindex from './search-reindex.js'
import * as searchStatus from './search-status.js'
import * as search from './search.js'
import * as semanticSearch from './semantic-search.js'
import * as textSearch from './text-search.js'
import * as validate from './validate.js'

export const builtinEndpoints = [
  actions,
  doc,
  docsIndex,
  document,
  documents,
  inspect,
  models,
  query,
  root,
  searchReindex,
  searchStatus,
  search,
  semanticSearch,
  textSearch,
  validate,
]
