# WOL MCP Server

An MCP server that gives LLMs read-only access to the [Watchtower Online Library (WOL)](https://wol.jw.org/pt/wol/h/r5/lp-t).

## Features

- Advanced search with operators
- Document retrieval (always Markdown)
- Browse publication types
- Multilingual support (dynamic WOL language config)
- Robust error handling and retry logic

## Installation

```bash
# Clone and install dependencies
git clone https://github.com/LeomaiaJr/wol-mcp-server.git
cd wol-mcp
npm install

# Build the server
npm run build
```

## Available Tools

### wol_search

Search the Watchtower Online Library with operators and pagination.

Parameters:

- query (string, required)
- useOperators (boolean, default: true)
- scope ("sen" | "par" | "art", default: "par")
- publications (array; see list below)
- language (string, default: "en")
- sort ("occ" | "newest" | "oldest", default: "occ")
- page (integer, default: 1)
- limit (integer, 1-100, default: 10) — applies only to document results

Search operators:

- & or + (AND), | or / (OR), ! (NOT), && or ++ (adjacent), "..." (phrase), \* (wildcard), ? (single char), (...) (group)

### wol_get_document

Retrieve full content of a specific document (always Markdown).

Parameters:

- url (string, required) — full WOL document URL

Output includes: title, publication, URL, optional date/volume/issue, subheadings, similar materials, followed by the article content. Bible citation links (/wol/bc) are inlined as plain text.

### wol_browse_publications

Browse available publications by type.

Parameters:

- type (string) — optional filter
- language (string, default: "en")
- year (integer) — optional year filter

Publication types (common):
`w`, `g`, `bk`, `bi`, `it`, `dx`, `yb`, `syr`, `sgbk`, `mwb`, `km`, `brch`, `bklt`, `es`, `trct`, `kn`, `pgm`, `ca-copgm`, `ca-brpgm`, `co-pgm`, `manual`, `gloss`, `web`

## Available Resources

### wol://publications

Lists all available publication types with descriptions.

### wol://operators

Details on search operators and examples.

### wol://languages

Supported languages for multilingual access.

## Development (Cloudflare Workers)

```bash
# Install dependencies
npm install

# Run locally (wrangler dev)
npm start
# Local MCP endpoint: http://localhost:8787/sse

# Optional: open MCP Inspector in another terminal and connect to the local endpoint
npx @modelcontextprotocol/inspector@latest

# Type check
npm run type-check

# Deploy to Cloudflare
npx wrangler deploy
```

## Deploy to Cloudflare Workers (Remote MCP)

Cloudflare Workers let you run a remote MCP server reachable over HTTP/SSE. This repo’s server currently starts via `stdio` (subprocess) using `StdioServerTransport`. To expose it remotely, deploy a Workers-based MCP server that implements the HTTP/SSE transport and wires the same tools. Below are two practical paths.

### Option A — Quick deploy (authless template)

1) Create a new Workers project from Cloudflare’s authless remote MCP template:

```bash
npm create cloudflare@latest -- wol-mcp-worker --template=cloudflare/ai/demos/remote-mcp-authless
cd wol-mcp-worker
```

2) Develop locally:

```bash
npm start
# Server runs at http://localhost:8787/sse
```

3) Deploy (Wrangler is already authenticated on your machine):

```bash
npx wrangler@latest deploy
```

4) Connect using the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector@latest
open http://localhost:5173
# Enter your server URL, e.g. http://localhost:8787/sse or https://<worker>.<account>.workers.dev/sse
```

5) Use with a local proxy:

```json
{
  "mcpServers": {
    "wol-remote": {
      "command": "npx",
      "args": ["mcp-remote", "https://<worker>.<account>.workers.dev/sse"]
    }
  }
}
```

### Option B — Add authentication (OAuth)

Start from Cloudflare’s GitHub OAuth example and deploy:

```bash
npm create cloudflare@latest -- wol-mcp-github-auth --template=cloudflare/ai/demos/remote-mcp-github-oauth
cd wol-mcp-github-auth
npx wrangler@latest deploy
```

Follow the guide to register OAuth apps and set secrets (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`). See: Cloudflare “Build a Remote MCP server” guide.

### Porting this server’s tools

- This repo is `stdio`-only. Workers cannot run `stdio` subprocesses, so you do not deploy `dist/index.js` directly.
- Reuse logic by moving the WOL tool handlers (e.g., `WOLService`) into the Workers project and registering equivalent tools there.
- Cloudflare Workers support the MCP HTTP/SSE transport out of the box in their templates. Implement tools that call the same methods you see in this repo’s `wol_search`, `wol_get_document`, and `wol_browse_publications` handlers.

Notes:

- Spec reference: MCP transports (stdio and Streamable HTTP). Workers templates expose an `/sse` endpoint compatible with MCP clients.
- For clients that don’t yet support remote MCP natively, use `mcp-remote` as shown above.

## Configuration

### Environment Variables

- `NODE_ENV` - Environment (development/production)
- `LOG_LEVEL` - Logging level (error/warn/info/debug)

### Service Availability

Currently, no server-side rate limiting is enforced. Upstream availability from WOL may occasionally result in temporary outages (e.g., 502/503), which are surfaced as `SERVICE_UNAVAILABLE` errors.

## Examples

### Basic Search

```
Query: "Jesus Christ"
Result: Exact phrase search across all publications
```

### Advanced Search with Operators

```
Query: (Jesus | Christ) & Jehovah & !Trinity
Result: Documents containing (Jesus OR Christ) AND Jehovah but NOT Trinity
```

### Publication-Specific Search

```
Query: prayer
Publications: ["w", "g"]  // Watchtower and Awake! only
Result: Prayer-related articles from these magazines
```

### Multilingual Search

```
Query: "reino de Dios"
Language: "es"
Result: Spanish content about God's Kingdom
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Make changes and add tests
4. Commit: `git commit -am 'Add new feature'`
5. Push: `git push origin feature/new-feature`
6. Submit a Pull Request

## License

MIT License - see LICENSE file for details.

## Disclaimer

This is an unofficial MCP server for accessing the Watchtower Online Library. It is not affiliated with or endorsed by Jehovah's Witnesses or the Watchtower Bible and Tract Society.
