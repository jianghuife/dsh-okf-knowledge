/**
 * Web API for the knowledge browser/editor, served under `/okf-knowledge/api`.
 *
 * Scope authority is server-side: project scopes come from the trusted
 * workspace registry and shared scopes from plugin configuration; a request
 * can only name a scope id, never a filesystem path (R-009). All requests
 * must arrive from loopback with a loopback Host header — this prefix sits
 * outside the shipped `/api` trust fence, so it carries its own.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-workspace'
import { validateConcept } from './okf.js'
import { sharedScopes, type KnowledgeScope } from './scope.js'
import {
  bundleExists, initBundle, listTree, readConcept, recordLogEntry,
  regenerateIndex, StoreError, writeConcept,
} from './store.js'
import type { ResolvedConfig } from './config.js'

const MAX_BODY_BYTES = 5 * 1024 * 1024

export const name = 'okf-knowledge-web-api'
export const inject = ['webServer']

/** Route prefix; the register call and the path stripping share this constant. */
export const API_PREFIX = '/okf-knowledge/api'

interface ScopeView extends KnowledgeScope {
  exists: boolean
}

function isLoopbackHostname(hostname: string): boolean {
  const bare = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return bare === 'localhost' || bare.endsWith('.localhost')
    || bare === '::1' || bare === '::ffff:127.0.0.1'
    || /^127(\.\d{1,3}){3}$/.test(bare)
}

function isTrustedRequest(req: IncomingMessage): boolean {
  const remote = req.socket.remoteAddress ?? ''
  const remoteLoopback = remote === '::1' || remote.startsWith('::ffff:127.') || remote.startsWith('127.')
  if (!remoteLoopback) return false
  const host = req.headers.host
  if (host === undefined) return false
  try {
    return isLoopbackHostname(new URL(`http://${host}`).hostname)
  } catch {
    return false
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

function sendError(res: ServerResponse, status: number, code: string, message: string, details?: unknown): void {
  sendJson(res, status, { error: { code, message, ...(details === undefined ? {} : { details }) } })
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk as Buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text === '' ? {} : JSON.parse(text)
}

function storeErrorStatus(error: StoreError): number {
  switch (error.code) {
    case 'not-found': return 404
    case 'conflict': return 409
    case 'exists': return 409
    case 'invalid-content': return 422
    case 'not-initialized': return 409
    default: return 400
  }
}

/** Sub-plugin: mounts the knowledge web API when a web server is present. */
export function apply(ctx: Context, config: ResolvedConfig): void {
  async function currentScopes(): Promise<ScopeView[]> {
    const scopes: KnowledgeScope[] = []
    const registry = ctx.get('workspaceRegistry')
    if (registry !== undefined) {
      for (const workspace of registry.list()) {
        scopes.push({
          id: `ws:${workspace.id}`,
          kind: 'project',
          label: workspace.title !== '' ? workspace.title : basename(workspace.path),
          root: join(workspace.path, config.projectDir),
        })
      }
    }
    scopes.push(...sharedScopes(config.sharedRoots))
    return Promise.all(scopes.map(async (scope) => ({ ...scope, exists: await bundleExists(scope.root) })))
  }

  async function scopeById(id: string): Promise<ScopeView | undefined> {
    return (await currentScopes()).find((scope) => scope.id === id)
  }

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!isTrustedRequest(req)) {
      sendError(res, 403, 'forbidden', 'knowledge API requests must come from loopback')
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const route = url.pathname.startsWith(API_PREFIX)
      ? url.pathname.slice(API_PREFIX.length).replace(/^\//, '')
      : url.pathname
    try {
      if (req.method === 'GET' && route === 'scopes') {
        const scopes = await currentScopes()
        sendJson(res, 200, {
          scopes: scopes.map(({ id, kind, label, root, exists }) => ({ id, kind, label, root, exists })),
        })
        return
      }

      if (req.method === 'GET' && route === 'tree') {
        const scope = await scopeById(url.searchParams.get('scope') ?? '')
        if (scope === undefined) return sendError(res, 404, 'unknown-scope', 'unknown scope id')
        sendJson(res, 200, { scope: scope.id, exists: scope.exists, tree: scope.exists ? await listTree(scope.root) : [] })
        return
      }

      if (req.method === 'GET' && route === 'file') {
        const scope = await scopeById(url.searchParams.get('scope') ?? '')
        if (scope === undefined) return sendError(res, 404, 'unknown-scope', 'unknown scope id')
        const path = url.searchParams.get('path') ?? ''
        const record = await readConcept(scope.root, path)
        sendJson(res, 200, {
          scope: scope.id,
          path: record.path,
          raw: record.raw,
          version: record.version,
          body: record.body,
          frontmatterText: record.frontmatterText,
          validation: {
            ok: record.validation.ok,
            errors: record.validation.errors,
            warnings: record.validation.warnings,
            trust: record.validation.trust,
            meta: record.validation.meta === undefined ? undefined : {
              type: record.validation.meta.type,
              title: record.validation.meta.title,
              description: record.validation.meta.description,
              tags: record.validation.meta.tags,
              status: record.validation.meta.status,
              stale_after: record.validation.meta.stale_after,
              sources: record.validation.meta.sources,
              generated: record.validation.meta.generated,
              verified: record.validation.meta.verified,
            },
          },
        })
        return
      }

      if (req.method === 'PUT' && route === 'file') {
        const body = await readBody(req) as {
          scope?: string; path?: string; content?: string; baseVersion?: string; force?: boolean
        }
        if (typeof body.scope !== 'string' || typeof body.path !== 'string' || typeof body.content !== 'string') {
          return sendError(res, 400, 'bad-request', 'scope, path, and content are required')
        }
        const scope = await scopeById(body.scope)
        if (scope === undefined) return sendError(res, 404, 'unknown-scope', 'unknown scope id')
        const result = await writeConcept(scope.root, body.path, {
          content: body.content,
          ...(body.baseVersion === undefined ? {} : { baseVersion: body.baseVersion }),
          ...(body.force === undefined ? {} : { force: body.force }),
        })
        if (basename(body.path) !== 'log.md') {
          await recordLogEntry(scope.root, `**Update** ${body.baseVersion === undefined ? 'Created' : 'Edited'} \`${result.path}\` via the Web editor.`).catch(() => {})
        }
        sendJson(res, 200, {
          path: result.path,
          version: result.version,
          validation: { ok: result.validation.ok, errors: result.validation.errors, warnings: result.validation.warnings },
        })
        return
      }

      if (req.method === 'POST' && route === 'validate') {
        const body = await readBody(req) as { content?: string; fileName?: string }
        if (typeof body.content !== 'string') return sendError(res, 400, 'bad-request', 'content is required')
        const result = validateConcept(body.content, typeof body.fileName === 'string' ? { fileName: body.fileName } : {})
        sendJson(res, 200, { ok: result.ok, errors: result.errors, warnings: result.warnings, trust: result.trust })
        return
      }

      if (req.method === 'POST' && route === 'init') {
        const body = await readBody(req) as { scope?: string }
        if (typeof body.scope !== 'string') return sendError(res, 400, 'bad-request', 'scope is required')
        const scope = await scopeById(body.scope)
        if (scope === undefined) return sendError(res, 404, 'unknown-scope', 'unknown scope id')
        await initBundle(scope.root, scope.kind === 'project' ? `${scope.label} Knowledge` : 'Shared Knowledge')
        sendJson(res, 200, { ok: true, scope: scope.id })
        return
      }

      if (req.method === 'POST' && route === 'index') {
        const body = await readBody(req) as { scope?: string }
        if (typeof body.scope !== 'string') return sendError(res, 400, 'bad-request', 'scope is required')
        const scope = await scopeById(body.scope)
        if (scope === undefined) return sendError(res, 404, 'unknown-scope', 'unknown scope id')
        if (!scope.exists) return sendError(res, 409, 'not-initialized', 'the bundle has not been initialized')
        const content = await regenerateIndex(scope.root, scope.kind === 'project' ? `${scope.label} Knowledge` : 'Shared Knowledge')
        sendJson(res, 200, { ok: true, content })
        return
      }

      sendError(res, 404, 'not-found', `no knowledge route: ${req.method} ${url.pathname}`)
    } catch (error) {
      if (error instanceof StoreError) {
        sendError(res, storeErrorStatus(error), error.code, error.message, error.details)
        return
      }
      if (error instanceof SyntaxError) {
        sendError(res, 400, 'bad-json', 'request body is not valid JSON')
        return
      }
      sendError(res, 500, 'internal', error instanceof Error ? error.message : String(error))
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: (req, res) => void handler(req, res),
  }))
}
