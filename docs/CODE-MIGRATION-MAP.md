# Existing implementation inventory and migration decisions

**Source:** `ibbuilds/source-scraper` at `0f9271cf92fde6d0c773e60590df4f009ac4cedf`, source package `v0.14.0-beta.1`. The new plugin repository was empty before the planning documents were added.

**Principle:** existing functioning code is retained in the engine until the replacement is proven. **Do not copy legacy X or vault-mutating behaviors into the general plugin.**

| Existing file | Current responsibility | Migration action | Risks/tests |
| --- | --- | --- | --- |
| `apps/obsidian-plugin/main.ts` (~919 lines) | Native Obsidian sidebar, review controls, legacy X stats, source imports, References append and lifecycle | **Refactor selected native UI patterns**, not a wholesale copy. Replace domain-specific views and review controls with generic project/entity/provenance views. New, small `src/main.ts` plus views. | Don't carry `References.md` append, X status cards, automatic collector startup or hardcoded vault folder. |
| `apps/obsidian-plugin/setup.ts` | Research project wizard, keyword defaults, monitor modes, source-specific inputs | **Later optional feature**; a declarative v1 manifest editor may reuse safe form patterns, but all initial rules/default terms must be empty/configurable. | Current `motion, design, research` default is not generic. Keep validation delegated to engine. |
| `apps/obsidian-plugin/bridge.ts` | Authenticated loopback collector subprocess | **Do not copy legacy server bridge**. Build optional `cli-bridge.ts` against the public JSON CLI. | No accidental local port, bearer token or shell execution. Fixed argument vectors, timeout, cancellation, redacted stderr. |
| `apps/obsidian-plugin/embedded.ts` and `esbuild.mjs` | Embeds legacy collector.cjs and a design profile into Obsidian `main.js` | **Do not embed legacy collector/profile**. Initially import JSON without Node. Investigate separately whether a SHA256-pinned public CLI bundle is needed for single-click local run. | Avoid unreviewed executable downloads, hidden sidecars and hardcoded design profile. |
| `apps/obsidian-plugin/library.ts` | URL normalization and user-approved append into root References | Retain safe ideas as tests, **not** auto-append feature. | Root `References.md` never touched in generic default. |
| `packages/integrations/obsidian-output.ts` | Generic entities → Markdown+Base using SQLite/FS; may update or retire existing machine notes | Reuse **data shape/renderer concepts** only. New writer uses Obsidian Vault create-only API; **no deletes, auto-retire or overwrite**. | Existing code calls `retireManagedNote`; not acceptable as default. Tests must guard that nothing existing is changed. |
| `packages/core/managed-notes.ts` | Hash ownership, safe updates and retirement of old generated notes | Reuse hash/conflict tests, not update/retire semantics in initial release. | Ignore historical ownership ledger of old plugin; never assume existing notes are owned by new plugin. |
| `packages/core/vault-safe.ts` | Prevents path traversal/symlink output destinations | Derive safe vault-relative path validation and tests. | New plugin uses Obsidian Vault API and must also refuse unsafe destinations/collisions. |
| `packages/core/obsidian.ts` | Legacy X source render, `X Feed Scraper` notes/visuals/reports and removal | **Legacy only**, keep working in old repo; do not migrate as general core. | Source-specific metadata and automatic removal must not leak. |
| `packages/core/project-builder.ts` | Creates manifests with user-selectable adapters, default policy | Keep in engine. Plugin can show a manifest editor later via public schema, no dependency on internal builder. | Avoid duplicate validation logic and default project filters. |
| `packages/sdk/contracts.ts` and `schemas/{export,ndjson}-v1.schema.json` | Public JSON types/schema definitions | **Public contract is source of truth**. Plugin runtime-validates JSON; reference/pin documented schema v1, don't edit private engine code to ship plugin. | Reject incompatible schemaVersion, missing required identity, excessive sizes, prototype pollution, malformed URLs. |
| `apps/collector/source-cli.ts` / `dist/source-scraper.mjs` | Stable public CLI commands and JSON output | **Optional desktop process integration**; in MVP users can import exported files. | Engine package currently marked `private:true`; no npm registry publication. |
| `tests/desktop/specs/plugin.e2e.ts` | Six real Obsidian Desktop tests of old plugin in synthetic vault | Reuse **test infrastructure and synthetic vault**, rewrite assertions for generic new ID/import/preview/no-overwrite. | Preserve test vault sentinel; prove no existing note changed after repeated import. |
| `tests/knowledge-engine.test.ts`, `tests/managed-notes.test.ts` | Output conflict, ownership and migration tests | Preserve in core and add independent plugin equivalent tests. | Core tests must still pass without new repo. |

## Minimum non-destructive migration proof

1. Clone **copies** of synthetic fixtures to a dedicated test vault, not a user's active vault.
2. Snapshot hashes for all pre-existing files under that test vault; include `References.md`, folders, Markdown, Bases and unrelated private test documents.
3. Install **new ID** `source-scraper` next to legacy `x-feed-scraper` (if legacy present). Confirm no settings/data directory collisions.
4. Load a real `schemaVersion:1` Source Scraper export without accessing private SQLite tables. Preview notes and select a new folder.
5. Create exactly the selected files; inspect frontmatter/evidence and confirm engine review remains unchanged unless the user explicitly submits a review.
6. Import the same data again. Existing notes are preserved byte for byte; report as unchanged/skipped/conflict.
7. Change one generated note manually. A new import must **not** modify or delete it. Changed input must not overwrite existing notes.
8. Restart Obsidian and disable/uninstall the new plugin. **Every note and legacy plugin file remains**.
9. Only if independent new plugin and old engine tests pass, propose a separate engine PR to remove duplicated Obsidian build requirements. **Do not perform the removal until compatibility acceptance has passed.**

## Historical vs new plugin identity

Legacy manifest:
```json
{"id":"x-feed-scraper","name":"Discovery Engine","version":"0.14.0","minAppVersion":"1.9.2","isDesktopOnly":true}
```

New **proposed** manifest identity (NOT yet committed as an installable manifest; uniqueness must be verified first):
```json
{"id":"source-scraper","name":"Source Scraper","version":"0.1.0","minAppVersion":"1.9.2","isDesktopOnly":true}
```

The proposed `minAppVersion` is a **candidate inherited from the old desktop plugin**, and must be checked against the APIs actually used in the new release. The new plugin ID deliberately differs from the old so owners can compare/rollback and never have their old `.obsidian/plugins/x-feed-scraper/` folder overwritten.

**Packaging difference:** Source Scraper engine releases have tags like `v0.14.0-beta.1`; Obsidian Community Plugin installs require **three-part manifest version** and a **matching release tag** such as `0.1.0`, plus `main.js`, `manifest.json`, optional `styles.css` assets. Do not reuse engine release tags or its purge-old-releases automation.

## No personal data ever migrates by default

Existing user's `References.md`, `Source Scraper/Acceptance Test.md`, `Projects/*`, `~/.x-feed-scraper/*`, old SQLite files and source project manifests are treated as **third-party/unowned content**. Even if the same URL or hash is present, never overwrite or clean them. An explicit later migration wizard can read and *preview* legacy data after backups; it must not delete or silently modify originals.

## Links

- [Master implementation plan](IMPLEMENTATION-PLAN.md)
- [Engine v0.14.0 source tree](https://github.com/ibbuilds/source-scraper/tree/v0.14.0-beta.1)
- [Obsidian Manifest rules](https://docs.obsidian.md/Reference/Manifest)
- [Obsidian Vault API](https://docs.obsidian.md/Plugins/Vault)
- [Community release requirements](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
