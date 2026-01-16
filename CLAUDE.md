# WOL MCP Server

## Project Overview

WOL MCP Server is a Model Context Protocol (MCP) server that provides LLMs with read-only access to the **Watchtower Online Library (WOL)** at https://wol.jw.org. It enables AI models to search, retrieve, and browse Jehovah's Witnesses religious publications.

**Repository:** https://github.com/LeomaiaJr/wol-mcp-server

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js / Cloudflare Workers
- **Key Dependencies:**
  - `@modelcontextprotocol/sdk` - Official MCP SDK
  - `agents` - MCP agent framework
  - `cheerio` - HTML parsing
  - `zod` - Runtime type validation
- **Development Tools:**
  - `wrangler` - Cloudflare Workers CLI
  - `@biomejs/biome` - Code formatter/linter
  - `tsx` - TypeScript execution

## Directory Structure

```
wol-mcp/
├── src/
│   ├── index.ts              # Main MCP server entry point
│   └── wol/
│       ├── wolService.ts     # Core WOL service logic
│       ├── videoService.ts   # Video subtitle extraction service
│       ├── types.ts          # TypeScript interfaces & Zod schemas
│       ├── utils.ts          # URL builders, parsers, utilities
│       └── wol_languages.json # Language-to-locale mapping (100+ languages)
├── scripts/
│   ├── runTool.ts            # CLI script for document retrieval
│   └── testSubtitles.ts      # CLI script for subtitle testing
├── biome.json                # Biome formatter/linter config
├── wrangler.jsonc            # Cloudflare Workers configuration
├── tsconfig.json             # TypeScript configuration
└── package.json              # Dependencies and scripts
```

## Key Files

### `src/index.ts`
Main MCP server entry point. Exports `MyMCP` class extending `McpAgent` with four tools:
- `wol_search` - Advanced search with operators
- `wol_get_document` - Retrieve full document content
- `wol_browse_publications` - Browse publication types
- `wol_get_video_subtitles` - Extract video subtitles/transcripts

Routes: `/sse`, `/sse/message`, `/mcp`

### `src/wol/wolService.ts`
Core service class with static methods:
- `search()` - Query WOL with pagination, filtering, sorting
- `getDocumentByUrl()` - Fetch and parse documents to Markdown
- `browsePublications()` - List publication types
- `fetchWithRetry()` - Resilient HTTP with 3 retries and exponential backoff

### `src/wol/videoService.ts`
Video subtitle extraction service:
- `getVideoSubtitles()` - Fetch and parse VTT subtitles from JW.org videos
- `parseVideoUrl()` - Parse JW.org share URLs to extract pub/track/language
- `filterVttByTimeRange()` - Filter subtitles by time range (startTime/endTime)
- `vttToPlainText()` - Convert VTT to clean plain text transcript
- `cleanVtt()` - Remove positioning metadata (line/position/align) from VTT

Uses pub-media API: `https://b.jw-cdn.org/apis/pub-media/GETPUBMEDIALINKS`

### `src/wol/types.ts`
Zod schemas for runtime validation and TypeScript interfaces:
- `SearchOptionsSchema` - Query parameters
- `DocumentRetrievalSchema` - Document URL validation
- `PublicationBrowseSchema` - Browse parameters
- `VideoSubtitleSchema` - Video URL and format options
- Interfaces: `SearchResult`, `Document`, `Publication`, `WOLError`, `VideoMetadata`, `VideoSubtitleResult`

### `src/wol/utils.ts`
Utility classes:
- `URLBuilder` - Constructs WOL URLs
- `SearchOperatorParser` - Encodes/validates search operators
- `ContentParser` - HTML parsing for search results and documents

## MCP Tools

### `wol_search`
Search WOL with advanced operators (AND, OR, NOT, phrase matching, wildcards).
- Supports filtering by publication type, language, date range
- Returns paginated results (max 100 per page)

### `wol_get_document`
Retrieve full document content as Markdown.
- Includes metadata (title, publication, date, volume, issue)
- Images converted to labeled text for LLM compatibility

### `wol_browse_publications`
List available publication types.
- Filter by type, language, year

### `wol_get_video_subtitles`
Extract subtitles/transcripts from JW.org video share URLs.
- **Parameters:**
  - `url` (required) - JW.org video share URL (finder or library format)
  - `format` - Output format: `text` (default), `vtt`, or `both`
  - `startTime` - Filter from this time in seconds (optional)
  - `endTime` - Filter to this time in seconds (optional)
- **Supported URL formats:**
  - `https://www.jw.org/finder?srcid=jwlshare&wtlocale=E&lank=pub-jwbvod25_41_VIDEO`
  - `https://www.jw.org/en/library/videos/?item=pub-jwbvod25_41_VIDEO&appLanguage=E`
- **Returns:** Video metadata (title, duration, resolutions) + transcript text or VTT

## Development Commands

| Command | Purpose |
|---------|---------|
| `npm start` | Run locally with Wrangler (localhost:8787/sse) |
| `npm run dev` | Same as start |
| `npm run deploy` | Deploy to Cloudflare Workers |
| `npm run type-check` | TypeScript validation |
| `npm run format` | Format code with Biome |
| `npm run lint:fix` | Lint and auto-fix |
| `npm run run:tool <url>` | Test document retrieval via CLI |

## Testing with MCP Inspector

```bash
# Terminal 1: Start local server
npm start

# Terminal 2: Connect via MCP Inspector
npx @modelcontextprotocol/inspector@latest
# Open http://localhost:5173 and connect to http://localhost:8787/sse
```

## Important Patterns

### Error Handling
- Custom `WOLError` type with codes: `SERVICE_UNAVAILABLE`, `NOT_FOUND`, `INVALID_QUERY`, `NETWORK_ERROR`, `PARSE_ERROR`
- Zod validation at tool boundaries
- HTTP status code specific handling

### Resilience
- Exponential backoff retry strategy (3 attempts)
- 30-second request timeout
- Proper header negotiation (User-Agent, Accept-Language)

### Content Processing
- HTML → Markdown conversion with proper link formatting
- Non-breaking space normalization (`\u00A0` → regular space)
- Image replacement with text labels for LLM compatibility
- Absolute URL normalization

## Publication Types

23 supported types: `w`, `g`, `bk`, `bi`, `it`, `dx`, `yb`, `syr`, `sgbk`, `mwb`, `km`, `brch`, `bklt`, `es`, `trct`, `kn`, `pgm`, `ca-copgm`, `ca-brpgm`, `co-pgm`, `manual`, `gloss`, `web`

## Search Operators

- `AND` / `OR` / `NOT` - Boolean operators
- `"phrase"` - Exact phrase matching
- `*` / `?` - Wildcards
- Scopes: `sen` (sentence), `par` (paragraph), `art` (article)
- Sort: `occ` (occurrences), `newest`, `oldest`

## Code Style

- Biome for formatting (4-space indent, 100-char line width)
- Strict TypeScript with Zod runtime validation
- ES2021/ES2022 module targets
