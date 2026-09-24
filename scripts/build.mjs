#!/usr/bin/env node
/**
 * Build: one script, three artifacts.
 *
 *   `lib/index.js`  — host half: `src/index.ts` bundled to ESM. Every
 *                     `@deepseek-ai/*` import stays external (the harness
 *                     resolves those from its own installation); everything
 *                     else — `diff` included — is inlined, so the package has
 *                     NO runtime dependencies.
 *   `lib/client.js` — client half: `src/client/index.ts` bundled to CJS and
 *                     wrapped in the web boot handoff
 *                     `window.__ModuleLoader__.load({ id, factory })`, the
 *                     closure-factory format every `dsh.client` package's
 *                     `./client` export must use.
 *   `lib/types/**`  — declarations, emitted by tsc (one config per half).
 *
 * Type checking is a separate step (`npm run typecheck`); this script
 * transpiles and then runs the smoke checks below. Those checks exist because
 * both failure modes that cost this plugin an entire DSH line were SILENT: a
 * stale browser externals list naming packages the new line had removed, and a
 * call into an API the new line had deleted.
 *
 * @module dsh-edit-approval/scripts/build
 */

import { execSync } from 'node:child_process'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))

/**
 * The browser module table the shell freezes and shares into every dynamic
 * bundle (`PLATFORM_MODULES`) — used AS the client bundle's externals list, not
 * intersected with a hand-written subset.
 *
 * A subset has a silent failure mode: esbuild INLINES any platform module that
 * is not external, so dropping an entry leaves no `require("react")` behind to
 * inspect — the bundle just quietly carries a second copy of React and the
 * page's hooks break. Externalizing the whole baseline costs nothing (esbuild
 * emits a require only for what is actually imported) and removes the drift.
 *
 * Kept as a literal list because this package builds OUTSIDE the harness repo;
 * re-read it from the harness source on every DSH line bump —
 * `packages/client/web/src/platform.ts` — or, without a checkout, from the
 * shipped shell bundle:
 *
 *   F=$(dirname "$(node -p "require.resolve('@deepseek-ai/dsh-web-frontend/package.json')")")
 *   grep -ho 'function [A-Za-z_$][A-Za-z0-9_$]*(){return{react:[^}]*}}' "$F"/dist/assets/index-*.js
 *
 * (The extracting function's name is a minifier artifact — never pin it.)
 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/**
 * Package specifiers the 0.1.7 line REMOVED. Naming one anywhere in this
 * package is the exact defect that made this plugin load and then do nothing.
 */
const REMOVED_PACKAGES = [
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-schema-form',
]

/** Every module specifier the bundle pulls in at runtime (imports or requires). */
function specifiersOf(source) {
  const found = new Set()
  for (const pattern of [/from\s*"([^"]+)"/g, /\bimport\s*\(\s*"([^"]+)"/g, /\brequire\(\s*"([^"]+)"\s*\)/g]) {
    for (const match of source.matchAll(pattern)) found.add(match[1])
  }
  return [...found]
}

/** Whether a specifier is a Node builtin (`node:`-prefixed or bare). */
function isBuiltin(specifier) {
  return specifier.startsWith('node:')
}

/** Recursively list the client half's sources (its real build inputs). */
async function clientSources(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await clientSources(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

/**
 * The bare module specifiers the client sources import in a VALUE position.
 *
 * This is the check that matters, and it has to read the SOURCES rather than the
 * artifact: esbuild INLINES any platform module missing from `external`, so a
 * dropped entry leaves no `require("react")` behind to inspect — the bundle just
 * quietly carries a second copy of React.
 *
 * `import type` / `export type` statements are erased by the compiler (the
 * project sets `verbatimModuleSyntax`, so type-only imports are always spelled
 * with `type`), which is why they place no requirement on the module table and
 * are stripped before scanning.
 *
 * @returns the value-position specifiers, sorted.
 */
async function clientValueImports() {
  const found = new Set()
  for (const file of await clientSources(join(ROOT, 'src', 'client'))) {
    const source = (await readFile(file, 'utf8'))
      .replace(/\b(?:import|export)\s+type\b[\s\S]*?from\s*['"][^'"]+['"]/g, '')
    for (const match of source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) {
      const specifier = match[1]
      if (specifier.startsWith('.') || isBuiltin(specifier)) continue
      found.add(specifier)
    }
  }
  return [...found].sort()
}

// ---- clean: stale declarations from a removed module must not reach the tarball ----
await rm(join(ROOT, 'lib'), { recursive: true, force: true })
await mkdir(join(ROOT, 'lib'), { recursive: true })

// ---- declarations: one config per half (tsc only ever emits types here) ----
execSync('npx tsc -p tsconfig.build.json', { cwd: ROOT, stdio: 'inherit' })
execSync('npx tsc -p tsconfig.client.json', { cwd: ROOT, stdio: 'inherit' })

// ---- host half: bundled TS -> ESM (@deepseek-ai/* stays external) ----
// `metafile` exposes the exact file list that went INTO each bundle, which is
// the only reliable way to prove what was externalized versus silently inlined.
const hostResult = await build({
  entryPoints: [join(ROOT, 'src', 'index.ts')],
  outfile: join(ROOT, 'lib', 'index.js'),
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  bundle: true,
  external: ['@deepseek-ai/*'],
  sourcemap: false,
  logLevel: 'info',
  metafile: true,
})

// ---- client half: bundled TSX -> CJS, then wrapped in the loader handoff ----
const clientResult = await build({
  entryPoints: [join(ROOT, 'src', 'client', 'index.ts')],
  outfile: join(ROOT, 'lib', '_client.js'),
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  bundle: true,
  jsx: 'automatic',
  external: PLATFORM_MODULES,
  sourcemap: false,
  logLevel: 'info',
  metafile: true,
})
const clientBody = await readFile(join(ROOT, 'lib', '_client.js'), 'utf8')
await rm(join(ROOT, 'lib', '_client.js'))

const handoff = [
  '/* dsh-edit-approval client bundle — generated by scripts/build.mjs from src/client/ */',
  'window.__ModuleLoader__.load({',
  `  id: ${JSON.stringify(pkg.name)},`,
  '  factory: (require) => {',
  '    var module = { exports: {} };',
  '    var exports = module.exports;',
  clientBody.replace(/\s+$/, '\n'),
  '    return module.exports;',
  '  }',
  '});',
  '',
].join('\n')
await writeFile(join(ROOT, 'lib', 'client.js'), handoff)

// ============================ smoke checks ============================

const host = await readFile(join(ROOT, 'lib', 'index.js'), 'utf8')
const failures = []
const check = (name, ok) => { if (!ok) failures.push(name) }

// 1. The host half must still export the plugin shape the loader reads.
const exportBlock = host.slice(host.lastIndexOf('export {'))
for (const needle of ['name', 'inject', 'apply']) {
  check(`host bundle exports ${needle}`, exportBlock.includes(needle))
}

// 2. No reference to a package the target line removed. The host half used to
//    import `dsh-settings`'s `settingsNamespace`, which 0.1.2 deleted; the
//    browser half used to import `dsh-client-runtime`, which 0.1.7 deleted.
for (const removed of REMOVED_PACKAGES) {
  check(`host bundle does not reference ${removed}`, !host.includes(removed))
  check(`client bundle does not reference ${removed}`, !clientBody.includes(removed))
  check(`package.json does not name ${removed}`, !JSON.stringify(pkg).includes(removed))
}
check('host bundle does not statically import settingsNamespace', !host.includes('settingsNamespace'))

// 3. Everything the host bundle imports is either a harness package or a Node
//    builtin. This is what proves `diff` is INLINED rather than left as a bare
//    specifier with no dependency to satisfy it.
for (const specifier of specifiersOf(host)) {
  const ok = specifier.startsWith('@deepseek-ai/') || isBuiltin(specifier)
  check(`host bundle imports only harness/node modules (saw ${specifier})`, ok)
}
check('host bundle kept no relative import', !specifiersOf(host).some(s => s.startsWith('.')))

// 4. Every module the client bundle requires at runtime must come from the
//    shell's frozen table — anything else cannot resolve in the page.
for (const specifier of specifiersOf(clientBody)) {
  check(`client bundle requires only platform modules (saw ${specifier})`, PLATFORM_MODULES.includes(specifier))
}
// 4b. Every bare module the client SOURCES import in a value position must be a
//     platform module too — the guard for a package the new DSH line removed.
for (const specifier of await clientValueImports()) {
  check(`client source import ${specifier} is a platform module`, PLATFORM_MODULES.includes(specifier))
}
// 4c. THE COMPLETE INVARIANT: the client bundle contains OUR code and nothing
//     else. Every dependency must be external, so no bundled input may live
//     under node_modules. This is the only check that also covers imports the
//     sources never spell out — the `react/jsx-runtime` the JSX transform
//     injects, most importantly: dropping it from the baseline would inline a
//     second React copy and every other check here would still pass.
const clientInputs = Object.keys(clientResult.metafile.inputs)
for (const input of clientInputs) {
  check(`client bundle inlined only project sources (saw ${input})`, !input.includes('node_modules/'))
}
// 4d. The host half must NOT inline a harness package: `@deepseek-ai/*` stays
//     external (the harness resolves it), while `diff` is deliberately inlined,
//     so a node_modules input is fine only when it is not a harness package.
for (const input of Object.keys(hostResult.metafile.inputs)) {
  check(`host bundle kept harness packages external (saw ${input})`, !input.includes('node_modules/@deepseek-ai/'))
}

// 5. The loader handoff must carry the exact package id: client-modules
//    registers the factory under it and every importer requires that name.
for (const needle of ['window.__ModuleLoader__.load', `id: ${JSON.stringify(pkg.name)}`]) {
  check(`client bundle carries ${needle}`, handoff.includes(needle))
}

// 6. Every path the manifest references must exist in the artifact.
for (const artifact of ['lib/index.js', 'lib/client.js', 'lib/types/index.d.ts', 'lib/types/client/index.d.ts']) {
  try {
    await readFile(join(ROOT, artifact), 'utf8')
  } catch {
    check(`artifact ${artifact} exists`, false)
  }
}

if (failures.length > 0) {
  console.error(`\nbuild: ${failures.length} smoke check(s) FAILED`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('build ok: lib/index.js (host ESM), lib/client.js (loader handoff), lib/types/ (declarations)')
