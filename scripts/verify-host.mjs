#!/usr/bin/env node
/**
 * Host-half verification against the BUILT artifact (`lib/index.js`), not the
 * sources: mounts the plugin on a real cordis Context and drives the
 * `tools/pre-execute` interception, the two slash commands, and the entry's
 * persistence end to end — no model, no UI.
 *
 * ## Method (and why this file was rewritten)
 *
 * Every real harness package this can reach is imported and used directly. The
 * one service that must be doubled — the settings service — is pinned to the
 * real surface in BOTH directions:
 *
 *   - every member the double implements must exist on the real
 *     `SettingsForms.prototype` (so the double cannot invent an API), and
 *   - every member the plugin calls must exist on both (so the double cannot
 *     silently cover for a removal).
 *
 * The previous version of this file implemented exactly ONE method —
 * `settings.register` — which is the single method DSH 0.1.7 deleted. Suite and
 * plugin agreed with each other and with nothing real, so the test stayed green
 * *through the exact interface change that broke the plugin*. That is the
 * failure this anchoring exists to make impossible.
 *
 * Writes are committed the way the Loader commits them: re-resolve the plugin's
 * own schema and `updateVolatile` the running references, so a write is visible
 * to the next read without a remount (the property the plugin's hot path and
 * the config card both depend on).
 *
 * Run: `npm run build && node scripts/verify-host.mjs` (also wired into CI).
 *
 * @module dsh-edit-approval/scripts/verify-host
 */

import { Context } from '@deepseek-ai/cordis'
import SettingsForms from '@deepseek-ai/dsh-settings'
import { updateVolatile } from '@deepseek-ai/cosmokit'
import * as plugin from '../lib/index.js'

/** The profile row id the bundle patch declares (and the settings entry key). */
const ENTRY_ID = 'dsh-edit-approval'

let failures = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — ${detail}`}`)
  if (!ok) failures += 1
}

/** Wait for the nested `ctx.inject` child that owns the interception. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

/** Write one value at a path, creating intermediate objects (the Host's `set`). */
function setPath(target, path, value) {
  const parent = path.slice(0, -1).reduce((node, key) => (node[key] ??= {}), target)
  parent[path[path.length - 1]] = value
}

/** Remove the value at a path (the Host's `unset`). */
function unsetPath(target, path) {
  const parent = path.slice(0, -1).reduce((node, key) => node?.[key], target)
  if (parent !== undefined) delete parent[path[path.length - 1]]
}

// ======================= 1. module shape =======================

check(
  'host bundle exports name/apply/Config',
  typeof plugin.name === 'string'
    && typeof plugin.apply === 'function'
    && plugin.Config !== undefined && plugin.Config !== null,
  `name=${String(plugin.name)} apply=${typeof plugin.apply} Config=${typeof plugin.Config}`,
)
check(
  'host bundle declares the services it mounts on',
  Array.isArray(plugin.inject) && plugin.inject.includes('commands') && plugin.inject.includes('settings'),
  JSON.stringify(plugin.inject),
)

// ================= 2. the settings double, anchored =================

const REAL_SURFACE = new Set(Object.getOwnPropertyNames(SettingsForms.prototype))

/** Every member the plugin and this harness actually call on the service. */
const USED_SURFACE = ['configure', 'describe', 'update', 'mutate']

for (const name of USED_SURFACE) {
  check(`real SettingsForms exposes ${name}`, REAL_SURFACE.has(name), [...REAL_SURFACE].join(','))
}
check(
  'the removed settings.register is NOT on the real surface',
  !REAL_SURFACE.has('register'),
  'register came back — re-check the 0.1.7 seam before trusting this suite',
)

/**
 * The entry document the double mutates. Ordinary fields are present so the
 * schema resolves exactly what a real profile entry would.
 */
let document = {
  editEnabled: true,
  bashEnabled: false,
  editTools: ['write', 'edit'],
  editMinDiffLines: 0,
  editIncludeCreate: true,
  editIncludeDelete: true,
  bashTools: ['bash'],
  // An ordinary field: fixed at mount, which is why the allow-list check below
  // cannot be exercised by a write.
  bashAllow: ['git status'],
}

/** The live references handed to the plugin — what the Loader resolves. */
const live = plugin.Config['~standard'].validate(document).value
check(
  'Config resolves the two live switches plus the ordinary fields',
  live.editEnabled?.get() === true && live.bashEnabled?.get() === false
    && Array.isArray(live.editTools) && live.editTools.includes('edit'),
  JSON.stringify({ ...document, editEnabled: live.editEnabled?.get() }),
)

/** Commit the document into the running references, as the Loader does. */
function commit() {
  const fresh = plugin.Config['~standard'].validate(document).value
  updateVolatile(live.editEnabled, fresh.editEnabled)
  updateVolatile(live.bashEnabled, fresh.bashEnabled)
}

const writes = []
const presentations = []
const settings = {
  configure: (presentation, owner) => { presentations.push({ presentation, owner }); return () => {} },
  describe: () => [],
  update: async (ns, patch) => {
    writes.push({ op: 'update', ns, patch: JSON.parse(JSON.stringify(patch)) })
    document = { ...document, ...patch }
    commit()
  },
  mutate: async (ns, ops) => {
    writes.push({ op: 'mutate', ns, ops: JSON.parse(JSON.stringify(ops)) })
    for (const op of ops) {
      if (op.op === 'set') setPath(document, op.path, op.value)
      else unsetPath(document, op.path)
    }
    commit()
  },
}

check(
  'the settings double implements only members the real service has',
  Object.keys(settings).every((name) => REAL_SURFACE.has(name)),
  Object.keys(settings).filter((name) => !REAL_SURFACE.has(name)).join(','),
)
for (const name of USED_SURFACE) {
  check(`the settings double implements ${name}`, name in settings, Object.keys(settings).join(','))
}

// ======================= 3. mount =======================

const ctx = new Context()
// The plugin reads its profile entry id off its OWN fiber, so the mount has to
// look like a Loader row: the local option carries what the write path keys on.
ctx.fiber.entry = { options: { id: ENTRY_ID } }

// Paths live at their cwd-resolved display path (the stub resolve joins the
// session cwd), mirroring how the real fs backend resolves them.
const files = new Map([['/workspace/src/a.ts', 'before\nunchanged']])
const commands = []
let approvalPolicy = 'ask'

ctx.provide('fs', {
  resolve: async (path, opts) => ({
    targetKey: path,
    displayPath: path.startsWith('/') ? path : (opts?.cwd ? `${opts.cwd}/${path}` : path),
  }),
  stat: async (target) => (files.has(target.displayPath) ? { version: 'v', type: 'file' } : undefined),
  readText: async (target) => files.get(target.displayPath),
})
ctx.provide('commands', { register: (definition) => { commands.push(definition); return () => {} } })
ctx.provide('tools', {})
ctx.provide('approval', {
  overrideOf: () => (approvalPolicy === 'never' ? 'never' : undefined),
  config: { policy: 'ask' },
})
ctx.provide('settings', settings)

plugin.apply(ctx, live)
await settle()

check('plugin mounted (2 commands registered)', commands.length === 2, commands.map((c) => c.name).join(','))

// The bundle ships its own config card, so it must opt the entry out of a
// schema-generated page — and the policy MUST be owned by the plugin's own
// fiber, because the service looks it up by `entry.fiber`: the `ctx.inject`
// child's default owner would store it where nothing ever reads it.
check(
  'the bundle declares its own config page (auto: false) for its own fiber',
  presentations.length === 1
    && presentations[0].presentation?.auto === false
    && presentations[0].owner === ctx.fiber,
  JSON.stringify(presentations.map((p) => p.presentation)),
)

const preExecute = (name, args, agent = undefined) => ctx.waterfall(
  ctx,
  'tools/pre-execute',
  {
    callId: `c-${Math.random().toString(36).slice(2)}`,
    name,
    arguments: args,
    agent,
    signal: new AbortController().signal,
  },
  () => Promise.resolve({ kind: 'allow' }),
)

const agent = { id: 'agent-1', session: { header: { cwd: '/workspace' } } }
const call = (rawInput) => ({ rawInput, agent: { id: 'x' }, signal: new AbortController().signal })

// ======================= 4. interception =======================

const ask = await preExecute('edit', { file_path: 'src/a.ts', old_string: 'before', new_string: 'after' }, agent)
check('pre-execute asks for a tracked edit', ask.kind === 'ask', JSON.stringify(ask))
if (ask.kind === 'ask') {
  check(
    'ask reason carries tool · file and diff markers',
    /^edit · src\/a\.ts \(modify\)/.test(ask.reason)
      && /\d+\| -before/.test(ask.reason) && /\d+\| \+after/.test(ask.reason),
    ask.reason.split('\n')[0],
  )
}

const untracked = await preExecute('read', { file_path: 'src/a.ts' }, agent)
check('an untracked tool passes through untouched', untracked.kind === 'allow', JSON.stringify(untracked))

// `str_replace_editor` is no longer a DEFAULT tool; its guard branch must go
// quiet rather than block (a default install can never see the tool).
const strReplace = await preExecute(
  'str_replace_editor',
  { command: 'str_replace', path: 'src/a.ts', old_str: 'before', new_str: 'after' },
  agent,
)
check('the non-default str_replace_editor tool is not intercepted', strReplace.kind === 'allow', JSON.stringify(strReplace))

// A session on the deterministic `never` policy intends full access; the plugin
// must delegate instead of emitting an ask the service would auto-reject.
approvalPolicy = 'never'
const neverAsk = await preExecute('edit', { file_path: 'src/a.ts', old_string: 'before', new_string: 'after' }, agent)
check('a session on the never policy is delegated to (no ask)', neverAsk.kind === 'allow', JSON.stringify(neverAsk))
approvalPolicy = 'ask'

// bash: off by default, then on, then allow-listed.
const bashOff = await preExecute('bash', { command: 'echo hi', description: 'greet' }, agent)
check('bash approval off passes commands through', bashOff.kind === 'allow', JSON.stringify(bashOff))

await byName('approval-bash').handler(call('on'))
const bashOn = await preExecute('bash', { command: 'git push origin main', description: 'push to remote' }, agent)
check('bash approval on asks (a live switch write, no remount)', bashOn.kind === 'ask', JSON.stringify(bashOn))
if (bashOn.kind === 'ask') {
  check(
    'bash ask reason headlines the description (command renders natively)',
    /^bash · push to remote$/m.test(bashOn.reason) && !bashOn.reason.includes('$ git push'),
    bashOn.reason.split('\n')[0],
  )
}

const bashAllowed = await preExecute('bash', { command: 'git  status --short', description: 'show status' }, agent)
check('an allow-listed command passes (whitespace-normalized)', bashAllowed.kind === 'allow', JSON.stringify(bashAllowed))

// The volatile/ordinary split, pinned: ordinary fields are read as plain values,
// so no write can move them without a remount — which is exactly why only the
// two master switches are `.volatile()`.
document = { ...document, bashAllow: [] }
commit()
check(
  'an ordinary field keeps its mount-time value (only the switches are live)',
  Array.isArray(live.bashAllow) && live.bashAllow.includes('git status'),
  JSON.stringify(live.bashAllow),
)

const editOff = await byName('approval-edit').handler(call('off'))
check('approval-edit off answers success', editOff.kind === 'success', JSON.stringify(editOff))
const disabled = await preExecute('write', { file_path: 'src/a.ts', content: 'x' }, agent)
check('a disabled master switch passes everything through', disabled.kind === 'allow', JSON.stringify(disabled))

/** Look a registered command up by name (defined late: used by the section above). */
function byName(name) {
  const found = commands.find((command) => command.name === name)
  if (found === undefined) throw new Error(`command ${name} was never registered`)
  return found
}

// ======================= 5. commands + persistence =======================

const editStatus = await byName('approval-edit').handler(call('status'))
check('approval-edit status reflects the live switch', editStatus.kind === 'success' && editStatus.text.endsWith('off'), JSON.stringify(editStatus))
const bashStatus = await byName('approval-bash').handler(call('status'))
check('approval-bash status reflects the live switch', bashStatus.kind === 'success' && bashStatus.text.endsWith('on'), JSON.stringify(bashStatus))

// PIN: a value away from the schema default is written onto the entry row.
const beforePin = writes.length
await byName('approval-edit').handler(call('off'))
const pin = writes.at(-1)
check(
  'turning a switch away from its default pins the value onto the entry row',
  writes.length === beforePin + 1 && pin.op === 'update' && pin.patch.editEnabled === false,
  JSON.stringify(pin),
)
check('the pinned switch reads back from the live reference', live.editEnabled.get() === false, String(live.editEnabled.get()))

// CLEAR: a value equal to the schema default is UNSET, so the profile patch
// keeps only what the user actually changed and a later default change still
// reaches them — pinning a copy would silently opt them out of it forever.
const beforeClear = writes.length
await byName('approval-edit').handler(call('on'))
const cleared = writes.at(-1)
check(
  'turning a switch back to its default clears it instead of pinning a copy',
  writes.length === beforeClear + 1
    && cleared.op === 'mutate'
    && JSON.stringify(cleared.ops) === JSON.stringify([{ op: 'unset', path: ['editEnabled'] }]),
  JSON.stringify(cleared),
)
const beforeBashClear = writes.length
await byName('approval-bash').handler(call('off'))
const bashCleared = writes.at(-1)
check(
  'the same rule holds for the bash switch',
  writes.length === beforeBashClear + 1
    && bashCleared.op === 'mutate'
    && JSON.stringify(bashCleared.ops) === JSON.stringify([{ op: 'unset', path: ['bashEnabled'] }]),
  JSON.stringify(bashCleared),
)
check('both cleared switches read their schema defaults again', live.editEnabled.get() === true && live.bashEnabled.get() === false, `${String(live.editEnabled.get())}/${String(live.bashEnabled.get())}`)

check(
  'every write addressed the profile row id, not a namespace',
  writes.length > 0 && writes.every((write) => write.ns === ENTRY_ID),
  JSON.stringify([...new Set(writes.map((w) => w.ns))]),
)

const badMode = await byName('approval-edit').handler(call('maybe'))
check('an unknown mode is refused with usage', badMode.kind === 'error' && badMode.text.includes('usage'), JSON.stringify(badMode))

console.log(failures === 0 ? '\nverify-host: all checks passed' : `\nverify-host: ${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
