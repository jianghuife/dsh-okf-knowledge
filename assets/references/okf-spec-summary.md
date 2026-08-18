# Open Knowledge Format v0.2 — field reference

An OKF bundle is a directory tree of Markdown files. Reserved filenames: `index.md`
(directory listing; the bundle-root copy may carry `okf_version: "0.2"` frontmatter) and
`log.md` (chronological history, `## YYYY-MM-DD` sections, newest first). Every other `.md`
file is a concept document.

## Concept frontmatter

| Field | Requirement | Shape |
|---|---|---|
| `type` | **required** | short string naming the concept kind (e.g. `Decision`, `Runbook`, `Glossary Term`) |
| `title` | recommended | human-readable display name |
| `description` | recommended | single-sentence summary |
| `resource` | optional | URI uniquely identifying the underlying asset |
| `tags` | optional | list of short strings |
| `sources` | optional | list; each entry: `resource` (required), `id`, `title`, `author`, `usage_count`, `last_modified` |
| `generated` | optional | `{ by, at }` — who/what produced the content, ISO timestamp |
| `verified` / `status` / `stale_after` | optional | defined by OKF; preserved but not used by this plugin |

Unknown keys are allowed and must be preserved by consumers. Extensions go under a
namespaced key (e.g. `specpilot:` or `myorg:`).

## Actor convention

- Agents: `<producer>/<version>` (e.g. `reference_agent/gemini-2.5-pro`)
- Humans: `human:<id>`
- Processes: `process:<id>`

## Links

- Bundle-absolute: `/path/from/bundle/root.md` (preferred; stable under moves).
- Relative: standard Markdown relative paths.
- Links are untyped; prose conveys the relationship. Consumers tolerate broken links.

## Body conventions

Standard Markdown. Conventional headings: `# Schema`, `# Examples`, `# Computation`.
Per-claim attribution via footnotes keyed to `sources[].id`.

## Conformance

1. Every non-reserved `.md` file has parseable YAML frontmatter.
2. Every frontmatter block has a non-empty `type`.
3. Reserved files follow their structure when present.
