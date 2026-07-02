import { z } from 'zod'
import { commands } from '../registry.js'
import { startMcpServer } from '../../mcp/server.js'

const argsSchema = z.object({
  transport: z.enum(['stdio', 'http']).default('stdio'),
  port: z.number().default(3003),
  contentFolder: z.string().optional(),
  modulePath: z.string().optional(),
  mcpCompat: z.enum(['standard', 'codex']).optional(),
  stdioCompat: z.enum(['standard', 'codex', 'auto']).optional(),
  watch: z.boolean().default(true),
})

async function handler(options: z.infer<typeof argsSchema>, context: { container: any }) {
  const container = context.container

  // Resolve content folder: positional arg > --contentFolder > ./docs
  const positionalFolder = container.argv._[1] as string | undefined
  const contentFolder = positionalFolder || options.contentFolder || undefined
  const modulePath = options.modulePath || undefined

  await startMcpServer(container, {
    transport: options.transport,
    port: options.port,
    contentFolder,
    modulePath,
    mcpCompat: options.mcpCompat,
    stdioCompat: options.stdioCompat,
    watch: options.watch,
  })
}

commands.register('mcp', {
  description: 'Start an MCP server for AI agents to query and manage structured markdown content',
  help: `# cnotes mcp

Start an MCP (Model Context Protocol) server that exposes collection tools, resources, and prompts for AI agents. Supports both stdio and HTTP transports.

## Usage

\`\`\`
cnotes mcp [contentFolder] [options]
\`\`\`

## Arguments

| Argument | Description |
|----------|-------------|
| \`contentFolder\` | Path to content folder (positional or via \`--contentFolder\`) |

## Options

| Option | Default | Description |
|--------|---------|-------------|
| \`--transport\` | \`stdio\` | Transport mode: \`stdio\` or \`http\` |
| \`--port\` | \`3003\` | Port for HTTP transport |
| \`--mcpCompat\` | \`standard\` | HTTP compatibility profile: \`standard\` or \`codex\` (or set \`MCP_HTTP_COMPAT\`) |
| \`--stdioCompat\` | \`standard\` | Stdio framing profile: \`standard\`, \`codex\`, or \`auto\` (or set \`MCP_STDIO_COMPAT\`) |
| \`--modulePath\` | | Path to collection entry module |
| \`--contentFolder\` | | Path to content folder |
| \`--disable-watch\` | \`false\` | Disable file watching for automatic collection refresh |

## Exposed Capabilities

**Tools:** read_me, inspect, get_model_info, list_documents, query, search_content, text_search, keyword_search, semantic_search, hybrid_search, validate, create_document, update_document, update_section, delete_document, run_action

**Resources:** schema, table of contents, models summary, primer, per-document resources

**Prompts:** create-<model>, review-document, teach, query-guide

## Examples

\`\`\`bash
# Start with stdio (for Claude Desktop, Cursor, etc.)
cnotes mcp

# Start with HTTP transport
cnotes mcp --transport http --port 3003

# Start with Codex HTTP compatibility mode
cnotes mcp --transport http --port 3003 --mcpCompat codex

# Start with Codex stdio framing mode
cnotes mcp --stdioCompat codex

# Serve a specific content folder
cnotes mcp ./docs

# Use in claude_desktop_config.json
# { "command": "cnotes", "args": ["mcp", "./docs"] }
\`\`\`
`,
  argsSchema,
  handler,
})
