/** Same-origin fetch wrappers for the /okf-knowledge/api routes. */

export interface ScopeView {
  id: string
  kind: 'project' | 'shared'
  label: string
  root: string
  exists: boolean
}

export interface TreeNode {
  name: string
  path: string
  kind: 'dir' | 'file'
  children?: TreeNode[]
}

export interface OkfIssue {
  field: string
  message: string
}

export interface FileValidation {
  ok: boolean
  errors: OkfIssue[]
  warnings: OkfIssue[]
  trust: 'unverified' | 'machine-confirmed' | 'human-reviewed'
  meta?: {
    type?: string
    title?: string
    description?: string
    tags?: string[]
    status?: string
    stale_after?: string
    sources?: { resource: string; title?: string }[]
    generated?: { by: string; at: string }
    verified?: { by: string; at: string }[]
  }
}

export interface FileRecord {
  scope: string
  path: string
  raw: string
  version: string
  body: string
  frontmatterText: string
  validation: FileValidation
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    const error = (payload.error ?? {}) as { code?: string; message?: string; details?: unknown }
    throw new ApiError(response.status, error.code ?? 'error', error.message ?? response.statusText, error.details)
  }
  return payload as T
}

export const api = {
  scopes: () => request<{ scopes: ScopeView[] }>('GET', '/okf-knowledge/api/scopes'),
  tree: (scope: string) =>
    request<{ scope: string; exists: boolean; tree: TreeNode[] }>('GET', `/okf-knowledge/api/tree?scope=${encodeURIComponent(scope)}`),
  file: (scope: string, path: string) =>
    request<FileRecord>('GET', `/okf-knowledge/api/file?scope=${encodeURIComponent(scope)}&path=${encodeURIComponent(path)}`),
  save: (input: { scope: string; path: string; content: string; baseVersion?: string }) =>
    request<{ path: string; version: string; validation: FileValidation }>('PUT', '/okf-knowledge/api/file', input),
  validate: (content: string, fileName?: string) =>
    request<FileValidation>('POST', '/okf-knowledge/api/validate', { content, fileName }),
  init: (scope: string) => request<{ ok: boolean }>('POST', '/okf-knowledge/api/init', { scope }),
  reindex: (scope: string) => request<{ ok: boolean }>('POST', '/okf-knowledge/api/index', { scope }),
}
