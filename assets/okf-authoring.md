# OKF knowledge authoring

You are maintaining an Open Knowledge Format (OKF v0.2) knowledge base. Only do this when the
user explicitly asks for knowledge to be created or maintained. The knowledge base is
human-readable and human-owned: users review and edit every file, so write for readers first.

See `references/okf-spec-summary.md` (next to this skill) for the full field reference.

## Where knowledge lives

- Project knowledge: `<project root>/.dsh/knowledge/` — one OKF bundle per project.
- Shared knowledge (cross-project standards, security rules, common runbooks): the shared
  bundle shown by `okf_search` under the `shared/` scope. Only put knowledge there when
  the user says it applies beyond the current project.

Use the `okf_search` and `okf_read` tools to check what already exists before
writing anything. Never duplicate an existing concept — update it instead.

## Initialize a bundle

If `.dsh/knowledge/` does not exist, create it with:

- `index.md` — frontmatter `okf_version: "0.2"`, then a short title and grouped listing.
- `log.md` — `# Log`, then date-grouped entries (`## YYYY-MM-DD`, newest first).
- Concept files organized in subdirectories by domain (e.g. `decisions/`, `standards/`,
  `runbooks/`, `glossary/`).

## Identify and split concepts

From source material (documents, chat, code), extract entries that are:

1. **Durable** — still true next quarter, not a one-off status.
2. **Self-contained** — one concept per file; a reader needs no other file to understand it.
3. **Attributable** — you can name where it came from.

Never turn one incidental observation into a rule. When material conflicts, surface the
conflict to the user instead of picking a side silently.

## Write the frontmatter

Every concept file starts with YAML frontmatter. Required: `type`. Strongly recommended:
`title`, `description`, `sources`, `generated`, `status`.

```markdown
---
type: Decision
title: Use PostgreSQL for the metadata store
description: Chosen over DynamoDB for transactional integrity across services.
tags: [database, architecture]
sources:
  - resource: docs/adr/0007-metadata-store.md
    title: ADR-0007
generated:
  by: <agent>/<model>
  at: 2026-08-18T10:00:00Z
status: stable
---

# Use PostgreSQL for the metadata store

...body...
```

Rules:

- `generated.by` is your actor id (`<producer>/<version>`); humans are `human:<id>`,
  processes `process:<id>`.
- Entries you write are formal knowledge: use `status: stable` (or omit `status`, which
  defaults to stable). Use `draft` only when the user says the content is tentative, and
  `deprecated` when knowledge is superseded. Never add a `verified` entry with a `human:`
  actor yourself — verification records who actually reviewed, and only that person adds it.
- Every `sources[].resource` must point at real material (repo path or URL). If the user
  dictated the knowledge with no artifact, record them as the source
  (`resource: "conversation with human:<id>"` is acceptable; prefer a real artifact).
- Add `stale_after: YYYY-MM-DD` when the knowledge has a natural expiry.

## Preserve provenance in the body

Attribute specific claims with Markdown footnotes keyed to `sources[].id` when a file draws
on several sources. Quote sparingly; summarize in your own words.

## Link concepts

Link related concepts with bundle-relative Markdown links starting with `/`
(e.g. `[metadata store decision](/decisions/metadata-store.md)`) so links survive file moves.
Links are untyped; make the relationship clear in prose ("supersedes", "depends on").

## Maintain index.md and log.md

After creating, renaming, or removing concepts:

1. Update `index.md`: grouped sections with `* [Title](/path.md) - description` entries.
2. Prepend a `log.md` entry under today's date: `- **Creation**/**Update**/**Removal** …`
   with a one-line reason.

## Validate before finishing

Run `okf_validate` on every file you created or changed and fix all errors. Report
remaining warnings (unverified, missing sources) to the user, and show them the complete
list of files you touched.
