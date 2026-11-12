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
 *   B. `engines.dsh` must carry the SAME bounded `^X.Y.Z[-pre]` range as the
 *      peers: the admission gate lets an own `engines.dsh` decide ALONE and
 *      ignores every peer, so a bare `>=floor` there silently drops the ceiling.
 *   C. the published version list is classified against the declared WINDOW
 *      (`[floor, next-minor-0)`), the same predicate the gate applies.
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
const ENGINE_FLOOR = /^\^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/
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

/**
 * One window per declared term: `^A.B.C[-pre]` covers `[A.B.C-pre,
 * A.(B+1).0-0)`. That `-0` upper bound is the caret's own desugaring, and it is
 * why a window stops short of the next minor's prereleases — the same predicate
 * the admission gate applies with `includePrerelease`. Classifying releases by
 * tuple instead made this script disagree with the gate in both directions.
 */
const windows = reference.terms.map((term) => {
  const parsed = parseVersion(term.version)
  return { floor: term.version, ceiling: `${parsed.parts[0]}.${parsed.parts[1] + 1}.0-0` }
})

// The admission gate lets an own `engines.dsh` decide ALONE and ignores every
// peer (verified against 0.2.2: a bare `>=floor` here admitted 0.3.0-rc.1 and
// 1.0.0). So this field must carry the same BOUNDED range as the peers — a lower
// bound alone silently removes the line ceiling.
const engineFloor = MANIFEST.engines?.dsh
if (typeof engineFloor !== 'string') {
  drift.push('engines.dsh is missing — the admission gate prefers it alone, so omitting it moves the boundary')
} else {
  const match = ENGINE_FLOOR.exec(engineFloor)
  if (match === null) {
    drift.push(
      `engines.dsh "${engineFloor}" must be a bounded ^X.Y.Z[-pre] range: the gate reads it alone, ` +
        'so a bare >= floor or a multi-range would drop the ceiling the peers encode',
    )
  } else if (reference !== undefined) {
    const peerRange = MANIFEST.peerDependencies[reference.name]
    if (engineFloor !== peerRange) {
      drift.push(`engines.dsh "${engineFloor}" must equal the peer range "${peerRange}" (one window, two readers)`)
    }
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
const newest = ordered[ordered.length - 1]

const inside = (version) => windows.some(
  (window) => compareVersions(version, window.floor) >= 0 && compareVersions(version, window.ceiling) < 0,
)
const covered = ordered.filter(inside)
const belowFloor = ordered.filter(
  (version) => windows.every((window) => compareVersions(version, window.floor) < 0),
)
const aboveWindow = ordered.filter(
  (version) => windows.every((window) => compareVersions(version, window.ceiling) >= 0),
)

console.log(`registry latest:  ${latest}`)
console.log(`newest published: ${newest}`)
console.log(`declared window:  ${MANIFEST.peerDependencies[reference.name]}`)
console.log(`                  ${windows.map((w) => `[${w.floor}, ${w.ceiling})`).join(' ∪ ')}`)
console.log(`engines.dsh:      ${engineFloor}`)
console.log(
  `covered:          ${covered.length}/${ordered.length} published versions` +
    (covered.length > 0 ? ` (newest ${covered[covered.length - 1]})` : ''),
)
if (belowFloor.length > 0) {
  console.log(`older lines:      ${belowFloor.length} releases below the window floor (dropped by design)`)
}

if (covered.length === 0) {
  console.log(
    'ACTION NEEDED: no published DSH release falls inside the declared window — the range ' +
      'looks ahead of the registry. Fix package.json instead of trusting the declaration.',
  )
  process.exit(1)
}

if (aboveWindow.length === 0) {
  console.log('OK: no published DSH release is above the declared window.')
  process.exit(0)
}

console.log(`ACTION NEEDED: DSH published ${newest}, above the declared window.`)
console.log(`  1. Replace every @deepseek-ai/dsh-* peer range with ^${newest} (the verified floor).`)
console.log('     The single-line model REPLACES, it never widens: a union re-admits the dropped lines')
console.log('     and the admission gate stops distinguishing what was actually verified.')
console.log(`  2. Set engines.dsh to "^${newest}" — the SAME bounded range as the peers. The gate reads`)
console.log('     it alone, so a bare floor there would remove the ceiling entirely.')
console.log(`  3. Pin every @deepseek-ai/dsh-* devDependency to ${newest}, npm install, rerun`)
console.log('     typecheck / tests / scripts/verify-host.mjs, then release.')
process.exit(1)
