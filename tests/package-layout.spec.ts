import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Read a PNG's pixel dimensions from its IHDR chunk (no image dependency). */
function pngSize(path: string): { width: number; height: number } {
  const header = readFileSync(path).subarray(0, 24)
  if (header.subarray(0, 8).toString('latin1') !== '\x89PNG\r\n\x1a\n') throw new Error(`${path} is not a PNG`)
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
}

/**
 * Publish-layout contract: the manifest, the bundle patch, and the locale
 * resources the Plugins page reads.
 *
 * Everything here is a fact a human would otherwise have to re-verify by
 * reading the harness source: which export subpaths the loader resolves, which
 * files the tarball must carry, and which manifest fields the DSH bundle card
 * falls back through. A drift in any of them fails silently at runtime (a card
 * with no localized copy, a client half that never loads), so it is pinned
 * here.
 */

const ROOT = process.cwd()
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, any>

/** Packages the 0.1.7 line removed; naming one is the defect that broke this plugin. */
const REMOVED_PACKAGES = [
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-schema-form',
]

/** Every manifest layout item that must be shipped in the tarball. */
const REQUIRED_FILES = ['lib', 'docs', 'cordis.patch.yml', 'LICENSE', 'README.md', 'README.zh.md', 'locale/*.json']

describe('manifest identity', () => {
  it('names the package once, consistently', () => {
    expect(pkg.name).toBe('dsh-edit-approval')
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(pkg.license).toBe('MIT')
  })

  it('carries a bilingual, single-line description', () => {
    // The bundle card falls back to this string when no locale resource
    // declares one, so it must read in both languages.
    expect(typeof pkg.description).toBe('string')
    expect(pkg.description).toMatch(/[A-Za-z]/)
    expect(pkg.description).toMatch(/[\u4e00-\u9fff]/)
    expect(pkg.description).toContain('·')
    expect(pkg.description.length).toBeLessThan(120)
  })

  it('supports the Node majors the plugin targets', () => {
    expect(pkg.engines?.node).toBe('^22.19.0 || >=24.0.0')
  })

  it('publishes publicly and declares no runtime dependency', () => {
    expect(pkg.publishConfig?.access).toBe('public')
    // The host half is bundled, so `diff` and everything else is inlined.
    expect(pkg.dependencies ?? {}).toEqual({})
    expect(pkg.devDependencies?.diff).toBeDefined()
  })
})

describe('export surface', () => {
  it('resolves the host half, the client half, the locale resources and its own manifest', () => {
    // `dsh-client-modules` reads `exports["./client"]` verbatim, and app-boot
    // resolves `<pkg>/locale/en.json` and `<pkg>/package.json` through Node's
    // export map — a missing subpath silently costs the card its copy.
    expect(Object.keys(pkg.exports)).toEqual(expect.arrayContaining(['.', './client', './locale/*.json', './package.json']))
    expect(pkg.exports['./client']).toEqual({
      types: './lib/types/client/index.d.ts',
      default: './lib/client.js',
    })
    expect(pkg.main).toBe('lib/index.js')
    expect(pkg.types).toBe('lib/types/index.d.ts')
  })

  it('ships every path the manifest references', () => {
    for (const entry of REQUIRED_FILES) {
      expect(pkg.files, `files is missing ${entry}`).toContain(entry)
    }
    for (const file of ['LICENSE', 'README.md', 'README.zh.md', 'cordis.patch.yml', 'docs/README.md', 'docs/compat/0.1.7-audit.md']) {
      expect(existsSync(join(ROOT, file)), `${file} does not exist`).toBe(true)
    }
  })
})

describe('localized bundle-card metadata', () => {
  for (const lang of ['en', 'zh']) {
    it(`declares a non-empty title and description in locale/${lang}.json`, () => {
      const meta = JSON.parse(readFileSync(join(ROOT, 'locale', `${lang}.json`), 'utf8')).meta
      expect(typeof meta.title).toBe('string')
      expect(meta.title.length).toBeGreaterThan(0)
      expect(typeof meta.description).toBe('string')
      expect(meta.description.length).toBeGreaterThan(0)
    })
  }

  it('treats locale/en.json as the discovery entry app-boot reads', () => {
    // app-boot probes `<pkg>/locale/en.json` specifically; without it the whole
    // directory is ignored, whatever else it holds.
    expect(existsSync(join(ROOT, 'locale', 'en.json'))).toBe(true)
  })
})

describe('dsh bundle declaration', () => {
  it('declares the bundle patch and the web client platform', () => {
    expect(pkg.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(pkg.dsh?.client?.platform).toBe('web')
    expect(Array.isArray(pkg.dsh?.client?.inject)).toBe(true)
  })

  it('lists only real client packages as module-arrival dependencies', () => {
    // `dsh.client.inject` names package rows that must load first — not cordis
    // service names, and not this package itself.
    for (const name of pkg.dsh.client.inject as string[]) {
      expect(REMOVED_PACKAGES, `${name} was removed by DSH 0.1.7`).not.toContain(name)
      expect(pkg.devDependencies?.[name], `${name} is not a declared dependency`).toBeDefined()
    }
    expect(pkg.dsh.client.inject).not.toContain(pkg.name)
  })

  it('sets the client external list through the build, not the manifest', () => {
    // The externals come from the shell's frozen module table and are applied
    // in scripts/build.mjs; declaring them here as well would let the two drift.
    expect(pkg.dsh.client.external).toBeUndefined()
  })
})

describe('single-line compatibility declaration', () => {
  const dshPeers = Object.keys(pkg.peerDependencies).filter((name) => name.startsWith('@deepseek-ai/dsh-'))

  it('declares one tuple for every harness peer, and nothing else', () => {
    expect(dshPeers.length).toBeGreaterThan(0)
    const tuples = new Set(dshPeers.map((name) => (pkg.peerDependencies[name] as string).match(/^\^(\d+\.\d+\.\d+)/)?.[1]))
    // One tuple shared by every peer IS the single-line model: a second term
    // would re-declare a DSH line this plugin no longer tracks.
    expect([...tuples]).toHaveLength(1)
    for (const name of dshPeers) {
      expect(pkg.peerDependencies[name], `${name} is not a single ^X.Y.Z-pre term`).toMatch(/^\^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/)
    }
  })

  it('keeps the engine floor in step with the declared tuple', () => {
    const floor = (pkg.peerDependencies[dshPeers[0]!] as string).slice(1)
    expect(pkg.dsh?.engines?.dsh).toBe(`>=${floor}`)
  })

  it('marks harness peers optional (the harness resolves them at runtime)', () => {
    for (const name of [...dshPeers, '@deepseek-ai/cordis', '@deepseek-ai/schemastery']) {
      expect(pkg.peerDependenciesMeta?.[name]?.optional, `${name} must be optional`).toBe(true)
    }
  })

  it('pins every harness devDependency exactly', () => {
    // Exact pins keep the verified build reproducible: a range would silently
    // follow the next prerelease and invalidate the recorded verification.
    for (const [name, range] of Object.entries(pkg.devDependencies ?? {})) {
      if (!name.startsWith('@deepseek-ai/')) continue
      expect(range, `${name} must be an exact pin`).toMatch(/^\d+\.\d+\.\d+/)
    }
  })

  it('names no package the target line removed', () => {
    const manifest = JSON.stringify(pkg)
    for (const removed of REMOVED_PACKAGES) {
      expect(manifest, `${removed} is still referenced`).not.toContain(removed)
    }
    expect(manifest).not.toContain('settingsNamespace')
  })
})

describe('bundle patch', () => {
  const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')

  it('inserts a row whose id and name are both the package name', () => {
    // `dsh-client-modules` resolves `require.resolve('<row-name>/package.json')`
    // to find the package and its dsh.client declaration, and the settings
    // service keys the configuration entry by the row id — so all three must be
    // the same string for the client half and the config card to line up.
    expect(patch).toContain(`id: ${pkg.name}`)
    expect(patch).toContain(`name: ${pkg.name}`)
    expect(patch.match(new RegExp(`id: ${pkg.name}`, 'g'))).toHaveLength(1)
  })

  it('carries no config: schema defaults are the single source of truth', () => {
    expect(patch).not.toMatch(/^\s+config:/m)
  })
})

describe('screenshots', () => {
  const listed = JSON.parse(readFileSync(join(ROOT, 'screenshots.json'), 'utf8')) as string[]
  const onDisk = readdirSync(join(ROOT, 'assets', 'screenshots')).sort()
  const READMES = ['README.md', 'README.zh.md']

  it('lists every asset under assets/screenshots, and nothing else', () => {
    // Two ways this drifts, both silent until a README renders a broken image:
    // an asset added but never listed, and an entry left behind by a deletion.
    expect(listed.map((rel) => rel.replace('assets/screenshots/', '')).sort()).toEqual(onDisk)
    for (const rel of listed) expect(existsSync(join(ROOT, rel)), `${rel} is listed but missing`).toBe(true)
  })

  it('lists only 16:9 captures, so the 2x2 grid stays square', () => {
    // The README lays the captures out in a 2x2 table at one width per cell, so
    // images sharing a row only line up when they share an aspect ratio. A
    // 2.6:1 crop sits in that grid as an obvious outlier. 1366x768 is off exact
    // 16:9 by 0.0008, hence the tolerance.
    for (const rel of listed) {
      const { width, height } = pngSize(join(ROOT, rel))
      expect(Math.abs(width / height - 16 / 9), `${rel} is ${width}x${height}, not 16:9`).toBeLessThan(0.01)
    }
  })

  it('has both READMEs reference exactly the same existing screenshots', () => {
    // Bilingual lockstep (see docs/README.md): a rename or a new capture has to
    // land in both files, and every reference has to resolve.
    const referenced = (file: string): string[] =>
      [...readFileSync(join(ROOT, file), 'utf8').matchAll(/assets\/screenshots\/[^"\s]+/g)]
        .map((match) => match[0])
        .sort()
    const [en, zh] = READMES.map(referenced)
    expect(zh).toEqual(en)
    for (const rel of en) expect(existsSync(join(ROOT, rel)), `${rel} is referenced but missing`).toBe(true)
    for (const rel of en) expect(listed, `${rel} is used by a README but not listed`).toContain(rel)
  })
})
