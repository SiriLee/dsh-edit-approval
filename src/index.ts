/**
 * dsh-edit-approval — host half.
 *
 * Two mirror-image approval features on the `tools/pre-execute` waterfall:
 *
 * 1. **edit approval** (`edit-approval` namespace, `/approval-edit` command) —
 *    intercepts `write` / `edit` / `str_replace_editor`, reads the target
 *    file's current content, computes a line-level diff against the proposed
 *    content, and returns `{ kind: 'ask', reason }` when a human decision is
 *    needed (see `./guard.ts`).
 * 2. **bash approval** (`bash-approval` namespace, `/approval-bash` command) —
 *    intercepts `bash` (whitelisted by `tools`), asks for every command that
 *    is neither allow-listed nor a sandbox escalation (see
 *    `./bash-guard.ts`). fs-free by design.
 *
 * The harness's own `serviceAsk` routes every `ask` through `ctx.approval` —
 * the session policy (`ask`/`never`) keeps applying, and an `allowed-once`
 * proceeds while `rejected` denies the call. Every non-blocking case
 * delegates via `next()` so later policy listeners still run.
 *
 * Naming convention: feature/namespace = `<tool>-approval`, user command =
 * `/approval-<tool>`. New tool families add a NEW namespace + command; existing
 * namespaces are never modified (compatibility contract: settings fields may
 * only be added with defaults, never removed or reinterpreted).
 *
 * Runtime state lives in the persisted `edit-approval` and `bash-approval`
 * settings namespaces (schema defaults < cordis row config < user settings
 * page); the `/approval-edit` and `/approval-bash` commands manage them.
 *
 * @module dsh-edit-approval
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { canonicalPath } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-tools'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-settings'
import * as dshSettings from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { decideApproval, targetPathOf, DEFAULT_TOOLS } from './guard.ts'
import { decideCommandApproval, type BashApprovalSettings } from './bash-guard.ts'

/** Stable Cordis plugin name. */
export const name = 'dsh-edit-approval'

/** Default whitelist for the bash-approval feature. */
export const DEFAULT_BASH_TOOLS: readonly string[] = ['bash']

/** Shared bash-approval defaults — the single source both schemas reference. */
const BASH_ENABLED_DEFAULT = false
const BASH_ALLOW_DEFAULT: readonly string[] = []

/** Deployment defaults supplied by the cordis row (profile patch can override). */
export interface Config {
  /** Master switch; off means edits execute without asking. */
  enabled: boolean
  /** Whitelist of intercepted tool names. */
  tools: string[]
  /** Ask only when the change touches at least this many lines. */
  minDiffLines: number
  /** Whether creating a new file asks for approval. */
  includeCreate: boolean
  /** Whether clearing/emptying a file asks for approval. */
  includeDelete: boolean
  /**
   * Bash-approval row-config overlay (optional; every key optional). The
   * `bash-approval` settings namespace resolves schema defaults < this base <
   * user settings page, exactly like the edit half.
   */
  bash?: {
    enabled?: boolean
    tools?: string[]
    allow?: string[]
  }
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  tools: z.array(String).default([...DEFAULT_TOOLS]),
  minDiffLines: z.number().default(0),
  includeCreate: z.boolean().default(true),
  includeDelete: z.boolean().default(true),
  // Optional at the Config level (no default): an absent `bash` key stays
  // absent after validation, so the bash-approval namespace falls back to its
  // own schema defaults; a present key overrides only the fields it names.
  bash: z.object({
    enabled: z.boolean().default(BASH_ENABLED_DEFAULT),
    tools: z.array(String).default([...DEFAULT_BASH_TOOLS]),
    allow: z.array(String).default([...BASH_ALLOW_DEFAULT]),
  }),
})

/**
 * The bash-approval settings namespace schema. Defaults MUST stay in lockstep
 * with the `bash` shape above (schema defaults < row config < user layer), so
 * the two can never drift apart.
 */
const BashSchema = z.object({
  enabled: z.boolean().default(BASH_ENABLED_DEFAULT),
  tools: z.array(String).default([...DEFAULT_BASH_TOOLS]),
  allow: z.array(String).default([...BASH_ALLOW_DEFAULT]),
})

/**
 * Version-neutral settings-namespace brand: on rc.2 `settingsNamespace(ns)`
 * brands the string (the brand is a compile-time marker erased at runtime, so
 * the helper returns `ns`), while 0.1.2-alpha.2 removed the helper and
 * `settings.register` accepts the raw namespace string. Reading it through
 * optional chaining means a single compiled host bundle links and runs on both
 * generations — a static `import { settingsNamespace }` would fail to link on
 * alpha.2 (see dsh-rewind's settings-locale adapter).
 */
const namespaceOf = (name: string): SettingsNamespace =>
  (dshSettings.settingsNamespace?.(name) ?? name) as SettingsNamespace

/** Durable settings namespaces backing every runtime toggle. */
const SETTINGS_NAMESPACE = namespaceOf('edit-approval')
const BASH_NAMESPACE = namespaceOf('bash-approval')

/** Parent-traversal probe shared with the fs tools' session-cwd resolution. */
const PARENT_PATH_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/

/** Session workspace cwd for this call (same rule as `dsh-tool-fs`). */
function sessionCwd(exec: ToolExecution, requestedPath: string): string | undefined {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined || (!PARENT_PATH_SEGMENT.test(cwd) && !PARENT_PATH_SEGMENT.test(requestedPath))) {
    return cwd
  }
  return canonicalPath(cwd)
}

/** Narrow the tool's lossless JSON arguments to a plain record. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * The session's effective approval policy for one call: its own override,
 * else the service config default. Mirrored by both approval features — under
 * `never` (Full access / danger-full-access preset) the plugin stops asking
 * entirely and delegates, because every `ask` it would emit would be
 * auto-rejected by the approval service, silently breaking the tools.
 */
function resolvePolicy(
  exec: ToolExecution,
  approval: unknown,
): 'ask' | 'never' {
  if (exec.agent === undefined) return 'ask'
  const service = approval as
    | { overrideOf?(session: unknown): string | undefined; config?: { policy?: string } }
    | undefined
  const policy = service?.overrideOf?.(exec.agent.session) ?? service?.config?.policy ?? 'ask'
  return policy === 'never' ? 'never' : 'ask'
}

/** The approval service face the policy check reads. */
function approvalService(scope: Context): unknown {
  return scope.get('approval')
}

/**
 * Mount the host plugin: settings namespaces, the four-feature commands, and
 * the `tools/pre-execute` interception dispatching to the edit or the bash
 * guard by tool name (edit wins on an overlap; defaults never overlap).
 * @param ctx - plugin context.
 * @param config - deployment defaults from the cordis row.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings', 'commands', 'fs'], (scope) => {
    const settings = scope.settings.register(SETTINGS_NAMESPACE, Config, { base: config })
    const bashSettings = scope.settings.register(BASH_NAMESPACE, BashSchema, { base: config.bash ?? {} })

    // --- `/approval-edit on | off | status` ---
    scope.commands.register({
      name: 'approval-edit',
      description: 'Turn edit approval on or off',
      input: { hint: 'on | off | status' },
      handler: async (invocation) => {
        const mode = invocation.rawInput.trim()
        if (mode === 'status') {
          return { kind: 'success', text: `edit approval is ${settings.get().enabled ? 'on' : 'off'}` }
        }
        if (mode === 'on' || mode === 'off') {
          await settings.update({ enabled: mode === 'on' })
          return { kind: 'success', text: `edit approval turned ${mode}` }
        }
        return { kind: 'error', text: 'usage: /approval-edit on | off | status' }
      },
    })

    // --- `/approval-bash on | off | status` ---
    scope.commands.register({
      name: 'approval-bash',
      description: 'Turn bash command approval on or off',
      input: { hint: 'on | off | status' },
      handler: async (invocation) => {
        const mode = invocation.rawInput.trim()
        if (mode === 'status') {
          return { kind: 'success', text: `bash approval is ${bashSettings.get().enabled ? 'on' : 'off'}` }
        }
        if (mode === 'on' || mode === 'off') {
          await bashSettings.update({ enabled: mode === 'on' })
          return { kind: 'success', text: `bash approval turned ${mode}` }
        }
        return { kind: 'error', text: 'usage: /approval-bash on | off | status' }
      },
    })

    // --- interception ---
    scope.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
      const live = settings.get()
      const bashLive = bashSettings.get()
      const editActive = live.enabled && live.tools.includes(exec.name)
      const bashActive = bashLive.enabled && bashLive.tools.includes(exec.name)
      if (!editActive && !bashActive) return next()
      // A session on the deterministic `never` policy (e.g. the
      // danger-full-access preset) intends FULL access without prompting:
      // every `ask` this plugin emits would be auto-rejected by the approval
      // service, silently breaking edits AND commands. Delegate instead — the
      // sandbox (or whatever else) keeps enforcing; this plugin just stops
      // asking. Shared by both mirror features.
      if (resolvePolicy(exec, approvalService(scope)) === 'never') return next()
      const args = asRecord(exec.arguments)
      if (args === undefined) return next()
      // Bash branch: fs-free judgment. Edit wins on a tool-name overlap
      // (default whitelists cannot overlap).
      if (bashActive && !editActive) {
        const bashSettingsLive: BashApprovalSettings = bashLive
        const decision = decideCommandApproval({ settings: bashSettingsLive, toolName: exec.name, args })
        if (decision.kind === 'ask') return { kind: 'ask', reason: decision.reason }
        return next()
      }
      if (exec.name === 'str_replace_editor' && args.command === 'view') return next()
      const filePath = targetPathOf(exec.name, args)
      if (filePath === undefined) return next()
      try {
        const cwd = sessionCwd(exec, filePath)
        const target = await scope.fs.resolve(filePath, {
          ...cwd !== undefined ? { cwd } : {},
          signal: exec.signal,
        })
        const info = await scope.fs.stat(target, exec.signal)
        // A directory or special file: the tool fails on its own; do not block.
        if (info !== undefined && info.type !== 'file') return next()
        const exists = info !== undefined
        const current = exists ? await scope.fs.readText(target, exec.signal) : ''
        const decision = decideApproval({ settings: live, toolName: exec.name, args, current, exists })
        if (decision.kind === 'ask') return { kind: 'ask', reason: decision.reason }
        return next()
      } catch (error) {
        // Preview failure must never break the underlying tool call.
        scope.logger.warn(`dsh-edit-approval: preview failed for ${exec.name}: ${String(error)}`)
        return next()
      }
    })
  })
}
