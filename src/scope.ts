/**
 * Knowledge scopes: which OKF bundles a session or web client may see.
 *
 * A scope is a root directory holding one OKF bundle. Scopes are derived
 * from trusted context only — the session's workspace cwd (project scope)
 * and the plugin configuration (shared scopes) — never from model-chosen
 * absolute paths (R-009).
 */

import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path'

export type ScopeKind = 'project' | 'shared'

export interface KnowledgeScope {
  /** Stable id used in tool results and web API calls. */
  id: string
  kind: ScopeKind
  /** Human-readable label (workspace title or shared-root name). */
  label: string
  /** Absolute directory of the OKF bundle. */
  root: string
}

/** Directory of the project bundle relative to the project root. */
export const DEFAULT_PROJECT_DIR = '.dsh/knowledge'

/** Walk up from `cwd` to the nearest ancestor containing a `.git` marker. */
export function findProjectRoot(cwd: string): string | undefined {
  if (!isAbsolute(cwd)) return undefined
  let current = resolve(cwd)
  for (;;) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/** The project knowledge bundle root for a session working directory. */
export function projectScopeFor(cwd: string | undefined, projectDir: string): KnowledgeScope | undefined {
  if (cwd === undefined) return undefined
  const projectRoot = findProjectRoot(cwd)
  if (projectRoot === undefined) return undefined
  return {
    id: 'project',
    kind: 'project',
    label: projectRoot,
    root: join(projectRoot, projectDir),
  }
}

/** Shared scopes from configured roots (order preserved; earlier wins on id). */
export function sharedScopes(roots: readonly string[]): KnowledgeScope[] {
  return roots.map((root, index) => ({
    id: index === 0 ? 'shared' : `shared-${index}`,
    kind: 'shared' as const,
    label: root,
    root: resolve(root),
  }))
}

/**
 * Resolve a bundle-relative path inside a scope root, rejecting absolute
 * paths and any traversal that escapes the root.
 */
export function resolveWithin(root: string, relativePath: string): string | undefined {
  if (relativePath === '' || isAbsolute(relativePath)) return undefined
  if (relativePath.includes('\0')) return undefined
  const normalized = normalize(relativePath)
  if (normalized === '..' || normalized.startsWith(`..${sep}`)) return undefined
  const absolute = resolve(root, normalized)
  const rootResolved = resolve(root)
  if (absolute !== rootResolved && !absolute.startsWith(rootResolved + sep)) return undefined
  return absolute
}

/** Only visible Markdown files are knowledge documents. */
export function isKnowledgeFile(name: string): boolean {
  return name.endsWith('.md') && !name.startsWith('.')
}
