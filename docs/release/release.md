# Release

## Version alignment: one DSH line at a time

`package.json` declares the DSH line this plugin is verified against as a
**single** peer tuple plus an engine floor:

```jsonc
"dsh": { "engines": { "dsh": ">=0.1.7-rc.1" } },
"peerDependencies": {
  "@deepseek-ai/dsh-tools": "^0.1.7-rc.1",
  // … every harness package, the same tuple
}
```

Two semver rule sets make this harder to reason about than it looks, so keep both
in mind when moving lines (the full explanation is in
[`../compat/0.1.7-audit.md`](../compat/0.1.7-audit.md) §1):

- **npm** only matches a prerelease candidate when the range carries a comparator
  on the *same* `[major, minor, patch]` tuple — so npm needs a new `||` term per
  tuple, which is exactly why a union is tempting.
- **DSH's startup admission gate** evaluates with `includePrerelease: true`, so a
  single `^0.1.x-pre` term already covers the whole `0.1` line. A union therefore
  does not narrow anything at the gate; it only overstates what was verified.

The plugin targets the line it was verified on. An older runtime skips the bundle
at startup with a peer diagnostic — a loud, diagnosable outcome — instead of
loading it into a state where it silently does nothing.

`node scripts/check-dsh-version.mjs` guards the declaration: every harness peer
must carry the identical tuple sequence, `dsh.engines.dsh` must equal the oldest
declared floor, and a release published above the declared window is reported
(exit 1). Run it before cutting a release.

## Cutting a release

```sh
npm run check                                        # the full gate, must be green
node scripts/check-dsh-version.mjs                   # declaration still honest?
npm version patch                                    # or minor / major
git push origin main --tags                          # triggers .github/workflows/publish.yml
```

`npm version` rewrites `package.json` and creates the tag; the workflow then
verifies the tag matches `package.json`, runs the same gate, publishes through
GitHub Actions Trusted Publishing (OIDC, no stored `NPM_TOKEN`) with Sigstore
provenance, and creates a GitHub Release. Publishing is idempotent — a version
already on the registry is skipped. CI (`.github/workflows/ci.yml`) runs the same
gate on every push and pull request.

Use `minor` for a change to the configuration surface or the published exports;
this plugin is `0.x`, so those are the breaking axis. `0.4.0` was the DSH
0.1.7-rc.1 adaptation, which removed two settings namespaces and renamed every
configuration key.

> Local note: in a sandbox where the default npm cache is not writable,
> `npm pack --dry-run` fails with `EROFS`. Point it at a writable cache —
> `npm_config_cache=./.npm-cache npm run check` — rather than treating it as a
> code failure.

## Moving to a new DSH line

Do these in order; each one turns a silent failure mode into a loud one.

1. **Bump the pinned devDependencies** to the new line's exact versions and
   reinstall. Do it FIRST: until it is done, `tsc` type-checks against the old
   surface and cannot see a removal. Expect (and read) new compile errors.
2. **Re-read the shell's frozen module table.**
   `packages/client/web/src/platform.ts` in the harness repo, or, without a
   checkout:
   ```sh
   F=$(dirname "$(node -p "require.resolve('@deepseek-ai/dsh-web-frontend/package.json')")")
   grep -ho 'function [A-Za-z_$][A-Za-z0-9_$]*(){return{react:[^}]*}}' "$F"/dist/assets/index-*.js
   ```
   Update `PLATFORM_MODULES` in `scripts/build.mjs` if it changed. The extracting
   function's name is a minifier artifact — never pin it.
3. **Re-check the settings model.** The volatile/ordinary split, the entry id the
   write path keys on, and the config-page policy (`configure({ auto: false })`)
   are all 0.1.7-era shapes. `tests/config.spec.ts` and `verify-host` pin them;
   if the settings service changed, those probes should fail first.
4. **Re-check the approval panel DOM anchors.** `data-approval-key`,
   `data-approval-scroll` and the headline's position are an unsanctioned
   coupling. Grep the shipped `dsh-client-ui-approval` client bundle for the two
   attributes; if they moved, the diff rendering has to move with them.
5. **Run the gate and expect it to fail where it should.** The build smoke checks
   and the anchored `verify-host` double exist to be the loud failure. If
   everything passes on the first try after a line bump, be suspicious — read
   §2 of the audit for what "everything passed" cost last time.
6. **Record the result in `docs/compat/0.1.7-audit.md`** (rename the file to the
   new line, update the seam table, and move anything newly verified out of the
   uncovered-boundaries list) in the same commit as the version bump.
