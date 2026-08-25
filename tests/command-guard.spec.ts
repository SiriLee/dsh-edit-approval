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
    expect(result.reason).toMatch(/^bash · push to remote$/m)
    expect(result.reason).toContain('$ git push origin main')
  })
})

describe('formatBashReason', () => {
  it('shows the header, the verbatim command, and no flags line when absent', () => {
    const reason = formatBashReason('greet', 'echo  hi', {})
    expect(reason).toBe('bash · greet\n$ echo  hi')
  })

  it('keeps the command verbatim (whitespace intact) even when it differs from the normalized form', () => {
    const reason = formatBashReason('push', 'git  push\norigin', {})
    expect(reason).toContain('$ git  push\norigin')
  })

  it('appends a flags line only for present flags', () => {
    const reason = formatBashReason('deploy', 'npm run deploy', {
      workdir: '/home/slev/workspace/projects/foo',
      run_in_background: true,
      timeoutMs: 60000,
    })
    expect(reason).toBe(
      'bash · deploy\n$ npm run deploy\nworkdir: /home/slev/workspace/projects/foo · background · timeout 60000ms',
    )
  })

  it('flags line omits absent flags', () => {
    const reason = formatBashReason('deploy', 'npm run deploy', { run_in_background: true })
    expect(reason).toBe('bash · deploy\n$ npm run deploy\nbackground')
  })

  it('degrades the header when description is missing or blank', () => {
    expect(formatBashReason(undefined, 'ls', {})).toBe('bash\n$ ls')
    expect(formatBashReason('   ', 'ls', {})).toBe('bash\n$ ls')
  })
})
