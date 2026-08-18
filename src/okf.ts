/**
 * Open Knowledge Format (OKF) v0.2 concept parsing and validation.
 *
 * An OKF bundle is a directory tree of Markdown files. Reserved filenames:
 * `index.md` (directory listing; the bundle root copy may carry
 * `okf_version`) and `log.md` (chronological history). Every other `.md`
 * file is a concept document: YAML frontmatter (required `type`) plus a
 * Markdown body. Consumers must preserve unknown keys and tolerate
 * unrecognized fields, so validation reports unknown-field issues never as
 * errors, only structural violations of the fields OKF does define.
 */

import { parse as parseYaml, parseDocument, stringify as stringifyYaml } from 'yaml'

export const OKF_VERSION = '0.2'

/** Reserved (non-concept) filenames at any directory level. */
export const RESERVED_FILES = new Set(['index.md', 'log.md'])

export type OkfStatus = 'draft' | 'stable' | 'deprecated'
export type TrustTier = 'unverified' | 'machine-confirmed' | 'human-reviewed'

export interface OkfActorStamp {
  by: string
  at: string
}

export interface OkfSource {
  resource: string
  id?: string
  title?: string
  author?: string
  [key: string]: unknown
}

/** Parsed portable OKF fields of one concept (unknown keys preserved in `extra`). */
export interface OkfMeta {
  type?: string
  title?: string
  description?: string
  resource?: string
  tags?: string[]
  sources?: OkfSource[]
  generated?: OkfActorStamp
  verified?: OkfActorStamp[]
  status?: OkfStatus
  stale_after?: string
  extra: Record<string, unknown>
}

export interface OkfIssue {
  /** Frontmatter field path, or '(frontmatter)' / '(body)'. */
  field: string
  message: string
}

export interface OkfValidation {
  ok: boolean
  /** Structural violations; a conforming OKF consumer would reject or misread these. */
  errors: OkfIssue[]
  /** Advisory findings: staleness, missing recommended fields, trust gaps. */
  warnings: OkfIssue[]
  meta: OkfMeta | undefined
  trust: TrustTier
  /** True when the document parsed far enough to inspect fields. */
  parsed: boolean
}

export interface SplitDocument {
  hasFrontmatter: boolean
  frontmatterText: string
  body: string
}

const FRONTMATTER_OPEN = /^---[ \t]*\r?\n/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Split a Markdown document into its frontmatter block and body. */
export function splitFrontmatter(raw: string): SplitDocument {
  if (!FRONTMATTER_OPEN.test(raw)) return { hasFrontmatter: false, frontmatterText: '', body: raw }
  const open = raw.indexOf('\n')
  const rest = raw.slice(open + 1)
  const close = rest.match(/^---[ \t]*(\r?\n|$)/m)
  if (close === null || close.index === undefined) {
    return { hasFrontmatter: false, frontmatterText: '', body: raw }
  }
  const frontmatterText = rest.slice(0, close.index)
  const body = rest.slice(close.index + close[0].length)
  return { hasFrontmatter: true, frontmatterText, body }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOr(errors: OkfIssue[], value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push({ field, message: 'must be a non-empty string' })
    return undefined
  }
  return value
}

function lenientString(errors: OkfIssue[], value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    errors.push({ field, message: 'must be a string' })
    return undefined
  }
  return value.trim() === '' ? undefined : value
}

function actorStamp(errors: OkfIssue[], value: unknown, field: string): OkfActorStamp | undefined {
  if (!isPlainObject(value)) {
    errors.push({ field, message: 'must be a mapping with `by` and `at`' })
    return undefined
  }
  const by = stringOr(errors, value.by ?? undefined, `${field}.by`)
  const atRaw = value.at
  let at: string | undefined
  if (atRaw instanceof Date) at = atRaw.toISOString()
  else at = stringOr(errors, atRaw ?? undefined, `${field}.at`)
  if (at !== undefined && Number.isNaN(Date.parse(at))) {
    errors.push({ field: `${field}.at`, message: 'must be an ISO 8601 timestamp' })
    at = undefined
  }
  if (by === undefined || at === undefined) return undefined
  return { by, at }
}

const PORTABLE_KEYS = new Set([
  'type', 'title', 'description', 'resource', 'tags', 'sources',
  'generated', 'verified', 'status', 'stale_after',
])

/** Derive the advisory trust tier from `verified` actors (OKF actor convention). */
export function trustTier(verified: OkfActorStamp[] | undefined): TrustTier {
  if (verified === undefined || verified.length === 0) return 'unverified'
  return verified.some((entry) => entry.by.startsWith('human:')) ? 'human-reviewed' : 'machine-confirmed'
}

/**
 * Validate one OKF concept document. Reserved files (`index.md`, `log.md`)
 * only require parseable frontmatter when present; concepts additionally
 * require a non-empty `type`.
 */
export function validateConcept(raw: string, options: { fileName?: string; today?: string } = {}): OkfValidation {
  const reserved = options.fileName !== undefined && RESERVED_FILES.has(options.fileName)
  const errors: OkfIssue[] = []
  const warnings: OkfIssue[] = []
  const split = splitFrontmatter(raw)

  if (!split.hasFrontmatter) {
    if (reserved) {
      return { ok: true, errors, warnings, meta: undefined, trust: 'unverified', parsed: true }
    }
    errors.push({ field: '(frontmatter)', message: 'concept documents require a YAML frontmatter block delimited by ---' })
    return { ok: false, errors, warnings, meta: undefined, trust: 'unverified', parsed: false }
  }

  let data: unknown
  try {
    data = parseYaml(split.frontmatterText)
  } catch (error) {
    errors.push({ field: '(frontmatter)', message: `YAML does not parse: ${error instanceof Error ? error.message : String(error)}` })
    return { ok: false, errors, warnings, meta: undefined, trust: 'unverified', parsed: false }
  }
  if (!isPlainObject(data)) {
    errors.push({ field: '(frontmatter)', message: 'frontmatter must be a YAML mapping' })
    return { ok: false, errors, warnings, meta: undefined, trust: 'unverified', parsed: false }
  }

  const meta: OkfMeta = { extra: {} }

  meta.type = stringOr(errors, data.type ?? undefined, 'type')
  if (!reserved && meta.type === undefined && data.type === undefined) {
    errors.push({ field: 'type', message: 'required: a short string naming the concept kind' })
  }
  // title/description are recommended, not required: a wrong type is an
  // error, but an empty value is only a missing-recommendation warning.
  meta.title = lenientString(errors, data.title, 'title')
  meta.description = lenientString(errors, data.description, 'description')
  meta.resource = stringOr(errors, data.resource ?? undefined, 'resource')

  if (data.tags !== undefined) {
    if (!Array.isArray(data.tags) || data.tags.some((tag) => typeof tag !== 'string')) {
      errors.push({ field: 'tags', message: 'must be a list of short strings' })
    } else {
      meta.tags = data.tags as string[]
    }
  }

  if (data.sources !== undefined) {
    if (!Array.isArray(data.sources)) {
      errors.push({ field: 'sources', message: 'must be a list of source entries' })
    } else {
      const sources: OkfSource[] = []
      data.sources.forEach((entry, index) => {
        if (!isPlainObject(entry)) {
          errors.push({ field: `sources[${index}]`, message: 'must be a mapping' })
          return
        }
        const resource = stringOr(errors, entry.resource ?? undefined, `sources[${index}].resource`)
        if (entry.resource === undefined) {
          errors.push({ field: `sources[${index}].resource`, message: 'required within a source entry' })
        }
        if (resource !== undefined) sources.push({ ...entry, resource })
      })
      meta.sources = sources
    }
  }

  if (data.generated !== undefined) {
    meta.generated = actorStamp(errors, data.generated, 'generated')
  }

  if (data.verified !== undefined) {
    // Consumers must treat a bare `verified` mapping as a one-element list.
    const list = Array.isArray(data.verified) ? data.verified : [data.verified]
    const stamps: OkfActorStamp[] = []
    list.forEach((entry, index) => {
      const stamp = actorStamp(errors, entry, Array.isArray(data.verified) ? `verified[${index}]` : 'verified')
      if (stamp !== undefined) stamps.push(stamp)
    })
    meta.verified = stamps
  }

  if (data.status !== undefined) {
    if (data.status !== 'draft' && data.status !== 'stable' && data.status !== 'deprecated') {
      errors.push({ field: 'status', message: 'must be draft, stable, or deprecated (default: stable)' })
    } else {
      meta.status = data.status
    }
  }

  if (data.stale_after !== undefined) {
    const staleAfter = stringOr(errors, data.stale_after, 'stale_after')
    if (staleAfter !== undefined) {
      if (!ISO_DATE.test(staleAfter)) {
        errors.push({ field: 'stale_after', message: 'must be an ISO 8601 date (YYYY-MM-DD)' })
      } else {
        meta.stale_after = staleAfter
      }
    }
  }

  for (const [key, value] of Object.entries(data)) {
    if (!PORTABLE_KEYS.has(key)) meta.extra[key] = value
  }

  // Advisory findings on well-formed concepts.
  if (!reserved) {
    if (meta.title === undefined) {
      warnings.push({ field: 'title', message: 'recommended: a human-readable display name' })
    }
    if (meta.description === undefined) {
      warnings.push({ field: 'description', message: 'recommended: a single-sentence summary' })
    }
    if (meta.sources === undefined || meta.sources.length === 0) {
      warnings.push({ field: 'sources', message: 'no provenance: the concept cites no source material' })
    }
    const tier = trustTier(meta.verified)
    if (tier === 'unverified') {
      warnings.push({ field: 'verified', message: 'unverified: no verification event recorded' })
    } else if (tier === 'machine-confirmed') {
      warnings.push({ field: 'verified', message: 'machine-confirmed only: no human: actor has verified this concept' })
    }
    if (meta.status === 'draft') warnings.push({ field: 'status', message: 'draft: not yet reviewed knowledge' })
    if (meta.status === 'deprecated') warnings.push({ field: 'status', message: 'deprecated: superseded or withdrawn knowledge' })
    const today = options.today ?? new Date().toISOString().slice(0, 10)
    if (meta.stale_after !== undefined && today >= meta.stale_after) {
      warnings.push({ field: 'stale_after', message: `stale: past its stale_after date (${meta.stale_after})` })
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    meta,
    trust: trustTier(meta.verified),
    parsed: true,
  }
}

/** Serialize frontmatter data and a body back into one Markdown document. */
export function assembleDocument(frontmatter: Record<string, unknown>, body: string): string {
  const yamlText = stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd()
  return `---\n${yamlText}\n---\n\n${body.replace(/^\n+/, '')}`
}

/** Scaffold for a new OKF concept document. */
export function conceptTemplate(input: {
  type: string
  title: string
  description?: string
  generatedBy?: string
  tags?: string[]
  now?: string
}): string {
  const frontmatter: Record<string, unknown> = {
    type: input.type,
    title: input.title,
    description: input.description ?? '',
    status: 'stable',
  }
  if (input.tags !== undefined && input.tags.length > 0) frontmatter.tags = input.tags
  if (input.generatedBy !== undefined) {
    frontmatter.generated = { by: input.generatedBy, at: input.now ?? new Date().toISOString() }
  }
  frontmatter.sources = [{ resource: '' }]
  const body = [
    `# ${input.title}`,
    '',
    input.description ?? '',
    '',
  ].join('\n')
  return assembleDocument(frontmatter, body)
}

/** Bundle-root `index.md` scaffold carrying the okf_version declaration. */
export function bundleIndexTemplate(title: string): string {
  return [
    '---',
    `okf_version: "${OKF_VERSION}"`,
    '---',
    '',
    `# ${title}`,
    '',
    'This directory is an Open Knowledge Format bundle.',
    '',
  ].join('\n')
}

/** `log.md` scaffold (chronological history, newest first). */
export function logTemplate(date: string, note: string): string {
  return [
    '# Log',
    '',
    `## ${date}`,
    '',
    `- **Creation** ${note}`,
    '',
  ].join('\n')
}

/**
 * Prepend one entry to a `log.md` document (newest-first date grouping).
 * Creates the date heading when today's section does not exist yet.
 */
export function appendLogEntry(existing: string, date: string, entry: string): string {
  const line = `- ${entry}`
  const heading = `## ${date}`
  if (existing.includes(heading)) {
    return existing.replace(heading, `${heading}\n\n${line}`).replace(`${heading}\n\n${line}\n\n`, `${heading}\n\n${line}\n`)
  }
  const firstSection = existing.search(/^## /m)
  if (firstSection === -1) return `${existing.trimEnd()}\n\n${heading}\n\n${line}\n`
  return `${existing.slice(0, firstSection)}${heading}\n\n${line}\n\n${existing.slice(firstSection)}`
}

/** Update or keep a document's frontmatter text while replacing the body, preserving unknown keys. */
export function replaceFrontmatterField(raw: string, key: string, value: unknown): string {
  const split = splitFrontmatter(raw)
  const document = split.hasFrontmatter ? parseDocument(split.frontmatterText) : parseDocument('')
  document.set(key, value)
  const yamlText = document.toString({ lineWidth: 0 }).trimEnd()
  return `---\n${yamlText}\n---\n${split.hasFrontmatter ? split.body : `\n${raw}`}`
}
