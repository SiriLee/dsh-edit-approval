#!/usr/bin/env node
/**
 * Self-contained portable build used by the `prepare` lifecycle script.
 *
 * Runs on pnpm's git-dependency preparation (and on `npm pack`), where only
 * registry-available devDependencies exist — no local deepseek-harness
 * checkout, so no `@deepseek-ai/*` types. esbuild needs no type resolution:
 * type-only imports are erased, runtime `@deepseek-ai/*` imports stay
 * external (resolved at runtime by the dsh profile), and relative `.ts`
 * imports are bundled inline.
 *
 * Contributors who want typed artifacts run `npm run build` (tsc) instead.
 */

import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { buildClientBundle } from './build-client.mjs'

await mkdir('lib', { recursive: true })

// Host half: one ESM bundle, external @deepseek-ai/* and node builtins.
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'es2022',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
})

// Browser half: the __ModuleLoader__.load handoff artifact (single source).
await buildClientBundle()
