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
    sourcemap: true,
    logLevel: 'info',
    banner: { js: CLIENT_BANNER },
    footer: { js: CLIENT_FOOTER },
  })
}

// Direct execution (npm run build:client): build immediately.
if (import.meta.url === new URL(`file://${process.argv[1] ?? ''}`).href) {
  await buildClientBundle()
}
