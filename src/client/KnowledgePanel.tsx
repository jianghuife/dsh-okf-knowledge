/**
 * Knowledge browser/editor: a sidebar footer action that opens a frame-wide
 * panel. Browse project/shared OKF bundles, view rendered Markdown and
 * frontmatter, and edit with save-time validation and optimistic-concurrency
 * conflict handling.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Button, MarkdownText, CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { api, ApiError, type FileRecord, type OkfIssue, type ScopeView, type TreeNode } from './api.js'

const panelStyle: CSSProperties = {
  position: 'fixed',
  inset: '6vh 8vw',
  zIndex: 1000,
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 12,
  border: '1px solid rgba(128,128,128,0.35)',
  background: 'var(--dsh-surface, Canvas)',
  color: 'inherit',
  boxShadow: '0 12px 48px rgba(0,0,0,0.35)',
  pointerEvents: 'auto',
  overflow: 'hidden',
}

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 999,
  background: 'rgba(0,0,0,0.35)',
  pointerEvents: 'auto',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 16px',
  borderBottom: '1px solid rgba(128,128,128,0.25)',
}

const bodyStyle: CSSProperties = { display: 'flex', flex: 1, minHeight: 0 }

const treeColumnStyle: CSSProperties = {
  width: 280,
  minWidth: 200,
  borderRight: '1px solid rgba(128,128,128,0.25)',
  overflow: 'auto',
  padding: 8,
}

const mainColumnStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

const chipStyle: CSSProperties = {
  display: 'inline-block',
  padding: '1px 8px',
  borderRadius: 999,
  border: '1px solid rgba(128,128,128,0.4)',
  fontSize: 12,
  marginRight: 6,
}

function issueList(title: string, issues: OkfIssue[], tone: 'error' | 'warning'): ReactNode {
  if (issues.length === 0) return null
  return (
    <div style={{
      margin: '8px 12px',
      padding: '8px 12px',
      borderRadius: 8,
      fontSize: 13,
      background: tone === 'error' ? 'rgba(220,60,60,0.12)' : 'rgba(220,160,40,0.12)',
      border: `1px solid ${tone === 'error' ? 'rgba(220,60,60,0.5)' : 'rgba(220,160,40,0.5)'}`,
    }}>
      <strong>{title}</strong>
      <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
        {issues.map((issue, index) => <li key={index}><code>{issue.field}</code> {issue.message}</li>)}
      </ul>
    </div>
  )
}

function TreeView(props: {
  nodes: TreeNode[]
  depth: number
  selected: string | undefined
  onSelect: (path: string) => void
}): ReactNode {
  return (
    <div>
      {props.nodes.map((node) => (
        <div key={node.path}>
          <div
            role={node.kind === 'file' ? 'button' : undefined}
            onClick={node.kind === 'file' ? () => props.onSelect(node.path) : undefined}
            style={{
              padding: '3px 6px',
              paddingLeft: 6 + props.depth * 14,
              cursor: node.kind === 'file' ? 'pointer' : 'default',
              borderRadius: 6,
              fontSize: 13,
              opacity: node.kind === 'dir' ? 0.75 : 1,
              fontWeight: node.kind === 'dir' ? 600 : 400,
              background: props.selected === node.path ? 'rgba(100,140,255,0.18)' : undefined,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {node.kind === 'dir' ? `📁 ${node.name}` : node.name}
          </div>
          {node.children !== undefined && (
            <TreeView nodes={node.children} depth={props.depth + 1} selected={props.selected} onSelect={props.onSelect} />
          )}
        </div>
      ))}
    </div>
  )
}

interface EditorState {
  draft: string
  baseVersion: string | undefined
  creating: boolean
  path: string
}

export function createKnowledgePanel(t: Translate) {
  function FileView(props: { record: FileRecord; onEdit: () => void }): ReactNode {
    const [tab, setTab] = useState<'preview' | 'source'>('preview')
    const meta = props.record.validation.meta
    return (
      <>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(128,128,128,0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 14 }}>{meta?.title ?? props.record.path}</strong>
            {meta?.type !== undefined && <span style={chipStyle}>{meta.type}</span>}
            <span style={{ flex: 1 }} />
            <Button onClick={() => setTab('preview')} variant={tab === 'preview' ? 'primary' : 'ghost'}>{t('tab.preview')}</Button>
            <Button onClick={() => setTab('source')} variant={tab === 'source' ? 'primary' : 'ghost'}>{t('tab.source')}</Button>
            <Button onClick={props.onEdit}>{t('tab.edit')}</Button>
          </div>
          {meta?.description !== undefined && meta.description !== '' && (
            <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>{meta.description}</div>
          )}
        </div>
        {issueList(t('file.errors'), props.record.validation.errors, 'error')}
        {issueList(t('file.warnings'), props.record.validation.warnings, 'warning')}
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 16px' }}>
          {tab === 'preview'
            ? (
                <>
                  {props.record.frontmatterText !== '' && (
                    <CodeBlock code={props.record.frontmatterText.trimEnd()} lang="yaml" />
                  )}
                  <MarkdownText text={props.record.body} />
                </>
              )
            : <CodeBlock code={props.record.raw} lang="markdown" />}
        </div>
      </>
    )
  }

  function Editor(props: {
    state: EditorState
    saving: boolean
    error: { kind: 'conflict' | 'invalid' | 'other'; message: string; issues?: OkfIssue[] } | undefined
    onChange: (draft: string) => void
    onSave: () => void
    onCancel: () => void
    onReload: () => void
  }): ReactNode {
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid rgba(128,128,128,0.2)' }}>
          <strong style={{ fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{props.state.path}</strong>
          <Button onClick={props.onCancel} variant="ghost">{t('edit.cancel')}</Button>
          <Button onClick={props.onSave} variant="primary">
            {props.saving ? t('edit.saving') : t('edit.save')}
          </Button>
        </div>
        {props.error !== undefined && props.error.kind === 'conflict' && (
          <div style={{ margin: '8px 12px', padding: '8px 12px', borderRadius: 8, fontSize: 13, background: 'rgba(220,60,60,0.12)', border: '1px solid rgba(220,60,60,0.5)' }}>
            {t('edit.conflict')}{' '}
            <Button onClick={props.onReload} variant="ghost">{t('edit.reload')}</Button>
          </div>
        )}
        {props.error !== undefined && props.error.kind === 'invalid'
          && issueList(t('edit.invalid'), props.error.issues ?? [], 'error')}
        {props.error !== undefined && props.error.kind === 'other' && (
          <div style={{ margin: '8px 12px', padding: '8px 12px', borderRadius: 8, fontSize: 13, background: 'rgba(220,60,60,0.12)', border: '1px solid rgba(220,60,60,0.5)' }}>
            {t('edit.failed', { message: props.error.message })}
          </div>
        )}
        <textarea
          value={props.state.draft}
          onChange={(event) => props.onChange(event.target.value)}
          spellCheck={false}
          style={{
            flex: 1,
            margin: 12,
            padding: 12,
            borderRadius: 8,
            border: '1px solid rgba(128,128,128,0.35)',
            background: 'transparent',
            color: 'inherit',
            font: '13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
            resize: 'none',
          }}
        />
      </>
    )
  }

  function NewEntryForm(props: { onCreate: (path: string, type: string, title: string) => void; onCancel: () => void }): ReactNode {
    const [path, setPath] = useState('')
    const [type, setType] = useState('')
    const [title, setTitle] = useState('')
    const valid = /^[^/\\][^\\]*\.md$/.test(path) && !path.includes('..') && type.trim() !== '' && title.trim() !== ''
    const inputStyle: CSSProperties = {
      padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(128,128,128,0.35)',
      background: 'transparent', color: 'inherit', fontSize: 13, width: '100%',
    }
    return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 480 }}>
        <input style={inputStyle} placeholder={t('new.path')} value={path} onChange={(event) => setPath(event.target.value)} />
        <input style={inputStyle} placeholder={t('new.type')} value={type} onChange={(event) => setType(event.target.value)} />
        <input style={inputStyle} placeholder={t('new.title')} value={title} onChange={(event) => setTitle(event.target.value)} />
        {!valid && path !== '' && <div style={{ fontSize: 12, opacity: 0.7 }}>{t('new.invalidPath')}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" onClick={() => valid && props.onCreate(path, type.trim(), title.trim())}>{t('new.create')}</Button>
          <Button variant="ghost" onClick={props.onCancel}>{t('new.cancel')}</Button>
        </div>
      </div>
    )
  }

  return function KnowledgePanel(props: { wide: boolean }): ReactNode {
    const [open, setOpen] = useState(false)
    const [scopes, setScopes] = useState<ScopeView[] | undefined>(undefined)
    const [scopesError, setScopesError] = useState<string | undefined>(undefined)
    const [scopeId, setScopeId] = useState<string | undefined>(undefined)
    const [tree, setTree] = useState<TreeNode[]>([])
    const [bundleExists, setBundleExists] = useState(true)
    const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined)
    const [record, setRecord] = useState<FileRecord | undefined>(undefined)
    const [loading, setLoading] = useState(false)
    const [editor, setEditor] = useState<EditorState | undefined>(undefined)
    const [creatingNew, setCreatingNew] = useState(false)
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState<{ kind: 'conflict' | 'invalid' | 'other'; message: string; issues?: OkfIssue[] } | undefined>(undefined)

    const scope = useMemo(() => scopes?.find((entry) => entry.id === scopeId), [scopes, scopeId])

    const refreshScopes = useCallback(() => {
      setScopesError(undefined)
      api.scopes()
        .then(({ scopes: list }) => {
          setScopes(list)
          setScopeId((current) => current !== undefined && list.some((entry) => entry.id === current)
            ? current
            : list[0]?.id)
        })
        .catch((error: unknown) => setScopesError(error instanceof Error ? error.message : String(error)))
    }, [])

    const refreshTree = useCallback((id: string) => {
      api.tree(id)
        .then((result) => {
          setTree(result.tree)
          setBundleExists(result.exists)
        })
        .catch(() => {
          setTree([])
          setBundleExists(false)
        })
    }, [])

    useEffect(() => {
      if (open) refreshScopes()
    }, [open, refreshScopes])

    useEffect(() => {
      if (open && scopeId !== undefined) {
        setSelectedPath(undefined)
        setRecord(undefined)
        setEditor(undefined)
        setCreatingNew(false)
        refreshTree(scopeId)
      }
    }, [open, scopeId, refreshTree])

    const loadFile = useCallback((path: string) => {
      if (scopeId === undefined) return
      setSelectedPath(path)
      setEditor(undefined)
      setCreatingNew(false)
      setSaveError(undefined)
      setLoading(true)
      api.file(scopeId, path)
        .then(setRecord)
        .catch(() => setRecord(undefined))
        .finally(() => setLoading(false))
    }, [scopeId])

    const startEdit = useCallback(() => {
      if (record === undefined) return
      setSaveError(undefined)
      setEditor({ draft: record.raw, baseVersion: record.version, creating: false, path: record.path })
    }, [record])

    const startCreate = useCallback((path: string, type: string, title: string) => {
      const now = new Date().toISOString()
      const template = [
        '---',
        `type: ${type}`,
        `title: ${title}`,
        'description: ',
        'sources:',
        '  - resource: ',
        'generated:',
        `  by: human:web-editor`,
        `  at: ${now}`,
        '---',
        '',
        `# ${title}`,
        '',
      ].join('\n')
      setCreatingNew(false)
      setSelectedPath(path)
      setRecord(undefined)
      setSaveError(undefined)
      setEditor({ draft: template, baseVersion: undefined, creating: true, path })
    }, [])

    const save = useCallback(() => {
      if (editor === undefined || scopeId === undefined || saving) return
      setSaving(true)
      setSaveError(undefined)
      api.save({
        scope: scopeId,
        path: editor.path,
        content: editor.draft,
        ...(editor.baseVersion === undefined ? {} : { baseVersion: editor.baseVersion }),
      })
        .then(() => {
          setEditor(undefined)
          refreshTree(scopeId)
          loadFile(editor.path)
        })
        .catch((error: unknown) => {
          if (error instanceof ApiError && error.code === 'conflict') {
            setSaveError({ kind: 'conflict', message: error.message })
          } else if (error instanceof ApiError && error.code === 'invalid-content') {
            setSaveError({ kind: 'invalid', message: error.message, issues: (error.details as OkfIssue[] | undefined) ?? [] })
          } else {
            setSaveError({ kind: 'other', message: error instanceof Error ? error.message : String(error) })
          }
        })
        .finally(() => setSaving(false))
    }, [editor, scopeId, saving, refreshTree, loadFile])

    const reloadAfterConflict = useCallback(() => {
      if (editor === undefined || scopeId === undefined) return
      api.file(scopeId, editor.path).then((fresh) => {
        setRecord(fresh)
        setEditor({ draft: fresh.raw, baseVersion: fresh.version, creating: false, path: fresh.path })
        setSaveError(undefined)
      }).catch(() => {})
    }, [editor, scopeId])

    const buttonLabel = props.wide ? `📚 ${t('entry.label')}` : '📚'

    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={t('entry.label')}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: props.wide ? '6px 10px' : '6px 0', justifyContent: props.wide ? 'flex-start' : 'center',
            border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer',
            borderRadius: 8, fontSize: 13,
          }}
        >
          {buttonLabel}
        </button>
        {open && (
          <>
            <div style={backdropStyle} onClick={() => setOpen(false)} />
            <div style={panelStyle} role="dialog" aria-label={t('panel.title')}>
              <div style={headerStyle}>
                <strong>{t('panel.title')}</strong>
                <span style={{ fontSize: 13, opacity: 0.7 }}>{t('panel.scope')}</span>
                <select
                  value={scopeId ?? ''}
                  onChange={(event) => setScopeId(event.target.value)}
                  style={{ fontSize: 13, padding: '4px 8px', borderRadius: 6, background: 'transparent', color: 'inherit', border: '1px solid rgba(128,128,128,0.35)' }}
                >
                  {(scopes ?? []).map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.kind === 'project' ? `📁 ${entry.label}` : `🌐 ${entry.label}`}
                    </option>
                  ))}
                </select>
                <span style={{ flex: 1 }} />
                {scope !== undefined && bundleExists && (
                  <>
                    <Button variant="ghost" onClick={() => { setCreatingNew(true); setEditor(undefined) }}>{t('panel.newEntry')}</Button>
                    <Button
                      variant="ghost"
                      onClick={() => { if (scopeId !== undefined) api.reindex(scopeId).then(() => refreshTree(scopeId)).catch(() => {}) }}
                    >
                      {t('panel.reindex')}
                    </Button>
                  </>
                )}
                <Button variant="ghost" onClick={() => setOpen(false)}>{t('panel.close')}</Button>
              </div>
              {scopesError !== undefined && (
                <div style={{ padding: 16, fontSize: 13 }}>{t('panel.scopes.failed', { message: scopesError })}</div>
              )}
              <div style={bodyStyle}>
                <div style={treeColumnStyle}>
                  {!bundleExists && scope !== undefined
                    ? (
                        <div style={{ padding: 8, fontSize: 13 }}>
                          <p>{t('panel.empty')}</p>
                          <Button
                            variant="primary"
                            onClick={() => { if (scopeId !== undefined) api.init(scopeId).then(() => refreshTree(scopeId)).catch(() => {}) }}
                          >
                            {t('panel.init')}
                          </Button>
                        </div>
                      )
                    : <TreeView nodes={tree} depth={0} selected={selectedPath} onSelect={loadFile} />}
                </div>
                <div style={mainColumnStyle}>
                  {creatingNew
                    ? <NewEntryForm onCreate={startCreate} onCancel={() => setCreatingNew(false)} />
                    : editor !== undefined
                      ? (
                          <Editor
                            state={editor}
                            saving={saving}
                            error={saveError}
                            onChange={(draft) => setEditor({ ...editor, draft })}
                            onSave={save}
                            onCancel={() => { setEditor(undefined); setSaveError(undefined) }}
                            onReload={reloadAfterConflict}
                          />
                        )
                      : loading
                        ? <div style={{ padding: 16, fontSize: 13 }}>{t('panel.loading')}</div>
                        : record !== undefined
                          ? <FileView record={record} onEdit={startEdit} />
                          : <div style={{ padding: 16, fontSize: 13, opacity: 0.7 }}>{t('panel.noSelection')}</div>}
                </div>
              </div>
            </div>
          </>
        )}
      </>
    )
  }
}
