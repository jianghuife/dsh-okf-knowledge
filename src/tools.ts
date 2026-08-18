/**
 * Model-facing knowledge tools: search, read, validate.
 *
 * Scope is derived from trusted context only: the calling agent's session
 * cwd selects the project bundle (nearest `.git` ancestor), and the plugin
 * configuration selects shared bundles. The model addresses documents by
 * scoped ids (`project/<path>` or `shared/<path>`) and can never name
 * absolute filesystem paths (R-009).
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { validateConcept } from './okf.js'
import { projectScopeFor, sharedScopes, type KnowledgeScope } from './scope.js'
import { bundleExists, readConcept, searchBundle, StoreError, type SearchHit } from './store.js'
import type { ResolvedConfig } from './config.js'

function scopesFor(exec: ToolRunContext, config: ResolvedConfig): KnowledgeScope[] {
  const cwd = exec.agent?.session.header.cwd
  const project = projectScopeFor(cwd, config.projectDir)
  return [...(project === undefined ? [] : [project]), ...sharedScopes(config.sharedRoots)]
}

function scopeById(scopes: KnowledgeScope[], id: string): KnowledgeScope | undefined {
  return scopes.find((scope) => scope.id === id)
}

function parseId(id: string): { scope: string; path: string } | undefined {
  const slash = id.indexOf('/')
  if (slash <= 0 || slash === id.length - 1) return undefined
  return { scope: id.slice(0, slash), path: id.slice(slash + 1) }
}

function formatHits(hits: SearchHit[]): string {
  if (hits.length === 0) return 'No matching knowledge documents.'
  const lines = hits.map((hit) => {
    const warnings = hit.warnings.length > 0 ? `\n  caveats: ${hit.warnings.join('; ')}` : ''
    const description = hit.description !== '' ? ` — ${hit.description}` : ''
    return `- id: ${hit.scope}/${hit.path}\n  ${hit.title}${hit.type !== '' ? ` [${hit.type}]` : ''}${description}\n  match: ${hit.snippet}${warnings}`
  })
  return `Found ${hits.length} knowledge document(s). Read one with okf_read({ id }).\n${lines.join('\n')}`
}

/** Register the knowledge tools on `ctx.tools`. */
export function registerKnowledgeTools(ctx: Context, config: ResolvedConfig): void {
  ctx.tools.register(defineTool({
    name: 'okf_search',
    description: [
      'Search the knowledge base of the current project plus shared knowledge (Open Knowledge Format bundles).',
      'Use this before answering questions that project knowledge could settle: conventions, decisions, runbooks, domain terms, specs.',
      'Returns document ids to pass to okf_read. Results are limited to the current project and shared bundles.',
      'Cite the returned ids in answers so users can audit the source. If results carry caveats (stale, draft, unverified), tell the user.',
    ].join(' '),
    parameters: {
      query: { type: 'string', required: true, description: 'Search terms (matches title, tags, description, type, path, and body)' },
      scope: { type: 'string', description: "Restrict to 'project' or 'shared'; omit to search both" },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const scopes = scopesFor(exec, config)
      const selected = args.scope === undefined
        ? scopes
        : scopes.filter((scope) => scope.id === args.scope || scope.kind === args.scope)
      if (scopes.length === 0) {
        return 'No knowledge scope is available: the session has no workspace directory and no shared knowledge roots are configured.'
      }
      if (selected.length === 0) return `Unknown scope "${args.scope}". Available: ${scopes.map((scope) => scope.id).join(', ')}.`
      const all: SearchHit[] = []
      const missing: string[] = []
      for (const scope of selected) {
        if (!(await bundleExists(scope.root))) {
          missing.push(scope.id)
          continue
        }
        const hits = await searchBundle(scope.root, args.query, config.maxResults)
        all.push(...hits.map((hit) => ({ ...hit, scope: scope.id })))
      }
      all.sort((a, b) => b.score - a.score)
      const header = missing.length > 0
        ? `Note: no knowledge bundle exists yet for scope(s): ${missing.join(', ')}.\n`
        : ''
      return header + formatHits(all.slice(0, config.maxResults))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'okf_read',
    description: [
      'Read one knowledge document by id (from okf_search), e.g. "project/decisions/auth.md" or "shared/standards/api.md".',
      'Returns OKF frontmatter, trust/staleness caveats, and the Markdown body.',
      'Always surface the returned caveats to the user when the document is stale, draft, deprecated, or unverified.',
    ].join(' '),
    parameters: {
      id: { type: 'string', required: true, description: 'Scoped document id: <scope>/<bundle-relative-path>.md' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const parsed = parseId(args.id)
      if (parsed === undefined) return `Invalid id "${args.id}". Expected <scope>/<path>.md, e.g. project/decisions/auth.md.`
      const scopes = scopesFor(exec, config)
      const scope = scopeById(scopes, parsed.scope)
      if (scope === undefined) {
        return `Unknown scope "${parsed.scope}". Available: ${scopes.map((s) => s.id).join(', ') || '(none)'}.`
      }
      try {
        const record = await readConcept(scope.root, parsed.path)
        const meta = record.validation.meta
        const caveats = [
          ...record.validation.errors.map((issue) => `ERROR ${issue.field}: ${issue.message}`),
          ...record.validation.warnings.map((issue) => `${issue.field}: ${issue.message}`),
        ]
        const headerLines = [
          `id: ${scope.id}/${record.path}`,
          `title: ${meta?.title ?? '(untitled)'}`,
          `type: ${meta?.type ?? '(missing)'}`,
          `status: ${meta?.status ?? 'stable'} | trust: ${record.validation.trust}`,
          meta?.sources !== undefined && meta.sources.length > 0
            ? `sources: ${meta.sources.map((source) => source.resource).join(', ')}`
            : 'sources: (none recorded)',
          caveats.length > 0 ? `caveats: ${caveats.join('; ')}` : undefined,
        ].filter((line): line is string => line !== undefined)
        return `${headerLines.join('\n')}\n\n---\n\n${record.body.trim()}`
      } catch (error) {
        if (error instanceof StoreError) return `Cannot read ${args.id}: ${error.message}`
        throw error
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'okf_validate',
    description: [
      'Validate a Markdown document against Open Knowledge Format v0.2 before saving it as knowledge.',
      'Pass either the full document content, or the id of an existing document.',
      'Use this when creating or maintaining knowledge entries (see the okf-authoring skill).',
    ].join(' '),
    parameters: {
      content: { type: 'string', description: 'Full Markdown document (frontmatter + body) to validate' },
      id: { type: 'string', description: 'Existing document id to validate instead of content' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      let raw = args.content
      let fileName: string | undefined
      if (raw === undefined && args.id !== undefined) {
        const parsed = parseId(args.id)
        if (parsed === undefined) return `Invalid id "${args.id}".`
        const scope = scopeById(scopesFor(exec, config), parsed.scope)
        if (scope === undefined) return `Unknown scope "${parsed.scope}".`
        try {
          raw = (await readConcept(scope.root, parsed.path)).raw
          fileName = parsed.path.split('/').at(-1)
        } catch (error) {
          if (error instanceof StoreError) return `Cannot read ${args.id}: ${error.message}`
          throw error
        }
      }
      if (raw === undefined) return 'Pass either content or id.'
      const result = validateConcept(raw, fileName === undefined ? {} : { fileName })
      const lines = [
        result.ok ? 'VALID: the document conforms to OKF v0.2.' : 'INVALID: the document violates OKF v0.2.',
        ...result.errors.map((issue) => `error ${issue.field}: ${issue.message}`),
        ...result.warnings.map((issue) => `warning ${issue.field}: ${issue.message}`),
      ]
      return lines.join('\n')
    },
  }))
}
