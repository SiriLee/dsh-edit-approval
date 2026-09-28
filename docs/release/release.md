# Release

## Version alignment: one DSH line at a time

`package.json` declares the DSH line this plugin is verified against as a
**single** peer tuple plus an engine floor:

```jsonc
"engines": { "node": "^22.19.0 || >=24.0.0", "dsh": ">=0.2.0-rc.1" },
"peerDependencies": {
  "@deepseek-ai/dsh-tools": "^0.2.0-rc.1",
  // … every harness package, the same tuple
}
```

Two semver rule sets make this harder to reason about than it looks, so keep both
in mind when moving lines (the full explanation is in
[`../compat/0.2.0-audit.md`](../compat/0.2.0-audit.md) §1 and §3.2):

- **npm** only matches a prerelease candidate when the range carries a comparator
  on the *same* `[major, minor, patch]` tuple — so npm would need a new `||` term
  per tuple, which is exactly why a union is tempting.
- **DSH's startup admission gate** evaluates with `includePrerelease: true`, and
  that is what makes a same-tuple roll (`rc.1 → rc.2`) invisible to it: one
  `^0.1.7-rc.1` term spans the whole tuple. It does **not** span the next minor —
  a caret desugars to `<next-minor>-0`, which excludes the next minor's own
  prereleases. So the gate silently admits the rolls it cannot check and loudly
  refuses the crossings that matter.

That asymmetry is why a cursor at a new line **replaces** the peer tuple rather
than widening it: a union would admit both lines, and the gate would stop
distinguishing what was actually verified.

The plugin targets the line it was verified on. An older runtime skips the bundle
at startup with a peer diagnostic — a loud, diagnosable outcome — instead of
loading it into a state where it silently does nothing.

`node scripts/check-dsh-version.mjs` guards the declaration: every harness peer
must carry the identical tuple sequence, `engines.dsh` must equal the oldest
declared floor, and a release published above the declared window is reported
(exit 1). Run it before cutting a release.

## Cutting a release

```sh
npm run check                                        # the full gate, must be green
node scripts/check-dsh-version.mjs                   # declaration still honest?
# write docs/release/<version>.md — the release note (see below)
npm version patch                                    # or minor / major
git push origin main --tags                          # triggers .github/workflows/publish.yml
gh release edit v<version> --notes-file docs/release/<version>.md   # replace the generated body
```

**Per-version release notes live at `docs/release/<version>.md`, and the GitHub
Release body is that same file.** The workflow's `--generate-notes` body is a
commit list, which says nothing about the DSH range or the upgrade steps; write
the note by hand and push it onto the release with `gh release edit` so the file
and the published body cannot drift. Keep the note **bilingual** (English, then
中文), like the READMEs.

A note must state, at minimum: the **supported DSH range** and the version it was
verified against, any breaking change with its migration, what was verified
machine-side, and the deliberate boundaries. `0.4.0` is the worked example.

`npm version` rewrites `package.json` and creates the tag; the workflow then
verifies the tag matches `package.json`, runs the same gate, publishes through
GitHub Actions Trusted Publishing (OIDC, no stored `NPM_TOKEN`) with Sigstore
provenance, and creates a GitHub Release. Publishing is idempotent — a version
already on the registry is skipped. CI (`.github/workflows/ci.yml`) runs the same
gate on every push and pull request.

> `npm view` right after a publish can still report the previous `latest`: the
> registry needs a moment to propagate. Query
> `https://registry.npmjs.org/<pkg>` directly before concluding that a successful
> publish step did nothing.

Use `minor` for a change to the configuration surface or the published exports;
this plugin is `0.x`, so those are the breaking axis. `0.4.0` was the DSH
`0.1.7`-line adaptation, which removed two settings namespaces and renamed every
configuration key; `0.5.0` moved to the `0.2.0` line, which drops `0.1.7` users
and is a manifest-only roll otherwise.

> Local note: in a sandbox where the default npm cache is not writable,
> `npm pack --dry-run` fails with `EROFS`. Point it at a writable cache —
> `npm_config_cache=./.npm-cache npm run check` — rather than treating it as a
> code failure.

## Moving to a new DSH line

Two kinds of move, and they cost very different amounts:

- A **same-tuple prerelease roll** (`rc.1 → rc.2`) needs nothing but the
  `devDependencies` pin — the caret already covers it, and the gate does not even
  notice.
- A **minor crossing** (`0.1.7 → 0.2.0`) is **refused by the admission gate**
  until the peer tuples are replaced, because a caret's desugared upper bound is
  `<next-minor>-0`, which excludes the next minor's own prereleases. The bundle is
  skipped with a diagnostic rather than half-loaded, so the failure is loud. The
  full mechanism is in [`compat/0.2.0-audit.md`](../compat/0.2.0-audit.md) §3.2.

Do these in order; each one turns a silent failure mode into a loud one.

1. **Diff the seam files before reading anything else.** This is the step that
   decides whether the move is a manifest roll or a rewrite:
   ```sh
   git -C ../oss/deepseek-harness diff --numstat dsh-v<old>..dsh-v<new> -- \
     packages/core/tools/src/index.ts \
     packages/settings/settings/src/index.ts \
     packages/client/ui-approval/src/client/ApprovalPanel.tsx \
     packages/client/ui-plugin-manager/src/client/slot-contract.ts \
     packages/client/ui-settings/src/client/config-form.ts \
     packages/client/web/src/platform.ts \
     packages/interaction/commands/src/index.ts
   ```
   Empty output means a manifest-only roll. `0.1.7-rc.2 → 0.2.0-rc.1` was one.
2. **Replace the peer tuples** with `^<new-floor>`, one per harness package, and
   set `engines.dsh` to the same floor — under the standard npm `engines` field,
   which is where the upstream manifest type (`DshEnginesManifest`) names it.
   Never append `||`: a union re-admits the dropped line and the gate stops
   distinguishing what was actually verified.
3. **Bump the pinned devDependencies** to the new line's exact versions and
   reinstall. Until this is done, `tsc` type-checks against the *old* surface and
   cannot see a removal. Expect new compile errors; read them.
4. **Re-read the shell's frozen module table.**
   `packages/client/web/src/platform.ts` in the harness repo, or, without a
   checkout:
   ```sh
   F=$(dirname "$(node -p "require.resolve('@deepseek-ai/dsh-web-frontend/package.json')")")
   grep -ho 'function [A-Za-z_$][A-Za-z0-9_$]*(){return{react:[^}]*}}' "$F"/dist/assets/index-*.js
   ```
   Update `PLATFORM_MODULES` in `scripts/build.mjs` if it changed. The extracting
   function's name is a minifier artifact — never pin it.
5. **Re-check the settings model.** The volatile/ordinary split, the entry id the
   write path keys on, and the config-page policy (`configure({ auto: false })`)
   are `0.1.7`-era shapes. `tests/config.spec.ts` and `verify-host` pin them; if
   the settings service changed, those probes should fail first.
6. **Re-check the approval panel DOM anchors.** `data-approval-key`,
   `data-approval-scroll` and the headline's position are an unsanctioned
   coupling. Grep the shipped `dsh-client-ui-approval` client bundle for the two
   attributes; if they moved, the diff rendering has to move with them.
7. **Confirm the gate's verdicts at both ends.** Call the harness's own
   `evaluatePluginCompatibility(manifest, {}, <version>)` for the new line, a
   same-tuple roll above it, the dropped line, and the next minor. Expect
   admitted / admitted / refused / refused.
8. **Run the gate and expect it to fail where it should.** The build smoke checks
   and the anchored `verify-host` double exist to be the loud failure. If
   everything passes on the first try after a line bump, be suspicious — read §2
   of the audit for what "everything passed" cost once.
9. **Record the result in `docs/compat/<line>-audit.md`** — retitle and rename the
   file to the new line, add a §3.x subsection for the roll (with the seam table
   or the diff evidence), and move anything newly verified out of the
   uncovered-boundaries list. Same commit as the version bump.
