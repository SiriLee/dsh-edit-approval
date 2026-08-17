#!/usr/bin/env node
/**
 * Client bundle build — the single source of truth for the
 * `window.__ModuleLoader__.load({ id, factory })` handoff closure.
 *
 * Both the author build (`npm run build:client`) and the portable prepare
 * build (`scripts/build-portable.mjs`) call {@link buildClientBundle}, so the
 * loader id and the banner/footer strings can never drift.
 */

import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

/** The loader-handoff closure strings; generated once from the package name. */
export const CLIENT_BANNER = `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`
export const CLIENT_FOOTER = 'return module.exports; } });'

/** Build the browser bundle into lib/client.js (esbuild, CJS, loader handoff). */
export async function buildClientBundle() {
  await build({
    entryPoints: ['src/client/index.ts'],
    outfile: 'lib/client.js',
    bundle: true,
    platform: 'browser',
    format: 'cjs',
    target: 'es2022',
    // React JSX (react + react/jsx-runtime are platform modules, external).
    jsx: 'automatic',
    // Platform modules resolve through the loader module table at runtime —
    // inlining them would duplicate React/cordis instances and break hooks
    // isolation. Mirrors the harness CLIENT_EXTERNALS list.
    external: [
      'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-web-react',
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/dsh-client-ui-attachment',
      '@deepseek-ai/dsh-client-schema-form',
      '@deepseek-ai/dsh-client-runtime/client',
    ],
    sourcemap: true,
    logLevel: 'info',
    banner: { js: CLIENT_BANNER },
    footer: { js: CLIENT_FOOTER },
  })
  // Smoke check: the artifact must carry the loader handoff with the exact
  // package id — a build regression (e.g. an inlined banner) fails here, in
  // the build step, instead of silently breaking the browser boot.
  const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const expected = `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}`
  if (!bundle.includes(expected)) {
    throw new Error(`client bundle missing loader handoff for ${pkg.name}`)
  }
}

// Direct execution (npm run build:client): build immediately. pathToFileURL
// keeps the check working on Windows drive-letter paths.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildClientBundle()
}
