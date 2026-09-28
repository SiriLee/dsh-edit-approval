# Documentation index

Maintainer docs for `dsh-edit-approval`. The READMEs are the user-facing entry
points; everything here is about *why* the plugin is shaped the way it is and
what has to be re-verified when DSH changes.

| Document | Purpose |
| --- | --- |
| [`compat/0.2.0-audit.md`](compat/0.2.0-audit.md) | **The compatibility source of truth.** The seams this plugin consumes, what each line roll changed, which failures were silent and why, the settings model that line introduced, and the boundaries that are deliberate rather than accidental. §3.1 and §3.2 are the roll-by-roll deltas; the rest is the `0.1.7` rewrite whose seams are byte-identical on `0.2.0`. |
| [`release/release.md`](release/release.md) | Release workflow, the single-line version-alignment model, and what to re-read when moving to a new DSH line. |
| [`release/0.4.0.md`](release/0.4.0.md) | The 0.4.0 release notes (bilingual) — the same text published on the GitHub Release. States the supported DSH range, the breaking settings rename and its migration, and what was verified. |
| [`npm-trusted-publishing-guide.md`](npm-trusted-publishing-guide.md) | One-off setup for OIDC publishing from GitHub Actions. |

## Conventions

- **Bilingual pairs.** User-facing documents exist as `X.md` (English) and
  `X.zh.md` (中文). Maintainer docs under `docs/` are English-only; the READMEs
  are the pair that must stay in lockstep.
- **`compat/0.2.0-audit.md` is the single source of truth** for compatibility
  claims. A README statement about supported versions or behavior should be
  traceable to a row in that document, and a change to a seam updates it in the
  same commit.
- **Cite evidence, not intent.** Claims in the audit point at a file and line, a
  probe name, or a command whose output is quoted. When a claim cannot be
  settled from source, it belongs in the audit's *uncovered boundaries* section
  rather than in a README as if it were verified.
- **The tests are the audit.** A compatibility claim is worth exactly what the
  probe behind it is worth. Probes must drive real packages (see
  `scripts/verify-host.mjs`) or pin a real artifact (see `scripts/build.mjs`);
  a double that only implements what the plugin calls proves nothing.
- `docs/` ships in the npm tarball (see `files` in `package.json`), so these
  documents are readable from an installed copy.
