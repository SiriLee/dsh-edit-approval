/**
 * dsh-edit-approval — host half.
 *
 * Two mirror-image approval features on the `tools/pre-execute` waterfall:
 *
 * 1. **edit approval** (`editEnabled`) — intercepts `write` / `edit` (and
 *    `str_replace_editor` when a deployment opts that tool in), reads the
 *    target file's current content, computes a line-level diff against the
 *    proposed content, and returns `{ kind: 'ask', reason }` when a human
 *    decision is needed (see `./guard.ts`).
 * 2. **bash approval** (`bashEnabled`) — intercepts command tools, asking for
 *    every command that is neither allow-listed nor a sandbox escalation (see
 *    `./bash-guard.ts`). fs-free by design.
 *
 * The harness's own `serviceAsk` routes every `ask` through `ctx.approval` —
 * the session policy (`ask`/`never`) keeps applying, and an `allowed-once`
 * proceeds while `rejected` denies the call. Every non-blocking case delegates
 * via `next()` so later policy listeners still run.
 *
 * **Settings (DSH 0.1.7).** The settings-namespace registry this plugin used to
 * register (`edit-approval` / `bash-approval`) is gone. Both features now read
 * ONE profile entry's `Config` — the bundle patch's row id, which equals the
 * package name — and the two master switches are the only `.volatile()` fields,
 * so they are the only ones the config page shows and the only ones a write may
 * address. Everything else stays ordinary config, edited in the profile file
 * exactly as before. `./config.ts` owns the adapter; the guards stay pure.
 *
 * @module dsh-edit-approval
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-tools'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-settings'
import { decideApproval, targetPathOf } from './guard.ts'
import { decideCommandApproval } from './bash-guard.ts'
import {
  DEFAULT_BASH_ALLOW,
  DEFAULT_BASH_APPROVAL,
  DEFAULT_BASH_TOOLS,
  DEFAULT_EDIT_APPROVAL,
  DEFAULT_TOOLS,
  volatileApprovalStore,
  type ApprovalConfig,
  type ApprovalConfigStore,
} from './config.ts'

export { DEFAULT_BASH_ALLOW, DEFAULT_BASH_TOOLS, DEFAULT_TOOLS } from './config.ts'

/** Stable Cordis plugin name. */
export const name = 'dsh-edit-approval'

/**
 * Required services: the human command registry and the settings service the
 * config page and the two toggle commands write through. `tools` and `fs` are
 * awaited separately (see `apply`) so the commands and the config page still
 * work in a deployment without the file tools.
 */
export const inject = ['commands', 'settings']

/**
 * Deployment configuration: the plugin entry's document.
 *
 * The two `*Enabled` switches are `.volatile()`; every other field is ordinary
 * config. See `./config.ts` for why that split is where it is.
 */
export interface Config extends ApprovalConfig {}

/**
 * The `Config` schema the host resolves and projects as this entry's form.
 *
 * Deliberately NOT annotated `z<Config>`: a `.volatile()` field makes the
 * schema's INPUT side non-total, which that annotation's variance rejects (the
 * sister project omits it for the same reason). The pairing is pinned instead
 * by `tests/config.spec.ts`, which reads the schema's own serialized envelope
 * (`Config.toJSON()` — the same projection the settings wire uses) and asserts
 * its volatile field set equals the config page's field list.
 */
export const Config = z.object({
  editEnabled: z.boolean().default(DEFAULT_EDIT_APPROVAL.enabled).volatile(),
  bashEnabled: z.boolean().default(DEFAULT_BASH_APPROVAL.enabled).volatile(),
  // Ordinary fields: excluded from the config page and editable only in the
  // profile file, exactly as they were before the settings model changed.
  editTools: z.array(String).default([...DEFAULT_TOOLS]),
  editMinDiffLines: z.number().step(1).min(0).default(DEFAULT_EDIT_APPROVAL.minDiffLines),
  editIncludeCreate: z.boolean().default(DEFAULT_EDIT_APPROVAL.includeCreate),
  editIncludeDelete: z.boolean().default(DEFAULT_EDIT_APPROVAL.includeDelete),
  bashTools: z.array(String).default([...DEFAULT_BASH_TOOLS]),
  bashAllow: z.array(String).default([...DEFAULT_BASH_ALLOW]),
})

/**
 * The profile entry id this plugin's configuration is addressed by: the bare
 * row id the bundle patch declares, which the config editor keys on
 * (`entry.options.id`). The fiber's own `entry.id` carries the loader's
 * ancestor prefix (`include:dsh-edit-approval`), so reading the local option is
 * both simpler and exactly the key the write path looks up.
 *
 * Read from the plugin's OWN fiber, never from an `ctx.inject` child: a child
 * fiber has no loader entry.
 *
 * @param ctx - the plugin context.
 * @returns the entry id, or undefined for an entry-less mount.
 */
export function approvalConfigKey(ctx: Context): string | undefined {
  const fiber = (ctx as { fiber?: { entry?: { options?: { id?: string } } } }).fiber
  return fiber?.entry?.options?.id
}

/** Narrow the tool's lossless JSON arguments to a plain record. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * The session workspace cwd for this call, verbatim.
 *
 * The fs tools resolve a relative path against `header.cwd` exactly as it is
 * spelled; DSH 0.1.7 stopped canonicalizing a parent-traversing cwd, so any
 * canonicalization here would preview a different file identity than the tool
 * mutates.
 */
function sessionCwd(exec: ToolExecution): string | undefined {
  return exec.agent?.session.header.cwd
}

/**
 * The session's effective approval policy for one call: its own override, else
 * the service config default. Under `never` (Full access / danger-full-access
 * preset) the plugin stops asking entirely and delegates, because every `ask`
 * it would emit would be auto-rejected by the approval service, silently
 * breaking the tools.
 */
function resolvePolicy(exec: ToolExecution, approval: unknown): 'ask' | 'never' {
  if (exec.agent === undefined) return 'ask'
  const service = approval as
    | { overrideOf?(session: unknown): string | undefined; config?: { policy?: string } }
    | undefined
  const policy = service?.overrideOf?.(exec.agent.session) ?? service?.config?.policy ?? 'ask'
  return policy === 'never' ? 'never' : 'ask'
}

/** The approval service face the policy check reads (resolved lazily). */
function approvalService(scope: Context): unknown {
  return scope.get('approval')
}

/** Render one feature's master switch for a `status` command answer. */
function switchState(on: boolean): string {
  return on ? 'on' : 'off'
}

/**
 * Register one `<feature> on | off | status` command over a master switch.
 *
 * The write goes through the store, so it addresses the SAME document field the
 * config page edits — the command and the switch cannot disagree.
 *
 * @param ctx - the plugin context.
 * @param store - the settings store, or undefined when the entry is unavailable.
 * @param options - the command's identity and the switch it drives.
 */
function registerToggleCommand(
  ctx: Context,
  store: ApprovalConfigStore | undefined,
  options: {
    readonly command: string
    readonly label: string
    readonly field: 'editEnabled' | 'bashEnabled'
    readonly read: () => boolean
  },
): void {
  ctx.commands.register({
    name: options.command,
    description: `Turn ${options.label} on or off`,
    input: { hint: 'on | off | status' },
    handler: async (invocation) => {
      const mode = invocation.rawInput.trim()
      if (store === undefined) {
        return { kind: 'error', text: `${options.label} settings are unavailable` }
      }
      if (mode === 'status') {
        return { kind: 'success', text: `${options.label} is ${switchState(options.read())}` }
      }
      if (mode === 'on' || mode === 'off') {
        try {
          await store.saveSwitch(options.field, mode === 'on')
        } catch (error) {
          ctx.logger.warn(`dsh-edit-approval: ${options.command} could not write: ${String(error)}`)
          return { kind: 'error', text: `${options.label} could not be turned ${mode}` }
        }
        return { kind: 'success', text: `${options.label} turned ${mode}` }
      }
      return { kind: 'error', text: `usage: /${options.command} on | off | status` }
    },
  })
}

/**
 * Mount the host plugin: the config page policy, the two toggle commands, and
 * the `tools/pre-execute` interception dispatching to the edit or the bash
 * guard by tool name (edit wins on an overlap; defaults never overlap).
 *
 * @param ctx - plugin context.
 * @param config - the resolved entry configuration (live volatile references).
 */
export function apply(ctx: Context, config?: Config): void {
  const entryId = approvalConfigKey(ctx)
  const store = config === undefined || entryId === undefined
    ? undefined
    : volatileApprovalStore(config, {
      entryId,
      update: (id, patch) => ctx.settings.update(id, patch),
      clear: (id, fields) => ctx.settings.mutate(id, fields.map(field => ({ op: 'unset' as const, path: [field] }))),
    })

  // This bundle ships its own config card, so opt the entry out of a
  // schema-generated page (the dsh-settings README's rule for a plugin with its
  // own page). The owner MUST be this plugin's fiber — the policy is looked up
  // by `entry.fiber`, so a child fiber's default would store it where nothing
  // reads it. Inert today (no shipped client builds pages), and cheap to keep.
  ctx.inject(['settings'], (child) => {
    child.effect(
      () => child.settings.configure({ auto: false }, ctx.fiber),
      'dsh-edit-approval page policy',
    )
  })

  registerToggleCommand(ctx, store, {
    command: 'approval-edit',
    label: 'edit approval',
    field: 'editEnabled',
    read: () => store?.loadEdit().enabled ?? DEFAULT_EDIT_APPROVAL.enabled,
  })
  registerToggleCommand(ctx, store, {
    command: 'approval-bash',
    label: 'bash approval',
    field: 'bashEnabled',
    read: () => store?.loadBash().enabled ?? DEFAULT_BASH_APPROVAL.enabled,
  })

  // --- interception ---
  // Awaiting `tools` and `fs` here (rather than in `inject`) keeps the commands
  // and the config page usable in a deployment without the file tools.
  ctx.inject(['tools', 'fs'], (scope) => {
    scope.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
      if (store === undefined) return next()
      const edit = store.loadEdit()
      const bash = store.loadBash()
      const editActive = edit.enabled && edit.tools.includes(exec.name)
      const bashActive = bash.enabled && bash.tools.includes(exec.name)
      if (!editActive && !bashActive) return next()
      // A session on the deterministic `never` policy intends FULL access
      // without prompting; delegate rather than emit an ask the service would
      // auto-reject. Shared by both mirror features.
      if (resolvePolicy(exec, approvalService(scope)) === 'never') return next()
      const args = asRecord(exec.arguments)
      if (args === undefined) return next()
      // Bash branch: fs-free judgment. Edit wins on a tool-name overlap
      // (default whitelists cannot overlap).
      if (bashActive && !editActive) {
        const decision = decideCommandApproval({ settings: bash, toolName: exec.name, args })
        if (decision.kind === 'ask') return { kind: 'ask', reason: decision.reason }
        return next()
      }
      if (exec.name === 'str_replace_editor' && args.command === 'view') return next()
      const filePath = targetPathOf(exec.name, args)
      if (filePath === undefined) return next()
      try {
        const cwd = sessionCwd(exec)
        const target = await scope.fs.resolve(filePath, {
          ...cwd !== undefined ? { cwd } : {},
          signal: exec.signal,
        })
        const info = await scope.fs.stat(target, exec.signal)
        // A directory or special file: the tool fails on its own; do not block.
        if (info !== undefined && info.type !== 'file') return next()
        const exists = info !== undefined
        const current = exists ? await scope.fs.readText(target, exec.signal) : ''
        const decision = decideApproval({ settings: edit, toolName: exec.name, args, current, exists })
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
