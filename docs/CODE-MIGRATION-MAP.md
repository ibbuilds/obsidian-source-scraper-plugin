# Existing implementation inventory and migration decisions

**Historical inventory source:** `ibbuilds/source-scraper` at `0f9271cf92fde6d0c773e60590df4f009ac4cedf`, source package `v0.14.0-beta.1`. The new plugin repository was empty when this inventory was started; that is no longer its implementation status.

**Audit checkpoint updated after 1.0.0 publication (2026-10-25 UTC):** the independent [0.1.0 preview](https://github.com/ibbuilds/obsidian-source-scraper-plugin/releases/tag/0.1.0) remains available, and [1.0.0](https://github.com/ibbuilds/obsidian-source-scraper-plugin/releases/tag/1.0.0) is published at tested main commit `97f7ea69df00a0ca21695189439a3087b458c10d` after [PR #9](https://github.com/ibbuilds/obsidian-source-scraper-plugin/pull/9) merged. The engine baseline remained unchanged during the plugin integration. **Legacy parity, owner-device acceptance and retirement are not complete.**

**Principle:** existing functioning code is retained in the engine until the replacement is proven. **Do not copy legacy X or vault-mutating behaviors into the general plugin.**

| Engine file at inventory baseline | Responsibility at that baseline | Decision and independent implementation status | Risks/tests |
| --- | --- | --- | --- |
| `apps/obsidian-plugin/main.ts` (~919 lines) | Native Obsidian sidebar, review controls, legacy X stats, source imports, References append and lifecycle | Selected native UI patterns informed the independent generic sidebar/modals in `src/main.ts`; the legacy implementation was not copied wholesale or removed. | Don't carry `References.md` append, X status cards, automatic collector startup or hardcoded vault folder. |
| `apps/obsidian-plugin/setup.ts` | Research project wizard, keyword defaults, monitor modes, source-specific inputs | Merged PR #9 implemented a **JSON text editor**, basic structural validation and create-only manifest files in `src/project-manifest.ts`/`src/main.ts`. An advanced visual wizard remains future work. | Legacy `motion, design, research` defaults are not generic. Adapter/processor semantics remain engine-owned. |
| `apps/obsidian-plugin/bridge.ts` | Authenticated loopback collector subprocess | The independent `src/cli-bridge.ts` uses the public JSON CLI; the legacy server bridge was not copied. Merged PR #9 added real-engine run/export/review/replay acceptance. | No accidental local port, bearer token or shell execution. Fixed argument vectors, timeout, cancellation, redacted stderr. |
| `apps/obsidian-plugin/embedded.ts` and `esbuild.mjs` | Embeds legacy collector.cjs and a design profile into Obsidian `main.js` | **Do not embed legacy collector/profile**. Initially import JSON without Node. Investigate separately whether a SHA256-pinned public CLI bundle is needed for single-click local run. | Avoid unreviewed executable downloads, hidden sidecars and hardcoded design profile. |
| `apps/obsidian-plugin/library.ts` | URL normalization and user-approved append into root References | Retain safe ideas as tests, **not** auto-append feature. | Root `References.md` never touched in generic default. |
| `packages/integrations/obsidian-output.ts` | Generic entities → Markdown+Base using SQLite/FS; may update or retire existing machine notes | Reuse **data shape/renderer concepts** only. New writer uses Obsidian Vault create-only API; **no deletes, auto-retire or overwrite**. | Existing code calls `retireManagedNote`; not acceptable as default. Tests must guard that nothing existing is changed. |
| `packages/core/managed-notes.ts` | Hash ownership, safe updates and retirement of old generated notes | Reuse hash/conflict tests, not update/retire semantics in initial release. | Ignore historical ownership ledger of old plugin; never assume existing notes are owned by new plugin. |
| `packages/core/vault-safe.ts` | Prevents path traversal/symlink output destinations | Derive safe vault-relative path validation and tests. | New plugin uses Obsidian Vault API and must also refuse unsafe destinations/collisions. |
| `packages/core/obsidian.ts` | Legacy X source render, `X Feed Scraper` notes/visuals/reports and removal | **Legacy only**, keep working in old repo; do not migrate as general core. | Source-specific metadata and automatic removal must not leak. |
| `packages/core/project-builder.ts` | Creates manifests with user-selectable adapters, default policy | Retained in engine. The published 1.0.0 JSON editor validates bounded/basic manifest structure and delegates runtime semantics to the selected engine's public `validate` command; it does not import the internal builder. | Do not claim basic editor validation proves every adapter/configuration is executable. Keep personal filters outside both products. |
| `packages/sdk/contracts.ts` and `schemas/{export,ndjson}-v1.schema.json` | Public JSON types/schema definitions | **Public contract is source of truth**. Plugin runtime-validates JSON; reference/pin documented schema v1, don't edit private engine code to ship plugin. | Reject incompatible schemaVersion, missing required identity, excessive sizes, prototype pollution, malformed URLs. |
| `apps/collector/source-cli.ts` / `dist/source-scraper.mjs` | Public CLI commands and JSON output | Optional local execution shipped in 0.1.0; current workflows call version/validate/run/export/review. File/paste import remains usable without the CLI. | Engine package at the baseline is `private:true`; no npm registry dependency or automatic executable download is assumed. |
| `tests/desktop/specs/plugin.e2e.ts` | Six real Obsidian Desktop tests of old plugin in synthetic vault | The independent repo passed ten [1.0.0 Desktop scenarios](https://github.com/ibbuilds/obsidian-source-scraper-plugin/actions/runs/40157435231) using an isolated synthetic vault. | Preserve test sentinels. These tests do not prove owner-device installation, complete legacy parity, minimum-version compatibility or every lifecycle scenario below. |
| `tests/knowledge-engine.test.ts`, `tests/managed-notes.test.ts` | Output conflict, ownership and migration tests | Preserve in core and add independent plugin equivalent tests. | Core tests must still pass without new repo. |

## Minimum non-destructive migration proof

**Pending as a complete migration gate.** Existing unit, Desktop and real-CLI tests demonstrate parts of this checklist, but they do not establish legacy coexistence, rollback or personal-device acceptance. Do not retire legacy code merely because the independent release's CI is green.

1. Clone **copies** of synthetic fixtures to a dedicated test vault, not a user's active vault.
2. Snapshot hashes for all pre-existing files under that test vault; include `References.md`, folders, Markdown, Bases and unrelated private test documents.
3. Install **new ID** `source-scraper` next to legacy `x-feed-scraper` (if legacy present). Confirm no settings/data directory collisions.
4. Load a real `schemaVersion:1` Source Scraper export without accessing private SQLite tables. Preview notes and select a new folder.
5. Create exactly the selected files; inspect frontmatter/evidence and confirm engine review remains unchanged unless the user explicitly submits a review.
6. Import the same data again. Existing notes are preserved byte for byte; report as unchanged/skipped/conflict.
7. Change one generated note manually. A new import must **not** modify or delete it. Changed input must not overwrite existing notes.
8. Restart Obsidian and disable/uninstall the new plugin. **Every note and legacy plugin file remains**.
9. Only if independent new plugin and old engine tests pass, propose a separate engine PR to remove duplicated Obsidian build requirements. **Do not perform the removal until compatibility acceptance has passed.**

## Historical and distributed plugin identities

Legacy manifest at the inventory baseline:
```json
{"id":"x-feed-scraper","name":"Discovery Engine","version":"0.14.0","minAppVersion":"1.9.2","isDesktopOnly":true}
```

Independent manifest already distributed in release 0.1.0:
```json
{"id":"source-scraper","name":"Source Scraper","version":"0.1.0","minAppVersion":"1.9.2","isDesktopOnly":true}
```

Published version `1.0.0` retains the independent ID `source-scraper` used by 0.1.0. Its release tag points to tested `main` SHA `97f7ea69df00a0ca21695189439a3087b458c10d` and contains the three install assets. The ID deliberately differs from the old plugin for coexistence and rollback; do not rename it after distribution. A manual release does not imply Community directory approval.

Both published manifests declare `minAppVersion:1.9.2`. The 1.0.0 Desktop CI uses `latest/latest`; a separate minimum-version compatibility check remains unverified. Keep compatibility acceptance independent from merely passing current Desktop CI.

**Packaging difference:** Source Scraper engine releases have tags like `v0.14.0-beta.1`; Obsidian Community Plugin installs require **three-part manifest version** and a **matching release tag** such as `0.1.0`, plus `main.js`, `manifest.json`, optional `styles.css` assets. Do not reuse engine release tags or its purge-old-releases automation.

## No personal data ever migrates by default

Existing user's `References.md`, `Source Scraper/Acceptance Test.md`, `Projects/*`, `~/.x-feed-scraper/*`, old SQLite files and source project manifests are treated as **third-party/unowned content**. Even if the same URL or hash is present, never overwrite or clean them. An explicit later migration wizard can read and *preview* legacy data after backups; it must not delete or silently modify originals.

`Source Scraper/Acceptance Test.md` is a prior direct MCP test, not proof that this plugin or its CLI bridge ran in the owner's vault. Personal-device acceptance requires its own confirmed backup, new test folder and observed plugin workflow. [Issue #6](https://github.com/ibbuilds/obsidian-source-scraper-plugin/issues/6) remains the acceptance tracker; [Issue #7](https://github.com/ibbuilds/obsidian-source-scraper-plugin/issues/7) remains blocked on it and feature-by-feature parity. Any later engine cleanup must be a separate, reviewed PR with both repositories' tests and a documented rollback.

## Links

- [Master implementation plan](IMPLEMENTATION-PLAN.md)
- [Published independent 0.1.0](https://github.com/ibbuilds/obsidian-source-scraper-plugin/releases/tag/0.1.0)
- [Published stable 1.0.0](https://github.com/ibbuilds/obsidian-source-scraper-plugin/releases/tag/1.0.0)
- [CI on the published 1.0.0 main commit `97f7ea69`](https://github.com/ibbuilds/obsidian-source-scraper-plugin/actions/runs/40157435231)
- [Engine v0.14.0 source tree](https://github.com/ibbuilds/source-scraper/tree/v0.14.0-beta.1)
- [Obsidian Manifest rules](https://docs.obsidian.md/Reference/Manifest)
- [Obsidian Vault API](https://docs.obsidian.md/Plugins/Vault)
- [Community release requirements](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
