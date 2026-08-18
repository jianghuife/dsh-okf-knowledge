/**
 * OKF bundle store: tree listing, versioned reads/writes with optimistic
 * concurrency, bundle initialization, index maintenance, and lexical search.
 *
 * Writes are last-writer-checked: every read carries a content hash
 * (`version`), and a write must present the hash it started from. A
 * mismatch is a conflict, never a silent overwrite (R-008).
 */

import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, posix, relative, sep } from 'node:path'
import {
  appendLogEntry, bundleIndexTemplate, logTemplate, splitFrontmatter,
  validateConcept, type OkfValidation, RESERVED_FILES,
} from './okf.js'
import { isKnowledgeFile, resolveWithin } from './scope.js'

export interface TreeNode {
  name: string
  /** Bundle-relative POSIX path. */
  path: string
  kind: 'dir' | 'file'
  children?: TreeNode[]
}

export interface ConceptRecord {
  path: string
  raw: string
  /** sha256 of the raw content; the optimistic-concurrency token. */
  version: string
  validation: OkfValidation
  body: string
  frontmatterText: string
}

export class StoreError extends Error {
  constructor(
    readonly code: 'not-found' | 'invalid-path' | 'conflict' | 'exists' | 'invalid-content' | 'not-initialized',
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'StoreError'
  }
}

export function contentVersion(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

async function statOrUndefined(path: string) {
  try {
    return await stat(path)
  } catch {
    return undefined
  }
}

/** Whether a bundle exists at `root` (any directory with an index.md or concepts). */
export async function bundleExists(root: string): Promise<boolean> {
  return (await statOrUndefined(root))?.isDirectory() ?? false
}

/** Recursively list directories and knowledge files under a bundle root. */
export async function listTree(root: string, relDir = ''): Promise<TreeNode[]> {
  const absolute = relDir === '' ? root : resolveWithin(root, relDir)
  if (absolute === undefined) throw new StoreError('invalid-path', `invalid path: ${relDir}`)
  let entries
  try {
    entries = await readdir(absolute, { withFileTypes: true })
  } catch {
    return []
  }
  const nodes: TreeNode[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue
    const childRel = relDir === '' ? entry.name : posix.join(relDir, entry.name)
    if (entry.isDirectory()) {
      nodes.push({ name: entry.name, path: childRel, kind: 'dir', children: await listTree(root, childRel) })
    } else if (entry.isFile() && isKnowledgeFile(entry.name)) {
      nodes.push({ name: entry.name, path: childRel, kind: 'file' })
    }
  }
  // Directories first, then files.
  return nodes.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
}

/** Read one document with its version and OKF validation. */
export async function readConcept(root: string, relPath: string): Promise<ConceptRecord> {
  const absolute = resolveWithin(root, relPath)
  if (absolute === undefined || !isKnowledgeFile(posix.basename(toPosix(relPath)))) {
    throw new StoreError('invalid-path', `invalid knowledge path: ${relPath}`)
  }
  let raw: string
  try {
    raw = await readFile(absolute, 'utf8')
  } catch {
    throw new StoreError('not-found', `no knowledge document at ${relPath}`)
  }
  const fileName = posix.basename(toPosix(relPath))
  const validation = validateConcept(raw, { fileName })
  const split = splitFrontmatter(raw)
  return {
    path: toPosix(relPath),
    raw,
    version: contentVersion(raw),
    validation,
    body: split.body,
    frontmatterText: split.frontmatterText,
  }
}

export interface WriteInput {
  content: string
  /** Version the edit started from; undefined means the file must not exist yet. */
  baseVersion?: string
  /** Skip OKF validation errors (still refuses unparseable YAML on concepts). */
  force?: boolean
}

export interface WriteResult {
  path: string
  version: string
  validation: OkfValidation
}

/**
 * Validate and write one document atomically. Creating requires no
 * baseVersion and no existing file; updating requires the current version.
 */
export async function writeConcept(root: string, relPath: string, input: WriteInput): Promise<WriteResult> {
  const posixRel = toPosix(relPath)
  const absolute = resolveWithin(root, relPath)
  if (absolute === undefined || !isKnowledgeFile(posix.basename(posixRel))) {
    throw new StoreError('invalid-path', `invalid knowledge path: ${relPath}`)
  }
  const fileName = posix.basename(posixRel)
  const validation = validateConcept(input.content, { fileName })
  if (!validation.ok && input.force !== true) {
    throw new StoreError('invalid-content', 'the document does not conform to OKF v0.2', validation.errors)
  }

  const existing = await statOrUndefined(absolute)
  if (existing === undefined) {
    if (input.baseVersion !== undefined) {
      throw new StoreError('not-found', `no knowledge document at ${relPath} (baseVersion given for a missing file)`)
    }
  } else {
    if (!existing.isFile()) throw new StoreError('invalid-path', `${relPath} is not a file`)
    if (input.baseVersion === undefined) {
      throw new StoreError('exists', `${relPath} already exists; pass the current version to update it`)
    }
    const current = contentVersion(await readFile(absolute, 'utf8'))
    if (current !== input.baseVersion) {
      throw new StoreError('conflict', `${relPath} changed since it was read`, { currentVersion: current })
    }
  }

  await mkdir(dirname(absolute), { recursive: true })
  const temp = join(dirname(absolute), `.${fileName}.${process.pid}.${Date.now().toString(36)}.tmp`)
  await writeFile(temp, input.content, 'utf8')
  await rename(temp, absolute)
  return { path: posixRel, version: contentVersion(input.content), validation }
}

/** Initialize an OKF bundle skeleton (index.md + log.md). Idempotent. */
export async function initBundle(root: string, title: string, now = new Date()): Promise<void> {
  await mkdir(root, { recursive: true })
  const date = now.toISOString().slice(0, 10)
  const index = join(root, 'index.md')
  if ((await statOrUndefined(index)) === undefined) {
    await writeFile(index, bundleIndexTemplate(title), 'utf8')
  }
  const log = join(root, 'log.md')
  if ((await statOrUndefined(log)) === undefined) {
    await writeFile(log, logTemplate(date, 'Initialized the knowledge bundle.'), 'utf8')
  }
}

/** Record one bundle change in log.md (best effort; creates the log if missing). */
export async function recordLogEntry(root: string, entry: string, now = new Date()): Promise<void> {
  const date = now.toISOString().slice(0, 10)
  const log = join(root, 'log.md')
  const existing = (await statOrUndefined(log)) === undefined ? '# Log\n' : await readFile(log, 'utf8')
  await writeFile(log, appendLogEntry(existing, date, entry), 'utf8')
}

interface IndexedConcept {
  path: string
  title: string
  description: string
  type: string
  tags: string[]
  body: string
  warnings: string[]
}

async function collectConcepts(root: string): Promise<IndexedConcept[]> {
  const concepts: IndexedConcept[] = []
  async function walk(relDir: string): Promise<void> {
    const absolute = relDir === '' ? root : resolveWithin(root, relDir)
    if (absolute === undefined) return
    let entries
    try {
      entries = await readdir(absolute, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const childRel = relDir === '' ? entry.name : posix.join(relDir, entry.name)
      if (entry.isDirectory()) {
        await walk(childRel)
      } else if (entry.isFile() && isKnowledgeFile(entry.name) && !RESERVED_FILES.has(entry.name)) {
        try {
          const record = await readConcept(root, childRel)
          const meta = record.validation.meta
          concepts.push({
            path: childRel,
            title: meta?.title ?? entry.name.replace(/\.md$/, ''),
            description: meta?.description ?? '',
            type: meta?.type ?? '',
            tags: meta?.tags ?? [],
            body: record.body,
            warnings: record.validation.warnings.map((w) => `${w.field}: ${w.message}`),
          })
        } catch {
          // Unreadable entries stay out of the index; the tree still shows them.
        }
      }
    }
  }
  await walk('')
  return concepts
}

/**
 * Regenerate the bundle-root `index.md` listing (grouped by directory,
 * `* [Title](path) - description` entries), preserving the header above the
 * first group heading.
 */
export async function regenerateIndex(root: string, title: string): Promise<string> {
  const concepts = await collectConcepts(root)
  const groups = new Map<string, IndexedConcept[]>()
  for (const concept of concepts) {
    const dir = posix.dirname(concept.path)
    const key = dir === '.' ? '' : dir
    const list = groups.get(key) ?? []
    list.push(concept)
    groups.set(key, list)
  }
  const lines: string[] = ['---', `okf_version: "0.2"`, '---', '', `# ${title}`, '']
  for (const key of [...groups.keys()].sort()) {
    lines.push(`## ${key === '' ? 'Concepts' : key}`, '')
    for (const concept of groups.get(key)!.sort((a, b) => a.path.localeCompare(b.path))) {
      const description = concept.description !== '' ? ` - ${concept.description}` : ''
      lines.push(`* [${concept.title}](/${concept.path})${description}`)
    }
    lines.push('')
  }
  const content = lines.join('\n')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'index.md'), content, 'utf8')
  return content
}

export interface SearchHit {
  /** Scope id the hit came from (filled by the caller). */
  scope: string
  path: string
  title: string
  type: string
  description: string
  score: number
  matched: string[]
  warnings: string[]
  snippet: string
}

const TOKEN_SPLIT = /[^\p{L}\p{N}]+/u

export function tokenize(text: string): string[] {
  return text
    .split(TOKEN_SPLIT)
    .flatMap((word) => word.split(/(?<=[a-z0-9])(?=[A-Z])/))
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 1)
}

/** Lexical field-weighted search with inverse document frequency. */
export async function searchBundle(root: string, query: string, limit = 8): Promise<Omit<SearchHit, 'scope'>[]> {
  const concepts = await collectConcepts(root)
  if (concepts.length === 0) return []
  const queryTokens = [...new Set(tokenize(query))]
  if (queryTokens.length === 0) return []

  const fields = concepts.map((concept) => ({
    concept,
    title: new Set(tokenize(concept.title)),
    type: new Set(tokenize(concept.type)),
    tags: new Set(concept.tags.flatMap(tokenize)),
    description: new Set(tokenize(concept.description)),
    path: new Set(tokenize(concept.path)),
    body: new Set(tokenize(concept.body)),
  }))
  const documentFrequency = new Map(queryTokens.map((token) => [
    token,
    fields.filter((f) => f.title.has(token) || f.type.has(token) || f.tags.has(token)
      || f.description.has(token) || f.path.has(token) || f.body.has(token)).length,
  ]))

  const hits = fields.map((f) => {
    let score = 0
    const matched: string[] = []
    for (const token of queryTokens) {
      const weight = f.title.has(token) ? 5
        : f.tags.has(token) ? 4
          : f.description.has(token) ? 3
            : f.type.has(token) ? 3
              : f.path.has(token) ? 2
                : f.body.has(token) ? 1 : 0
      if (weight === 0) continue
      matched.push(token)
      const df = documentFrequency.get(token) ?? 0
      score += weight * (1 + Math.log((concepts.length + 1) / (df + 1)))
    }
    return {
      path: f.concept.path,
      title: f.concept.title,
      type: f.concept.type,
      description: f.concept.description,
      score,
      matched,
      warnings: f.concept.warnings,
      snippet: snippetFor(f.concept.body, matched),
    }
  })
  return hits
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

function snippetFor(body: string, matched: string[]): string {
  const lines = body.split('\n')
  for (const line of lines) {
    const lower = line.toLowerCase()
    if (matched.some((token) => lower.includes(token))) {
      const trimmed = line.trim()
      return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed
    }
  }
  const first = lines.find((line) => line.trim() !== '' && !line.startsWith('#'))?.trim() ?? ''
  return first.length > 200 ? `${first.slice(0, 200)}…` : first
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

/** Bundle-relative POSIX path of an absolute child path. */
export function relativePosix(root: string, absolute: string): string {
  return toPosix(relative(root, absolute))
}
