#!/usr/bin/env node
/**
 * Host-half verification against the BUILT artifact (lib/index.js), not the
 * sources: mounts the plugin on a real cordis Context with stub services and
 * drives the `tools/pre-execute` interception, the settings namespace, and
 * both slash commands end to end — no model, no UI.
 *
 * Run: `npm run build && node scripts/verify-host.mjs` (also wired into CI).
 */

import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../lib/index.js'

let failures = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — ${detail}`}`)
  if (!ok) failures += 1
}

// ---- 1. module shape ----
check(
  'host bundle exports name/apply/Config',
  typeof plugin.name === 'string'
    && typeof plugin.apply === 'function'
    && typeof plugin.Config !== 'undefined' && plugin.Config !== null,
  `name=${String(plugin.name)} apply=${typeof plugin.apply} Config=${typeof plugin.Config}`,
)
const validated = plugin.Config['~standard'].validate({})
check(
  'Config defaults resolve',
  validated.value !== undefined
    && validated.value.enabled === true
    && Array.isArray(validated.value.tools)
    && validated.value.tools.includes('write'),
  JSON.stringify(validated.issues ?? validated.value),
)

// ---- 2. mount on a real cordis Context with stub services ----
const ctx = new Context()
// Paths live at their cwd-resolved display path (the stub resolve prefixes
// the session cwd), mirroring how the real fs backend resolves them.
const files = new Map([['/workspace/src/a.ts', 'before\nunchanged']])
const commands = []
const settingsState = {
  enabled: true,
  tools: ['write', 'edit', 'str_replace_editor'],
  minDiffLines: 0,
  includeCreate: true,
  includeDelete: true,
}
const settingsScope = {
  get: () => ({ ...settingsState }),
  update: async (patch) => { Object.assign(settingsState, patch) },
  replace: async () => {},
  watch: () => () => {},
}
ctx.provide('fs', {
  resolve: async (path, opts) => ({
    targetKey: path,
    displayPath: path.startsWith('/') ? path : (opts?.cwd ? `${opts.cwd}/${path}` : path),
  }),
  stat: async (target) => (files.has(target.displayPath) ? { version: 'v', type: 'file' } : undefined),
  readText: async (target) => {
    const content = files.get(target.displayPath)
    if (content === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return content
  },
})
ctx.provide('commands', { register: (d) => { commands.push(d); return () => {} } })
ctx.provide('settings', { register: () => settingsScope })

plugin.apply(ctx, {})

// The dynamic ctx.inject callback mounts the listener and commands on a later tick.
const waitFor = (pred) => new Promise((resolve, reject) => {
  const t0 = Date.now()
  const probe = () => (pred() ? resolve() : (Date.now() - t0 > 2000 ? reject(new Error('timeout waiting for mount')) : setTimeout(probe, 1)))
  probe()
})
await waitFor(() => commands.length === 1)
check('plugin mounted (1 command registered)', true, '')

const preExecute = (name, args, agent = undefined) => ctx.waterfall(
  ctx,
  'tools/pre-execute',
  { callId: `c-${Math.random().toString(36).slice(2)}`, name, arguments: args, agent, signal: new AbortController().signal },
  () => Promise.resolve({ kind: 'allow' }),
)

// ---- 3. interception behavior (built artifact) ----
const ask = await preExecute('edit', { file_path: 'src/a.ts', old_string: 'before', new_string: 'after' }, {
  id: 'agent-1',
  session: { header: { cwd: '/workspace' } },
})
check('pre-execute asks for a tracked edit', ask.kind === 'ask', JSON.stringify(ask))
if (ask.kind === 'ask') {
  check(
    'ask reason carries tool · file and diff markers',
    /^edit · src\/a\.ts \(modify\)/.test(ask.reason) && ask.reason.includes('-before') && ask.reason.includes('+after'),
    ask.reason.split('\n')[0],
  )
}

const pass = await preExecute('bash', { command: 'echo hi' })
check('non-whitelisted tool passes through', pass.kind === 'allow', JSON.stringify(pass))

settingsState.enabled = false
const disabled = await preExecute('write', { file_path: 'x.ts', content: 'x' })
check('disabled plugin passes everything through', disabled.kind === 'allow', JSON.stringify(disabled))
settingsState.enabled = true

// ---- 4. slash commands ----
const byName = (n) => commands.find((c) => c.name === n)
const edit = byName('approval-edit')
check('approval-edit registered', edit !== undefined, commands.map((c) => c.name).join(','))
const status = await edit.handler({ rawInput: 'status', agent: { id: 'x' }, signal: new AbortController().signal })
check('approval-edit status reflects enabled', status.kind === 'success' && status.text.includes('on'), JSON.stringify(status))

console.log(failures === 0 ? '\nverify-host: all checks passed' : `\nverify-host: ${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
