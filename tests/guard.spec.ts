import { describe, expect, it } from 'vitest'
import {
  decideApproval,
  targetPathOf,
  proposeContent,
  countOccurrences,
  formatReason,
  DEFAULT_TOOLS,
  type EditApprovalSettings,
} from '../src/guard.ts'

function settings(overrides: Partial<EditApprovalSettings> = {}): EditApprovalSettings {
  return {
    enabled: true,
    tools: [...DEFAULT_TOOLS],
    minDiffLines: 0,
    includeCreate: true,
    includeDelete: true,
    ...overrides,
  }
}

describe('targetPathOf', () => {
  it('reads file_path for write/edit and path for str_replace_editor', () => {
    expect(targetPathOf('write', { file_path: 'src/a.ts', content: '' })).toBe('src/a.ts')
    expect(targetPathOf('edit', { file_path: 'src/a.ts' })).toBe('src/a.ts')
    expect(targetPathOf('str_replace_editor', { path: '/x/y.ts' })).toBe('/x/y.ts')
  })

  it('returns undefined for blank or missing paths and unknown tools', () => {
    expect(targetPathOf('write', { file_path: '  ' })).toBeUndefined()
    expect(targetPathOf('write', {})).toBeUndefined()
    expect(targetPathOf('bash', { command: 'echo hi' })).toBeUndefined()
  })
})

describe('countOccurrences', () => {
  it('counts non-overlapping matches', () => {
    expect(countOccurrences('aaa', 'aa')).toBe(1)
    expect(countOccurrences('abab', 'ab')).toBe(2)
    expect(countOccurrences('abc', 'z')).toBe(0)
    expect(countOccurrences('abc', '')).toBe(0)
  })
})

describe('proposeContent', () => {
  it('write replaces the whole file', () => {
    expect(proposeContent('write', { content: 'new' }, 'old')).toEqual({ proposed: 'new' })
  })

  it('edit replaces the single occurrence', () => {
    expect(proposeContent('edit', { old_string: 'a', new_string: 'b' }, 'xa x')).toEqual({ proposed: 'xb x' })
  })

  it('edit with replace_all replaces every occurrence', () => {
    expect(proposeContent('edit', { old_string: 'a', new_string: 'b', replace_all: true }, 'a a a')).toEqual({ proposed: 'b b b' })
  })

  it('edit with a missing old_string is a no-op with a note', () => {
    const result = proposeContent('edit', { old_string: 'zzz', new_string: 'b' }, 'abc')
    expect(result.proposed).toBe('abc')
    expect(result.note).toBeDefined()
  })

  it('edit with multiple matches and no replace_all is a no-op with a note', () => {
    const result = proposeContent('edit', { old_string: 'a', new_string: 'b' }, 'a a')
    expect(result.proposed).toBe('a a')
    expect(result.note).toMatch(/occurs 2 times/)
  })

  it('str_replace replaces the unique match', () => {
    expect(proposeContent('str_replace_editor', { command: 'str_replace', old_str: 'a', new_str: 'b' }, 'xa')).toEqual({ proposed: 'xb' })
  })

  it('str_replace with a non-unique match is a no-op with a note', () => {
    const result = proposeContent('str_replace_editor', { command: 'str_replace', old_str: 'a', new_str: 'b' }, 'a a')
    expect(result.proposed).toBe('a a')
    expect(result.note).toMatch(/unique/)
  })

  it('create uses file_text', () => {
    expect(proposeContent('str_replace_editor', { command: 'create', file_text: 'hello' }, '')).toEqual({ proposed: 'hello' })
  })

  it('insert inserts before the 0-based line index', () => {
    expect(proposeContent('str_replace_editor', { command: 'insert', insert_line: 1, new_str: 'mid' }, 'a\nc')).toEqual({
      proposed: 'a\nmid\nc',
    })
    expect(proposeContent('str_replace_editor', { command: 'insert', insert_line: 0, new_str: 'head' }, 'a\nc')).toEqual({
      proposed: 'head\na\nc',
    })
  })

  it('view is not an edit', () => {
    expect(proposeContent('str_replace_editor', { command: 'view', path: '/x' }, 'a')).toEqual({ proposed: 'a' })
  })
})

describe('decideApproval', () => {
  it('passes when disabled', () => {
    const result = decideApproval({ settings: settings({ enabled: false }), toolName: 'write', args: { file_path: 'a.ts' }, current: '', exists: false })
    expect(result).toEqual({ kind: 'pass' })
  })

  it('passes when the tool is not whitelisted', () => {
    const result = decideApproval({ settings: settings({ tools: ['edit'] }), toolName: 'write', args: { file_path: 'a.ts' }, current: '', exists: false })
    expect(result).toEqual({ kind: 'pass' })
  })

  it('passes on str_replace_editor view', () => {
    const result = decideApproval({ settings: settings(), toolName: 'str_replace_editor', args: { command: 'view', path: '/x' }, current: '', exists: false })
    expect(result).toEqual({ kind: 'pass' })
  })

  it('asks for a new-file write and honors includeCreate=false', () => {
    const args = { file_path: 'new.ts', content: 'export const x = 1\n' }
    expect(decideApproval({ settings: settings(), toolName: 'write', args, current: '', exists: false }).kind).toBe('ask')
    expect(decideApproval({ settings: settings({ includeCreate: false }), toolName: 'write', args, current: '', exists: false })).toEqual({ kind: 'pass' })
  })

  it('asks for a clearing write and honors includeDelete=false', () => {
    const args = { file_path: 'a.ts', content: '' }
    expect(decideApproval({ settings: settings(), toolName: 'write', args, current: 'stuff', exists: true }).kind).toBe('ask')
    expect(decideApproval({ settings: settings({ includeDelete: false }), toolName: 'write', args, current: 'stuff', exists: true })).toEqual({ kind: 'pass' })
  })

  it('passes below minDiffLines and asks at or above the threshold', () => {
    const args = { file_path: 'a.ts', old_string: 'a', new_string: 'b' }
    const current = 'a\nb\nc'
    // The replacement changes 2 lines: below the threshold → pass.
    expect(decideApproval({ settings: settings({ minDiffLines: 3 }), toolName: 'edit', args, current, exists: true })).toEqual({ kind: 'pass' })
    // Exactly at the threshold → ask.
    expect(decideApproval({ settings: settings({ minDiffLines: 2 }), toolName: 'edit', args, current, exists: true }).kind).toBe('ask')
  })

  it('passes on no-op edits', () => {
    const result = decideApproval({
      settings: settings(),
      toolName: 'edit',
      args: { file_path: 'a.ts', old_string: 'zzz', new_string: 'b' },
      current: 'abc',
      exists: true,
    })
    expect(result).toEqual({ kind: 'pass' })
  })

  it('passes when a create targets an existing file (tool fails on its own)', () => {
    const result = decideApproval({
      settings: settings(),
      toolName: 'str_replace_editor',
      args: { command: 'create', path: '/x', file_text: 'x' },
      current: 'existing',
      exists: true,
    })
    expect(result).toEqual({ kind: 'pass' })
  })

  it('ask reason carries the tool/file header and +/- markers', () => {
    const result = decideApproval({
      settings: settings(),
      toolName: 'edit',
      args: { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' },
      current: 'a\nc',
      exists: true,
    })
    expect(result.kind).toBe('ask')
    if (result.kind !== 'ask') return
    expect(result.reason.split('\n')[0]).toMatch(/^edit · src\/a\.ts \(modify\): 1 insertion, 1 deletion$/)
    // Line numbers ride the diff markers: removals read `-1 a`, additions `+1 b`.
    expect(result.reason).toMatch(/-\d+ a/)
    expect(result.reason).toMatch(/\+\d+ b/)
  })
})

describe('formatReason', () => {
  it('pluralizes the summary', () => {
    const reason = formatReason('write', 'x.ts', 'create', [
      { type: 'add', text: 'a', newLine: 1 },
      { type: 'add', text: 'b', newLine: 2 },
    ])
    expect(reason.split('\n')[0]).toBe('write · x.ts (create): 2 insertions, 0 deletions')
  })
})
