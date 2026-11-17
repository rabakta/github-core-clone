# github-core-clone-01

A standalone GitHub-compatible git forge for the [make.fun bounty](https://make.fun/bounty/github-core-clone-01).

## Features

- **Git Smart HTTP** - `info/refs`, `git-upload-pack`, `git-receive-pack`
- **REST v3 API** - Repositories, issues, pull requests, branches, commits, contents, labels, comments
- **GraphQL v4** - Schema compatible with GitHub's GraphQL API
- **MCP** - Model Context Protocol over streamable HTTP
- **Single process, no dependencies** - Runs on Node 22 standard library only
- **Deterministic** - Same state export across runs

## Quick Start

```bash
# Run locally (requires MAKEFUN_ENV_URL for full integration)
node --experimental-strip-types main.ts
```

The platform runs `node /bot/main.ts` on Node 22.18+. There is nothing to install.

## Architecture

```
main.ts          # Entry point - lifecycle management (bind port, register, wait for done)
src/app.ts       # HTTP server - routes all endpoints
src/storage.ts   # In-memory storage with /tmp persistence
src/rest-api.ts  # REST v3 implementation
src/graphql.ts   # GraphQL v4 implementation
src/mcp.ts       # MCP implementation
src/git-protocol.ts  # Git smart HTTP protocol
src/types.ts     # TypeScript types
```

## API Surface

| Route | Description |
|-------|-------------|
| `GET /healthz` | Health probe (200 `{"ok":true}`) |
| `GET /api/v3/` | API root with OAuth scopes |
| `GET/POST /api/v3/*` | REST v3 API |
| `POST /api/graphql` | GraphQL v4 |
| `POST /mcp` | MCP over streamable HTTP |
| `/<owner>/<repo>.git/*` | Git smart HTTP |

## Limits

- Node 22 only
- No dependencies at runtime
- No git binary
- Repository mounted read-only at `/bot`
- Write only under `/tmp`
- Wall budget: 900 seconds

## License

MIT