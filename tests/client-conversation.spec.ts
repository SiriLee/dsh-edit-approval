// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  CHAT_VIEW,
  chatSnapshotOf,
  uiConversationOf,
  type ChatSnapshotLike,
  type LegacySessionFace,
  type UiConversationLike,
} from '../src/client/conversation.ts'

/** A minimal chat snapshot (order + keyed nodes), shaped like both host channels. */
function chat(order: string[]): ChatSnapshotLike {
  return {
    order,
    nodes: { get: () => undefined },
  }
}

/** A legacy rc.2 session face carrying `.chat` / `.pending` on its snapshot. */
function legacyFace(snapshot: { chat?: unknown; pending?: readonly unknown[] }): LegacySessionFace {
  return { getSnapshot: () => snapshot }
}

describe('chatSnapshotOf — dual channel', () => {
  it('uses the rc.2 session-face chat first', () => {
    const legacyChat = chat(['a', 'b'])
    const face = legacyFace({ chat: legacyChat })
    expect(chatSnapshotOf(face, { getSnapshot: () => 'unused' })).toBe(legacyChat)
  })

  it('falls back to the alpha.1+ uiConversation "chat" view when the face has no chat', () => {
    const viewChat = chat(['x', 'y'])
    const face = legacyFace({ pending: [] }) // rc.2 pending, but no chat
    const chatView = { getSnapshot: () => viewChat }
    expect(chatSnapshotOf(face, chatView)).toBe(viewChat)
  })

  it('reads the chat view even when the face is absent (alpha.1+ no session chat)', () => {
    const viewChat = chat(['m'])
    expect(chatSnapshotOf(undefined, { getSnapshot: () => viewChat })).toBe(viewChat)
  })

  it('degrades to undefined when both channels are missing — never a throw', () => {
    expect(chatSnapshotOf(legacyFace({}), undefined)).toBeUndefined()
    expect(chatSnapshotOf(undefined, undefined)).toBeUndefined()
  })

  it('returns undefined when the chat view is not yet registered', () => {
    const chatView = { getSnapshot: () => undefined }
    expect(chatSnapshotOf(legacyFace({}), chatView)).toBeUndefined()
  })
})

describe('uiConversationOf — optional lazy service', () => {
  it('resolves the uiConversation service when ctx.get returns it', () => {
    const service: UiConversationLike = {
      binding: () => ({ target: () => ({ getSnapshot: () => undefined }) }),
    }
    const ctx = { get: (name: string) => (name === 'uiConversation' ? service : undefined) } as never
    expect(uiConversationOf(ctx)).toBe(service)
  })

  it('is undefined on rc.2, where the service does not exist', () => {
    const ctx = { get: () => undefined } as never
    expect(uiConversationOf(ctx)).toBeUndefined()
  })
})

describe('CHAT_VIEW target name', () => {
  it('pins the alpha.1+ chat view name', () => {
    expect(CHAT_VIEW).toBe('chat')
  })
})
