/**
 * Bash-command approval interception decision logic.
 *
 * Mirror image of `./guard.ts` (edit approval): pure functions only — given
 * the plugin settings and the tool call, decide whether the command may run
 * untouched (`pass`) or must go through the approval panel (`ask` with a
 * reason that carries the model's own description plus the verbatim command).
 *
 * Deliberately fs-free: unlike edits, judging a command needs no file state.
 *
 * Compatibility contract (see also the namespace schema in `./index.ts`):
 * - the `allow` list is LOCKED to prefix matching over whitespace-normalized
 *   commands; extending it (e.g. regex rules) must add a NEW field, never
 *   change this semantic;
 * - settings fields may only be added (with defaults), never removed or
 *   reinterpreted.
 *
 * @module dsh-edit-approval/bash-guard
 */

import type { GuardResult } from './guard.ts'

/** Fully resolved bash-approval settings (schema defaults + row config + user layer). */
export interface BashApprovalSettings {
  /** Master switch; off means commands execute without asking. */
  enabled: boolean
  /** Whitelist of intercepted tool names (default `['bash']`). */
  tools: readonly string[]
  /** Always-allow command prefixes; matched after whitespace normalization. */
  allow: readonly string[]
}

export interface BashGuardInput {
  readonly settings: BashApprovalSettings
  readonly toolName: string
  readonly args: Readonly<Record<string, unknown>>
}

/**
 * Normalize a command for allow matching: trim the edges and collapse every
 * run of whitespace (including newlines and tabs) into a single space, so a
 * model cannot bypass an `allow` prefix by varying spacing (`git  push`
 * matches `git push`). Idempotent.
 */
export function normalizeCommand(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

/**
 * Whether a normalized command starts with any non-empty allow prefix. Both
 * the command and each pattern are whitespace-normalized here, so callers may
 * pass raw text safely; empty patterns are skipped.
 */
export function matchesAllow(command: string, allow: readonly string[]): boolean {
  const normalized = normalizeCommand(command)
  for (const pattern of allow) {
    const candidate = normalizeCommand(pattern)
    if (candidate.length === 0) continue
    if (normalized.startsWith(candidate)) return true
  }
  return false
}

/**
 * Whether the call requests a sandbox escalation: both `sandbox_permissions`
 * and `justification` must be present and non-blank. Such calls are left to
 * the tool's own escalation approval (one prompt, not two).
 */
export function isEscalation(args: Readonly<Record<string, unknown>>): boolean {
  return typeof args.sandbox_permissions === 'string' && args.sandbox_permissions.trim().length > 0
    && typeof args.justification === 'string' && args.justification.trim().length > 0
}

/**
 * Build the approval reason: a header line mirroring the edit header
 * (`tool · subject`), the verbatim command, and an optional flags line.
 * The command is shown EXACTLY as the model submitted it (whitespace intact)
 * — that is the text the user must judge; normalization is for matching only.
 */
export function formatBashReason(
  description: unknown,
  command: string,
  args: Readonly<Record<string, unknown>>,
): string {
  const header = typeof description === 'string' && description.trim().length > 0
    ? `bash · ${description}`
    : 'bash'
  const flags: string[] = []
  if (typeof args.workdir === 'string' && args.workdir.trim().length > 0) {
    flags.push(`workdir: ${args.workdir}`)
  }
  if (args.run_in_background === true) flags.push('background')
  if (typeof args.timeoutMs === 'number' && Number.isFinite(args.timeoutMs)) {
    flags.push(`timeout ${args.timeoutMs}ms`)
  }
  const parts = [header, `$ ${command}`]
  if (flags.length > 0) parts.push(flags.join(' · '))
  return parts.join('\n')
}

/**
 * Decide whether one bash-family call must be approved.
 *
 * `pass` covers every case that should not block the call: disabled, tool not
 * whitelisted, a sandbox-escalation call (the escalation approval gates it),
 * a missing/blank command (the tool fails on its own), and an allow-listed
 * command. `ask` carries the reason the approval panel headlines.
 */
export function decideCommandApproval(input: BashGuardInput): GuardResult {
  const { settings, toolName, args } = input
  if (!settings.enabled) return { kind: 'pass' }
  if (!settings.tools.includes(toolName)) return { kind: 'pass' }
  if (isEscalation(args)) return { kind: 'pass' }
  const command = args.command
  if (typeof command !== 'string') return { kind: 'pass' }
  if (normalizeCommand(command).length === 0) return { kind: 'pass' }
  if (matchesAllow(command, settings.allow)) return { kind: 'pass' }
  return { kind: 'ask', reason: formatBashReason(args.description, command, args) }
}
