/**
 * Dual-channel session / conversation reads for the approval client half.
 *
 * DSH split the Conversation (chat) read face OUT of the outward
 * `SessionFace.getSnapshot()` between rc.2 and the 0.1.2-alpha line:
 * - **rc.2**: `SessionFace = ISession & ObservableSnapshot<ConversationSnapshot>`,
 *   and the snapshot carries `chat` (`order` / `nodes.get()`) and
 *   `pending` (`PendingWait[]`).
 * - **alpha.1+**: `SessionFace = ISession & ObservableSnapshot<SessionSnapshot>`,
 *   and `SessionSnapshot` carries only lifecycle fields — `chat` and `pending`
 *   are GONE. The live chat now lives in the `uiConversation` service's named
 *   "chat" view (contributed by dsh-client-ui-chat through the uiSession slot
 *   hook), which the harness itself reads through the same seam.
 *
 * Every read here is a "try channel A (rc.2 face), then channel B (alpha.1+
 * uiConversation view)" adapter, so a single compiled bundle links and runs on
 * both generations. Neither channel present degrades to `undefined`, never a
 * throw. The version is detected by CAPABILITY PRESENCE (`uiConversation`
 * resolves to `undefined` on rc.2), never parsed from a version string.
 *
 * @module dsh-edit-approval/client/conversation
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** Minimal chat snapshot reader the approval client needs (order + keyed nodes). */
export interface ChatSnapshotLike {
  readonly order: readonly string[]
  readonly nodes: { get(key: string): unknown | undefined }
}

/**
 * Structural face of the alpha.1+ `uiConversation` service: per-session
 * bindings exposing named view targets (the "chat" view carries the chat
 * snapshot). Typed locally so the plugin never imports the conversation UI
 * package's types and survives harness version drift.
 */
export interface UiConversationLike {
  binding(source: string | { readonly sessionId: string }): {
    target(name: string): { getSnapshot(): unknown } | undefined
  }
}

/** A session face carrying the legacy rc.2 chat / pending fields. */
export interface LegacySessionFace {
  getSnapshot(): { chat?: unknown; pending?: readonly unknown[] }
}

/** The named chat view target inside the alpha.1+ uiConversation registry. */
export const CHAT_VIEW = 'chat'

/**
 * Resolve the optional alpha.1+ `uiConversation` service. Absent on rc.2,
 * where the chat comes from the session-face snapshot instead. Resolved lazily
 * per read (`ctx.get`), never injected — a declared inject entry would be a
 * REQUIRED service and would stall this plugin forever on rc.2.
 * @param ctx - client root context.
 * @returns the uiConversation face, or `undefined` when the service is absent.
 */
export function uiConversationOf(ctx: ClientContext): UiConversationLike | undefined {
  return (ctx as { get(name: string): unknown }).get('uiConversation') as UiConversationLike | undefined
}

/**
 * Resolve a session's live chat snapshot across the two harness channels: the
 * session-face snapshot first (rc.2 — on alpha.1+ the face no longer carries
 * `chat`, so the field reads `undefined`), then the `uiConversation` "chat"
 * view. The view's `getSnapshot()` returns `undefined` until the named view is
 * registered, so both channels missing degrades to `undefined` — never a crash.
 * @param face - the session face (its `getSnapshot().chat` is the rc.2 channel).
 * @param chatView - the alpha.1+ "chat" view (`getSnapshot()` returns the live chat).
 * @returns the chat snapshot, or `undefined` when neither channel is available.
 */
export function chatSnapshotOf(
  face: LegacySessionFace | undefined,
  chatView: { getSnapshot(): unknown } | undefined,
): ChatSnapshotLike | undefined {
  const legacy = face?.getSnapshot().chat as ChatSnapshotLike | undefined
  if (legacy !== undefined) return legacy
  return (chatView?.getSnapshot() ?? undefined) as ChatSnapshotLike | undefined
}
