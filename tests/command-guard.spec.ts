import { describe, expect, it } from 'vitest'
import {
  decideCommandApproval,
  normalizeCommand,
  matchesAllow,
  isEscalation,
  formatBashReason,
  type BashApprovalSettings,
} from '../src/bash-guard.ts'

function settings(overrides: Partial<BashApprovalSettings> = {}): BashApprovalSettings {
  return {
    enabled: true,
    tools: ['bash'],
    allow: [],
    ...overrides,
  }
}

describe('normalizeCommand', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizeCommand('  git status  ')).toBe('git status')
  })

  it('collapses internal runs of whitespace including newlines', () => {
    expect(normalizeCommand('git  push\nowner  main')).toBe('git push owner main')
    expect(normalizeCommand('echo\thi')).toBe('echo hi')
  })

  it('is idempotent', () => {
    expect(normalizeCommand(normalizeCommand('a  b\n c'))).toBe(normalizeCommand('a  b\n c'))
  })
})

describe('matchesAllow', () => {
  it('matches a command prefix', () => {
    expect(matchesAllow('git status --short', ['git status'])).toBe(true)
    expect(matchesAllow('git status --short', ['git'])).toBe(true)
    expect(matchesAllow('git push', ['git status'])).toBe(false)
  })

  it('is immune to whitespace variation (git  push hits git push)', () => {
    expect(matchesAllow('git  push origin main', ['git push'])).toBe(true)
    expect(matchesAllow('git push\norigin', ['git push origin'])).toBe(true)
  })

  it('skips empty patterns', () => {
    expect(matchesAllow('git status --short', ['', 'git status'])).toBe(true)
    expect(matchesAllow('anything', ['   '])).toBe(false)
  })

  it('returns false for an empty allow list', () => {
    expect(matchesAllow('git status', [])).toBe(false)
  })
})

describe('isEscalation', () => {
  it('requires both sandbox_permissions and justification non-empty', () => {
    expect(isEscalation({ sandbox_permissions: 'danger-full-access', justification: 'why' })).toBe(true)
    expect(isEscalation({ sandbox_permissions: 'danger-full-access' })).toBe(false)
    expect(isEscalation({ justification: 'why' })).toBe(false)
    expect(isEscalation({ sandbox_permissions: '  ', justification: 'why' })).toBe(false)
    expect(isEscalation({ sandbox_permissions: 'danger-full-access', justification: '' })).toBe(false)
    expect(isEscalation({})).toBe(false)
  })
})

describe('decideCommandApproval', () => {
  it('passes when disabled', () => {
    const result = decideCommandApproval({
      settings: settings({ enabled: false }),
      toolName: 'bash',
      args: { command: 'git push', description: 'push' },
    })
    expect(result).toEqual({ kind: 'pass' })
  })

  it('passes when the tool is not whitelisted', () => {
    const result = decideCommandApproval({
      settings: settings({ tools: ['bash_persistent'] }),
      toolName: 'bash',
      args: { command: 'git push', description: 'push' },
    })
    expect(result).toEqual({ kind: 'pass' })
  })

  it('passes on a sandbox-escalation call (the escalation approval gates it)', () => {
    const result = decideCommandApproval({
      settings: settings(),
      toolName: 'bash',
      args: {
        command: 'rm -rf /etc',
        description: 'cleanup',
        sandbox_permissions: 'danger-full-access',
        justification: 'test cleanup',
      },
    })
    expect(result).toEqual({ kind: 'pass' })
  })

  it('passes when command is missing or blank (the tool fails on its own)', () => {
    expect(decideCommandApproval({ settings: settings(), toolName: 'bash', args: {} })).toEqual({ kind: 'pass' })
    expect(decideCommandApproval({ settings: settings(), toolName: 'bash', args: { command: 42, description: 'x' } })).toEqual({ kind: 'pass' })
    expect(decideCommandApproval({ settings: settings(), toolName: 'bash', args: { command: '   ', description: 'x' } })).toEqual({ kind: 'pass' })
  })

  it('passes when the command matches the allow list', () => {
    const result = decideCommandApproval({
      settings: settings({ allow: ['git status'] }),
      toolName: 'bash',
      args: { command: 'git status --short', description: 'show status' },
    })
    expect(result).toEqual({ kind: 'pass' })
  })

  it('asks for a non-allow-listed command', () => {
    const result = decideCommandApproval({
      settings: settings(),
      toolName: 'bash',
      args: { command: 'git push origin main', description: 'push to remote' },
    })
    expect(result.kind).toBe('ask')
    if (result.kind !== 'ask') return
    // The reason headlines the description only — the panel renders the
    // command natively, so it must NOT be repeated inside the reason.
    expect(result.reason).toMatch(/^bash · push to remote$/m)
    expect(result.reason).not.toContain('$ ')
  })
})

describe('formatBashReason', () => {
  it('shows the header and no flags line when absent', () => {
    expect(formatBashReason('greet', {})).toBe('bash · greet')
  })

  it('appends a flags line only for present flags', () => {
    const reason = formatBashReason('deploy', {
      workdir: '/home/slev/workspace/projects/foo',
      run_in_background: true,
      timeoutMs: 60000,
    })
    expect(reason).toBe(
      'bash · deploy\nworkdir: /home/slev/workspace/projects/foo · background · timeout 60000ms',
    )
  })

  it('flags line omits absent flags', () => {
    expect(formatBashReason('deploy', { run_in_background: true })).toBe('bash · deploy\nbackground')
  })

  it('never embeds the command text (the panel renders it natively)', () => {
    const reason = formatBashReason('push', { timeoutMs: 60000 })
    expect(reason).not.toContain('$ ')
    expect(reason).not.toContain('git')
  })

  it('degrades the header when description is missing or blank', () => {
    expect(formatBashReason(undefined, {})).toBe('bash')
    expect(formatBashReason('   ', {})).toBe('bash')
  })
})
