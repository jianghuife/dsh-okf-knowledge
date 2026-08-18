import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  contentVersion, initBundle, listTree, readConcept, regenerateIndex,
  searchBundle, StoreError, writeConcept,
} from '../src/store.js'
import { resolveWithin } from '../src/scope.js'

const CONCEPT = `---
type: Decision
title: Use PostgreSQL
description: Chosen for transactional integrity.
tags: [database, architecture]
sources:
  - resource: docs/adr/0007.md
---

# Use PostgreSQL

We selected PostgreSQL over DynamoDB.
`

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-okf-knowledge-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('resolveWithin', () => {
  it('rejects escapes and absolute paths', () => {
    expect(resolveWithin('/tmp/kb', '../evil.md')).toBeUndefined()
    expect(resolveWithin('/tmp/kb', 'a/../../evil.md')).toBeUndefined()
    expect(resolveWithin('/tmp/kb', '/etc/passwd')).toBeUndefined()
    expect(resolveWithin('/tmp/kb', '')).toBeUndefined()
    expect(resolveWithin('/tmp/kb', 'a/b.md')).toBe('/tmp/kb/a/b.md')
  })
})

describe('writeConcept / readConcept', () => {
  it('creates, reads, and versions a concept', async () => {
    const written = await writeConcept(root, 'decisions/postgres.md', { content: CONCEPT })
    expect(written.version).toBe(contentVersion(CONCEPT))
    const record = await readConcept(root, 'decisions/postgres.md')
    expect(record.raw).toBe(CONCEPT)
    expect(record.validation.ok).toBe(true)
  })

  it('refuses to overwrite without a base version', async () => {
    await writeConcept(root, 'a.md', { content: CONCEPT })
    await expect(writeConcept(root, 'a.md', { content: CONCEPT })).rejects.toMatchObject({ code: 'exists' })
  })

  it('detects concurrent edits', async () => {
    const first = await writeConcept(root, 'a.md', { content: CONCEPT })
    await writeConcept(root, 'a.md', { content: `${CONCEPT}\nMore.\n`, baseVersion: first.version })
    const staleEdit = CONCEPT.replace('transactional integrity', 'a stale reason')
    await expect(
      writeConcept(root, 'a.md', { content: staleEdit, baseVersion: first.version }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('rejects invalid OKF content', async () => {
    await expect(writeConcept(root, 'bad.md', { content: '# no frontmatter' }))
      .rejects.toMatchObject({ code: 'invalid-content' })
  })

  it('rejects path traversal', async () => {
    await expect(writeConcept(root, '../escape.md', { content: CONCEPT }))
      .rejects.toBeInstanceOf(StoreError)
  })
})

describe('bundle lifecycle', () => {
  it('initializes idempotently and lists the tree', async () => {
    await initBundle(root, 'Test Knowledge')
    await initBundle(root, 'Test Knowledge')
    await writeConcept(root, 'decisions/postgres.md', { content: CONCEPT })
    const tree = await listTree(root)
    const names = tree.map((node) => node.name)
    expect(names).toContain('index.md')
    expect(names).toContain('log.md')
    expect(names).toContain('decisions')
    const index = await readFile(join(root, 'index.md'), 'utf8')
    expect(index).toContain('okf_version')
  })

  it('regenerates the index from concepts', async () => {
    await initBundle(root, 'Test Knowledge')
    await writeConcept(root, 'decisions/postgres.md', { content: CONCEPT })
    const content = await regenerateIndex(root, 'Test Knowledge')
    expect(content).toContain('[Use PostgreSQL](/decisions/postgres.md)')
    expect(content).toContain('## decisions')
  })
})

describe('searchBundle', () => {
  it('finds concepts by field-weighted tokens', async () => {
    await writeConcept(root, 'decisions/postgres.md', { content: CONCEPT })
    await writeConcept(root, 'runbooks/deploy.md', {
      content: '---\ntype: Runbook\ntitle: Deploy the service\ndescription: Steps to deploy.\nsources:\n  - resource: ci.md\n---\n\nRun the pipeline.\n',
    })
    const hits = await searchBundle(root, 'postgresql database')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.path).toBe('decisions/postgres.md')
    const none = await searchBundle(root, 'zzzunknown')
    expect(none).toEqual([])
  })

  it('excludes reserved files from search', async () => {
    await initBundle(root, 'Reserved Test')
    await writeConcept(root, 'a.md', { content: CONCEPT })
    const hits = await searchBundle(root, 'knowledge')
    expect(hits.every((hit) => hit.path !== 'index.md' && hit.path !== 'log.md')).toBe(true)
  })
})
