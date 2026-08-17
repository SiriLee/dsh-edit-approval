/**
 * dsh-edit-approval — host half.
 *
 * Intercepts `write` / `edit` / `str_replace_editor` at the
 * `tools/pre-execute` waterfall, reads the target file's current content,
 * computes a line-level diff against the proposed content, and returns
 * `{ kind: 'ask', reason }` when a human decision is needed. The harness's
 * own `serviceAsk` routes that decision through `ctx.approval` — the session
 * policy (`ask`/`never`) keeps applying, and an `allowed-once` proceeds
 * while `rejected` denies the call. Every non-blocking case delegates via
 * `next()` so later policy listeners still run.
 *
 * Runtime state lives in the persisted `edit-approval` settings namespace
 * (schema defaults < cordis row config < user settings page); the
 * `/approval-edit` command manages it.
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
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { decideApproval, targetPathOf, DEFAULT_TOOLS } from './guard.ts'

/** Stable Cordis plugin name. */
export const name = 'dsh-edit-approval'

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
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  tools: z.array(String).default([...DEFAULT_TOOLS]),
  minDiffLines: z.number().default(0),
  includeCreate: z.boolean().default(true),
  includeDelete: z.boolean().default(true),
})

/**
 * The settings namespace schema — identical to the row {@link Config} by
 * design (schema defaults < row config < user settings page), so the two can
 * never drift apart.
 */
const SettingsSchema = Config

/** Durable settings namespace backing every runtime toggle. */
const SETTINGS_NAMESPACE = settingsNamespace('edit-approval')

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
 * Mount the host plugin: settings namespace, the two commands, and the
 * `tools/pre-execute` interception.
 * @param ctx - plugin context.
 * @param config - deployment defaults from the cordis row.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings', 'commands', 'fs'], (scope) => {
    const settings = scope.settings.register(SETTINGS_NAMESPACE, SettingsSchema, { base: config })

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

    // --- interception ---
    scope.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
      const live = settings.get()
      if (!live.enabled) return next()
      if (!live.tools.includes(exec.name)) return next()
      // A session on the deterministic `never` policy (e.g. the
      // danger-full-access preset) intends FULL access without prompting:
      // every `ask` this plugin emits would be auto-rejected by the approval
      // service, silently breaking edits. Delegate instead — the sandbox (or
      // whatever else) keeps enforcing; this plugin just stops asking. The
      // effective policy folds the session override over the service config.
      if (exec.agent !== undefined) {
        const approval = scope.get('approval') as
          | { overrideOf?(session: unknown): string | undefined; config?: { policy?: string } }
          | undefined
        const policy = approval?.overrideOf?.(exec.agent.session) ?? approval?.config?.policy ?? 'ask'
        if (policy === 'never') return next()
      }
      const args = asRecord(exec.arguments)
      if (args === undefined) return next()
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
