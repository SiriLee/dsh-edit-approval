#!/usr/bin/env node
/**
 * check-dsh-version.mjs — watch the DSH release cadence without watching the repo.
 *
 * DSH publishes every @deepseek-ai/dsh-* package at the same version, so the
 * registry's version list for @deepseek-ai/dsh is the single authoritative
 * release signal.
 *
 * npm's prerelease matching rule only accepts a prerelease candidate when the
 * range contains a comparator on the SAME [major, minor, patch] tuple, so a
 * peer range like "^0.1.0-rc.6 || ^0.1.1-rc.2" silently stops matching the day
 * DSH bumps to a new tuple — while same-tuple rc rolls (0.1.1-rc.2 → rc.3) keep
 * working and need no action. There is no shorthand for "every prerelease of
 * every 0.1.x line": package.json cannot pass `includePrerelease`,
 * `>=X.Y.Z-pre <0.2.0` misses every later tuple, and `0.1.x-pre` desugars to
 * `>=0.1.0 <0.2.0-0` (which matches nothing at all). One `^X.Y.Z-pre` term per
 * tuple is the only faithful encoding, so this script guards the encoding
 * itself rather than only the newest tag:
 *
 *   A. every @deepseek-ai/dsh-* peer must encode the SAME ordered tuple
 *      sequence; per-tuple floors may differ where a package starts shipping
 *      later (dsh-settings carries `^0.1.0-rc.8`).
 *   B. `dsh.engines.dsh` must exist as a single `>=X.Y.Z[-pre]` floor equal to
 *      the oldest declared floor — plugin managers read it as the update guard
 *      and fail closed on `^` / `~` / multi-range values.
 *   C. the published version list is classified against the declared window, so
 *      a release above the ceiling cannot slip through unnoticed.
 *
 * Exit codes:
 *   0 — declaration is consistent and the newest published DSH is covered.
 *   1 — ACTION NEEDED: a DSH version above the declared window is published.
 *   2 — registry unreachable or unparseable (never blocks a release as "OK").
 *   3 — the declaration itself drifted (peer tuples disagree, engines floor
 *       mismatch, or a range shape this script cannot verify).
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))

const PACKAGE = '@deepseek-ai/dsh'
const REGISTRY = `https://registry.npmjs.org/${PACKAGE}`
/** The only peer term shape this script can verify: `^X.Y.Z[-pre]`. */
const PEER_TERM = /^\^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/
/** The engine floor form plugin managers accept: a single `>=X.Y.Z[-pre]`. */
const ENGINE_FLOOR = /^>=(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/

/** Parse a version into its numeric triple plus prerelease identifiers. */
function parseVersion(value) {
  const match = VERSION.exec(value)
  if (match === null) return null
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/** Compare two versions by semver precedence (a prerelease sorts below its release). */
function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === null || b === null) throw new Error(`unparseable version: ${a === null ? left : right}`)
  for (let index = 0; index < 3; index += 1) {
    if (a.parts[index] !== b.parts[index]) return a.parts[index] < b.parts[index] ? -1 : 1
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    if (a.prerelease.length === b.prerelease.length) return 0
    return a.prerelease.length === 0 ? 1 : -1
  }
  const width = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < width; index += 1) {
    const x = a.prerelease[index]
    const y = b.prerelease[index]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const xNumeric = /^\d+$/.test(x)
    const yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) return Number(x) < Number(y) ? -1 : 1
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1
    return x < y ? -1 : 1
  }
  return 0
}

/** The `[major, minor, patch]` tuple a version or range term belongs to. */
function tupleOf(value) {
  return value.split('-')[0]
}

/** The lowest version in a list. */
function lowest(versions) {
  return versions.reduce((winner, value) => (compareVersions(value, winner) < 0 ? value : winner))
}

/** The highest version in a list. */
function highest(versions) {
  return versions.reduce((winner, value) => (compareVersions(value, winner) > 0 ? value : winner))
}

function reportDrift(problems) {
  console.error('check-dsh-version: declaration drifted — fix package.json before releasing:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(3)
}

const peers = Object.keys(MANIFEST.peerDependencies ?? {})
  .filter((name) => name.startsWith('@deepseek-ai/dsh-'))
  .sort()

if (peers.length === 0) {
  console.log('check-dsh-version: no @deepseek-ai/dsh-* peer declared — nothing to track')
  process.exit(0)
}

const drift = []
const declarations = []
for (const name of peers) {
  const terms = []
  for (const clause of MANIFEST.peerDependencies[name].split('||')) {
    const term = clause.trim()
    const match = PEER_TERM.exec(term)
    if (match === null) {
      drift.push(
        `${name}: cannot verify range term "${term}" (expected ^X.Y.Z[-pre] — teach this ` +
          'script any deliberately new shape, such as a stable ^X.Y.x range, before shipping it)',
      )
      break
    }
    terms.push({ version: match[1], tuple: tupleOf(match[1]) })
  }
  if (terms.length > 0) declarations.push({ name, terms })
}
if (drift.length > 0) reportDrift(drift)

const [reference, ...others] = declarations
const referenceTuples = reference.terms.map((term) => term.tuple).join(', ')
for (const declaration of others) {
  const tuples = declaration.terms.map((term) => term.tuple).join(', ')
  if (tuples !== referenceTuples) {
    drift.push(
      `${declaration.name}: tuples [${tuples}] disagree with ${reference.name} [${referenceTuples}]`,
    )
  }
}

/** The most permissive floor per tuple across every peer: the union's floor. */
const floors = new Map()
for (const declaration of declarations) {
  for (const term of declaration.terms) {
    const current = floors.get(term.tuple)
    if (current === undefined || compareVersions(term.version, current) < 0) {
      floors.set(term.tuple, term.version)
    }
  }
}
const oldestFloor = lowest([...floors.values()])

const engineFloor = MANIFEST.dsh?.engines?.dsh
if (typeof engineFloor !== 'string') {
  drift.push('dsh.engines.dsh is missing (plugin managers read it as the runtime floor)')
} else {
  const match = ENGINE_FLOOR.exec(engineFloor)
  if (match === null) {
    drift.push(
      `dsh.engines.dsh "${engineFloor}" is not a single >=X.Y.Z[-pre] floor (^ / ~ / multi-range fail closed)`,
    )
  } else if (compareVersions(match[1], oldestFloor) !== 0) {
    drift.push(`dsh.engines.dsh = ${match[1]} but the oldest declared floor is ${oldestFloor}`)
  }
}
if (drift.length > 0) reportDrift(drift)

let packument
try {
  const response = await fetch(REGISTRY, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  })
  if (!response.ok) throw new Error(`registry responded ${response.status}`)
  packument = await response.json()
} catch (error) {
  console.error(`check-dsh-version: cannot reach npm registry (${error.message})`)
  process.exit(2)
}

const latest = packument['dist-tags']?.latest
const published = Object.keys(packument.versions ?? {})
if (typeof latest !== 'string' || published.length === 0) {
  console.error('check-dsh-version: registry payload is missing dist-tags.latest or versions')
  process.exit(2)
}

const ordered = [...published].sort(compareVersions)
const covered = []
const belowFloor = []
const unmapped = []
for (const version of ordered) {
  const floor = floors.get(tupleOf(version))
  if (floor === undefined) unmapped.push(version)
  else if (compareVersions(version, floor) < 0) belowFloor.push(version)
  else covered.push(version)
}
const newest = ordered[ordered.length - 1]
/**
 * Highest declared version: the ceiling above which a release needs a new term.
 * Every declared term accepts same-tuple rolls above its floor, so the top of
 * the window is the newest covered release — or, with an empty window, the
 * highest declared floor.
 */
const ceiling = covered[covered.length - 1] ?? highest([...floors.values()])

console.log(`DSH latest:      ${latest}`)
console.log(`declared tuples: ${referenceTuples}`)
console.log(
  `tuple floors:    ${[...floors.entries()].map(([tuple, floor]) => `${tuple} >= ${floor}`).join(', ')}`,
)
console.log(`engine floor:    ${engineFloor}`)
console.log(`covered:         ${covered.length}/${ordered.length} published versions (ceiling ${ceiling})`)
if (belowFloor.length > 0) console.log(`below floor:     ${belowFloor.join(' ')}`)
if (unmapped.length > 0) console.log(`outside window:  ${unmapped.join(' ')}`)

const gaps = unmapped.filter(
  (version) => compareVersions(version, oldestFloor) > 0 && compareVersions(version, ceiling) < 0,
)
if (gaps.length > 0) {
  console.log(
    `WARN: published inside the declared window but never declared: ${gaps.join(' ')} — ` +
      'either accept the gap in the README or drop the surrounding lines from the window.',
  )
}

if (covered.length === 0) {
  console.log(
    'ACTION NEEDED: no published DSH release falls inside the declared window — the floors ' +
      'look ahead of the registry. Fix package.json instead of trusting the declaration.',
  )
  process.exit(1)
}

if (compareVersions(newest, ceiling) <= 0) {
  console.log('OK: every published DSH release is inside the declared window.')
  process.exit(0)
}

console.log(`ACTION NEEDED: DSH published ${newest}, above the declared ceiling (${ceiling}).`)
console.log(`  1. Append "|| ^${newest}" (the verified floor) to every @deepseek-ai/dsh-* peer`)
console.log('     range in package.json, keeping the tuple order identical across peers.')
console.log(`  2. Leave dsh.engines.dsh at the oldest floor (>=${oldestFloor}) unless the old lines are dropped.`)
console.log(`  3. Bump the @deepseek-ai/dsh-* devDependencies to ^${latest}, npm install, rerun`)
console.log('     typecheck / tests / scripts/verify-host.mjs, then release.')
process.exit(1)
