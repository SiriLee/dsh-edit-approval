/**
 * Edit-approval interception decision logic.
 *
 * Pure functions only: given the plugin settings, the tool call, and the
 * target file's current state, decide whether the call may proceed untouched
 * (`pass`) or must go through the approval panel (`ask` with a reason that
 * carries the tool/file header plus the rendered line diff).
 *
 * @module dsh-edit-approval/guard
 */

import {
  computeLineDiff,
  countChangedLines,
  countDeletions,
  countInsertions,
  renderDiff,
  type DiffLine,
} from './diff.ts'

/** The tools this plugin intercepts by default (registered tool names). */
export const DEFAULT_TOOLS: readonly string[] = ['write', 'edit', 'str_replace_editor']

/** Fully resolved plugin settings (schema defaults + row config + user layer). */
export interface EditApprovalSettings {
  /** Master switch; off means edits execute without asking. */
  enabled: boolean
  /** Whitelist of intercepted tool names. */
  tools: readonly string[]
  /** Ask only when the change touches at least this many lines. */
  minDiffLines: number
  /** Whether creating a new file asks for approval. */
  includeCreate: boolean
  /** Whether clearing/emptying a file asks for approval. */
  includeDelete: boolean
}

export type EditOperation = 'create' | 'modify' | 'delete'

/** One intercepted edit: current state plus the proposed new content. */
export interface EditTarget {
  /** Tool name that initiated the edit. */
  readonly toolName: string
  /** Display path from the tool args (`file_path` / `path`). */
  readonly filePath: string
  readonly operation: EditOperation
  /** Current file content; '' when the file does not exist. */
  readonly current: string
  /** Proposed content after the edit. */
  readonly proposed: string
  /** Best-effort preview note (e.g. a non-unique replacement target). */
  readonly note?: string
}

/** Decision returned to the `tools/pre-execute` waterfall. */
export type GuardResult =
  | { readonly kind: 'pass' }
  | { readonly kind: 'ask'; readonly reason: string }

export interface GuardInput {
  readonly settings: EditApprovalSettings
  readonly toolName: string
  readonly args: Readonly<Record<string, unknown>>
  /** Current file content; '' for absent files. */
  readonly current: string
  /** Whether the target file currently exists. */
  readonly exists: boolean
}

/** Extract the target path from a write-family tool call, or undefined. */
export function targetPathOf(toolName: string, args: Readonly<Record<string, unknown>>): string | undefined {
  switch (toolName) {
    case 'write':
    case 'edit': {
      const path = args.file_path
      return typeof path === 'string' && path.trim().length > 0 ? path : undefined
    }
    case 'str_replace_editor': {
      const path = args.path
      return typeof path === 'string' && path.trim().length > 0 ? path : undefined
    }
    default:
      return undefined
  }
}

/** Number of non-overlapping occurrences of `needle` in `haystack`. */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let offset = 0
  while (true) {
    const at = haystack.indexOf(needle, offset)
    if (at < 0) return count
    count += 1
    offset = at + needle.length
  }
}

/**
 * Compute the proposed content for one intercepted call, mirroring the
 * tool's own semantics (single unique replace for `edit`/`str_replace`,
 * insert-after-line for `insert`, full text for `write`/`create`).
 *
 * Returns the current content unchanged (possibly with a `note`) when the
 * edit cannot be previewed or would fail — the diff is then empty and the
 * guard passes, letting the tool report the error itself.
 */
export function proposeContent(
  toolName: string,
  args: Readonly<Record<string, unknown>>,
  current: string,
): { proposed: string; note?: string } {
  switch (toolName) {
    case 'write': {
      return { proposed: typeof args.content === 'string' ? args.content : current }
    }
    case 'edit': {
      const oldString = args.old_string
      const newString = args.new_string
      if (typeof oldString !== 'string' || typeof newString !== 'string') {
        return { proposed: current }
      }
      const occurrences = countOccurrences(current, oldString)
      if (occurrences === 0) {
        return { proposed: current, note: 'old_string not found in the current file' }
      }
      const replaceAll = args.replace_all === true
      if (occurrences > 1 && !replaceAll) {
        return {
          proposed: current,
          note: `old_string occurs ${String(occurrences)} times; edit requires exactly one match without replace_all`,
        }
      }
      if (replaceAll) return { proposed: current.split(oldString).join(newString) }
      return { proposed: current.replace(oldString, newString) }
    }
    case 'str_replace_editor': {
      switch (args.command) {
        case 'create': {
          return { proposed: typeof args.file_text === 'string' ? args.file_text : '' }
        }
        case 'str_replace': {
          const oldStr = args.old_str
          const newStr = args.new_str
          if (typeof oldStr !== 'string' || typeof newStr !== 'string') {
            return { proposed: current }
          }
          const occurrences = countOccurrences(current, oldStr)
          if (occurrences === 0) {
            return { proposed: current, note: 'old_str not found in the current file' }
          }
          if (occurrences > 1) {
            return { proposed: current, note: `old_str occurs ${String(occurrences)} times; str_replace requires a unique match` }
          }
          return { proposed: current.replace(oldStr, newStr) }
        }
        case 'insert': {
          const insertLine = args.insert_line
          const newStr = args.new_str
          if (typeof insertLine !== 'number' || !Number.isInteger(insertLine) || typeof newStr !== 'string') {
            return { proposed: current }
          }
          // The tool inserts BEFORE 0-based line `insert_line` (valid 0..len).
          const lines = current.length === 0 ? [] : current.split(/\r?\n/)
          if (insertLine < 0 || insertLine > lines.length) {
            return { proposed: current, note: `insert_line ${String(insertLine)} is outside [0, ${String(lines.length)}]` }
          }
          const inserted = newStr.split(/\r?\n/)
          return {
            proposed: [...lines.slice(0, insertLine), ...inserted, ...lines.slice(insertLine)].join('\n'),
          }
        }
        default:
          // view and unknown commands are never edits.
          return { proposed: current }
      }
    }
    default:
      return { proposed: current }
  }
}

/** Pluralize one word. */
function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`
}

/** Build the approval reason: a header line plus the rendered diff. */
export function formatReason(
  toolName: string,
  filePath: string,
  operation: EditOperation,
  diff: readonly DiffLine[],
  note?: string,
): string {
  const insertions = countInsertions(diff)
  const deletions = countDeletions(diff)
  const summary = `${String(insertions)} ${plural(insertions, 'insertion')}, ${String(deletions)} ${plural(deletions, 'deletion')}`
  const header = `${toolName} · ${filePath} (${operation}): ${summary}`
  const parts = [header]
  if (note !== undefined) parts.push(note)
  parts.push(renderDiff(diff))
  return parts.join('\n')
}

/**
 * Decide whether one write-family call must be approved.
 *
 * `pass` covers every case that should not block the call: disabled, tool
 * not whitelisted, non-edit `str_replace_editor` commands, no-op edits, and
 * edits below `minDiffLines`. `ask` carries the reason the approval panel
 * headlines.
 */
export function decideApproval(input: GuardInput): GuardResult {
  const { settings, toolName, args, current, exists } = input
  if (!settings.enabled) return { kind: 'pass' }
  if (!settings.tools.includes(toolName)) return { kind: 'pass' }
  if (toolName === 'str_replace_editor' && args.command === 'view') return { kind: 'pass' }
  const filePath = targetPathOf(toolName, args)
  if (filePath === undefined) return { kind: 'pass' }
  // A create against an existing file always fails inside the tool; do not ask.
  if (toolName === 'str_replace_editor' && args.command === 'create' && exists) return { kind: 'pass' }

  const { proposed, note } = proposeContent(toolName, args, current)
  const operation: EditOperation = !exists ? 'create' : proposed.length === 0 ? 'delete' : 'modify'
  if (operation === 'create' && !settings.includeCreate) return { kind: 'pass' }
  if (operation === 'delete' && !settings.includeDelete) return { kind: 'pass' }

  const diff = computeLineDiff(current, proposed)
  const changed = countChangedLines(diff)
  // A no-op edit never asks, and changes below the threshold pass silently.
  if (changed === 0 || changed < settings.minDiffLines) return { kind: 'pass' }
  return { kind: 'ask', reason: formatReason(toolName, filePath, operation, diff, note) }
}
