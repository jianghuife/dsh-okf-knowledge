# dsh-okf-knowledge

English | [简体中文](./README.zh-CN.md)

A DeepSeek Harness plugin that gives every project a human-readable, human-editable knowledge
base in the [Open Knowledge Format (OKF) v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).
Knowledge is plain Markdown with YAML frontmatter — never an invisible vector store — so users
can inspect, audit, and edit every entry.

## What it adds

- **Per-project OKF bundles** at `<project root>/.dsh/knowledge/`, plus **shared bundles**
  (default `<dsh home>/knowledge/shared`) for cross-project standards and runbooks.
- **Conversation tools** — `okf_search`, `okf_read`, `okf_validate` — scoped
  to the calling session's project (nearest `.git` ancestor of the session cwd) and the shared
  roots. Results carry document ids for citation and caveats for stale/draft/unverified entries.
- **Web UI entry** — a Knowledge button in the sidebar footer opens a browser/editor panel:
  scope picker, directory tree, rendered Markdown + frontmatter view, raw source view, and an
  editor with save-time OKF validation and optimistic-concurrency conflict detection (no
  silent overwrites).
- **Bundled `okf-authoring` skill** that teaches the agent how to split source material into
  concepts, fill OKF frontmatter, preserve provenance, link concepts, and maintain `index.md`
  and `log.md` — used only when the user explicitly asks for knowledge work.

## Installation

Node.js 22.19 or later. Install into a DSH profile (replace `web` as needed):

```bash
dsh plugin --profile web add dsh-okf-knowledge
```

Installing through `dsh plugin add` activates the bundled default configuration automatically.
Verify the composed config without starting DSH:

```bash
dsh --profile web --dump-config
```

## Configuration

Override defaults in the profile's `cordis.patch.yml`:

```yaml
- id: knowledge
  config:
    projectDir: .dsh/knowledge        # bundle dir relative to the project root
    sharedRoots:                      # shared OKF bundles usable from every project
      - /Users/me/.dsh/knowledge/shared
    maxResults: 8                     # okf_search result cap
```

## Scope and authorization

Scopes are derived from trusted context only (R-009):

- Tools resolve the project bundle from the calling agent's session `cwd`; the model addresses
  documents by scoped ids (`project/<path>`, `shared/<path>`) and can never name absolute
  filesystem paths.
- The Web API (`/okf-knowledge/api/*`) resolves project scopes from the workspace registry and
  shared scopes from the plugin config, requires loopback origin, and rejects path traversal.

## Knowledge format

Every concept is Markdown with YAML frontmatter: required `type`; recommended `title`,
`description`; provenance via `sources`; trust via `generated`/`verified` (actor convention
`human:<id>` / `<producer>/<version>` / `process:<id>`); lifecycle via `status`
(`draft`/`stable`/`deprecated`) and `stale_after`. Reserved files: `index.md` (listing, bundle
root carries `okf_version: "0.2"`) and `log.md` (dated change history). Unknown frontmatter
keys are preserved.

## Development

```bash
npm install
npm run check   # typecheck
npm test        # vitest
npm run build   # dist/index.js (host, ESM) + dist/client.js (web loader factory)
```

Local install into a profile:

```bash
dsh plugin --profile web add /path/to/dsh-okf-knowledge-plugin
```

## License

MIT
