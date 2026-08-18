import { describe, expect, it } from 'vitest'
import {
  appendLogEntry, bundleIndexTemplate, conceptTemplate, splitFrontmatter,
  trustTier, validateConcept,
} from '../src/okf.js'

const VALID = `---
type: Decision
title: Use PostgreSQL
description: Chosen for transactional integrity.
tags: [database]
sources:
  - resource: docs/adr/0007.md
generated:
  by: agent/model-1
  at: 2026-08-18T10:00:00Z
verified:
  - by: human:alice
    at: 2026-08-18T11:00:00Z
status: stable
---

# Use PostgreSQL

Body text.
`

describe('splitFrontmatter', () => {
  it('splits frontmatter and body', () => {
    const split = splitFrontmatter(VALID)
    expect(split.hasFrontmatter).toBe(true)
    expect(split.frontmatterText).toContain('type: Decision')
    expect(split.body).toContain('# Use PostgreSQL')
  })

  it('treats missing frontmatter as body-only', () => {
    const split = splitFrontmatter('# Just a doc\n')
    expect(split.hasFrontmatter).toBe(false)
    expect(split.body).toBe('# Just a doc\n')
  })
})

describe('validateConcept', () => {
  it('accepts a complete concept', () => {
    const result = validateConcept(VALID)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.trust).toBe('human-reviewed')
    expect(result.meta?.type).toBe('Decision')
  })

  it('requires type on concepts', () => {
    const result = validateConcept('---\ntitle: X\n---\nbody')
    expect(result.ok).toBe(false)
    expect(result.errors.some((issue) => issue.field === 'type')).toBe(true)
  })

  it('requires frontmatter on concepts', () => {
    const result = validateConcept('# no frontmatter')
    expect(result.ok).toBe(false)
  })

  it('exempts reserved files from the type requirement', () => {
    expect(validateConcept('# Index\n', { fileName: 'index.md' }).ok).toBe(true)
    expect(validateConcept('---\nokf_version: "0.2"\n---\n# Index\n', { fileName: 'index.md' }).ok).toBe(true)
    expect(validateConcept('# Log\n', { fileName: 'log.md' }).ok).toBe(true)
  })

  it('rejects malformed fields', () => {
    const result = validateConcept('---\ntype: X\ntags: nope\nstatus: wip\nstale_after: soon\nsources:\n  - title: no-resource\n---\nbody')
    const fields = result.errors.map((issue) => issue.field)
    expect(fields).toContain('tags')
    expect(fields).toContain('status')
    expect(fields).toContain('stale_after')
    expect(fields.some((field) => field.startsWith('sources[0]'))).toBe(true)
  })

  it('treats a bare verified mapping as a one-element list', () => {
    const result = validateConcept('---\ntype: X\nverified:\n  by: human:bob\n  at: 2026-01-01T00:00:00Z\n---\nbody')
    expect(result.ok).toBe(true)
    expect(result.trust).toBe('human-reviewed')
  })

  it('warns on staleness and drafts', () => {
    const result = validateConcept(
      '---\ntype: X\ntitle: T\ndescription: D\nstatus: draft\nstale_after: 2026-01-01\nsources:\n  - resource: a.md\n---\nbody',
      { today: '2026-08-18' },
    )
    expect(result.ok).toBe(true)
    const fields = result.warnings.map((issue) => issue.field)
    expect(fields).toContain('status')
    expect(fields).toContain('stale_after')
  })

  it('preserves unknown keys as extensions', () => {
    const result = validateConcept('---\ntype: X\nmyorg:\n  policy: strict\n---\nbody')
    expect(result.ok).toBe(true)
    expect(result.meta?.extra.myorg).toEqual({ policy: 'strict' })
  })
})

describe('trustTier', () => {
  it('derives tiers from actors', () => {
    expect(trustTier(undefined)).toBe('unverified')
    expect(trustTier([])).toBe('unverified')
    expect(trustTier([{ by: 'agent/x', at: '2026-01-01T00:00:00Z' }])).toBe('machine-confirmed')
    expect(trustTier([{ by: 'human:a', at: '2026-01-01T00:00:00Z' }])).toBe('human-reviewed')
  })
})

describe('templates', () => {
  it('concept template validates as stable', () => {
    const raw = conceptTemplate({ type: 'Runbook', title: 'Restart the queue', generatedBy: 'agent/test' })
    const result = validateConcept(raw)
    expect(result.errors.filter((issue) => !issue.field.startsWith('sources'))).toEqual([])
    expect(result.meta?.status).toBe('stable')
  })

  it('bundle index template carries okf_version', () => {
    expect(bundleIndexTemplate('X')).toContain('okf_version: "0.2"')
  })
})

describe('appendLogEntry', () => {
  it('creates a new date section at the top', () => {
    const next = appendLogEntry('# Log\n\n## 2026-08-01\n\n- old\n', '2026-08-18', '**Update** something')
    expect(next.indexOf('2026-08-18')).toBeLessThan(next.indexOf('2026-08-01'))
    expect(next).toContain('- **Update** something')
  })

  it('prepends into an existing date section', () => {
    const next = appendLogEntry('# Log\n\n## 2026-08-18\n\n- earlier\n', '2026-08-18', 'later')
    expect(next.indexOf('- later')).toBeLessThan(next.indexOf('- earlier'))
  })
})
