# Implementation plan — independent, general-purpose Obsidian client

**Status after the 1.0.0 release (2026-10-25 UTC):** [1.0.0](https://github.com/ibbuilds/obsidian-source-scraper-plugin/releases/tag/1.0.0) is published at tested `main` commit [`97f7ea69`](https://github.com/ibbuilds/obsidian-source-scraper-plugin/commit/97f7ea69df00a0ca21695189439a3087b458c10d). [PR #9](https://github.com/ibbuilds/obsidian-source-scraper-plugin/pull/9) was squash-merged after [five green PR jobs](https://github.com/ibbuilds/obsidian-source-scraper-plugin/actions/runs/40154249554), followed by [five green main jobs](https://github.com/ibbuilds/obsidian-source-scraper-plugin/actions/runs/40157435231) and [successful publication](https://github.com/ibbuilds/obsidian-source-scraper-plugin/actions/runs/40157508685). The [0.1.0 preview](https://github.com/ibbuilds/obsidian-source-scraper-plugin/releases/tag/0.1.0) remains available. Owner-device acceptance, a separate declared-minimum-version test, and legacy parity/retirement are still pending.

- Target: [ibbuilds/obsidian-source-scraper-plugin](https://github.com/ibbuilds/obsidian-source-scraper-plugin).
- Existing engine and legacy plugin: [ibbuilds/source-scraper](https://github.com/ibbuilds/source-scraper), verified at `0f9271cf92fde6d0c773e60590df4f009ac4cedf` / `v0.14.0-beta.1`.
- [PR #8](https://github.com/ibbuilds/obsidian-source-scraper-plugin/pull/8) merged earlier and released the 0.1.0 preview at `98c152d4b8269f4cb8a98ceccd2ef0dd8f7f6f01`; this historical tag is intentionally preserved and is no longer current `main`.
- Old optional plugin: Obsidian ID `x-feed-scraper`, branded `Discovery Engine`, built from `apps/obsidian-plugin`. Preserve it and its data until the new independent client is proven compatible.

### Verified delivery checkpoints

| Scope | Current evidence | Remaining boundary |
| --- | --- | --- |
| M0–M3 | Inventory, independent plugin, entity JSON/NDJSON import, preview and create-only notes shipped in 0.1.0 | Legacy migration is not implied |
| M4 | Optional run/export/review bridge shipped in 0.1.0; 1.0.0 adds verified real-engine CLI run/export/review/replay acceptance | No general CLI console or automatic collection |
| M5 | General project JSON editor and portable note-mapping JSON shipped in 1.0.0 | No advanced visual rule/template builder |
| M6 automated acceptance | 1.0.0 published after [five green main CI jobs](https://github.com/ibbuilds/obsidian-source-scraper-plugin/actions/runs/40157435231) and [publisher verification](https://github.com/ibbuilds/obsidian-source-scraper-plugin/actions/runs/40157508685). PR CI: 37 tests each on Linux/macOS, 35 passed and two Unix-only skips on Windows, 10 isolated Desktop scenarios and real-engine review persistence | Owner-device, minimum-version, and full lifecycle/legacy-coexistence checks remain pending |
| M7 | Legacy engine/plugin retained | Blocked on documented parity, reversible migration and owner-device acceptance |

The release evidence above is scoped to its exact tested SHA. A passing automated suite does not imply owner-device installation, personal vault safety acceptance, or feature parity with the legacy plugin.

## 1. Goal, product boundary, and explicit non-goals

**Goal:** a small, functional Obsidian client which consumes valid **entity exports** from any Source Scraper project and lets users inspect, review and explicitly turn structured information into safely created Markdown notes. No project-specific business logic is embedded.

**Ownership:**

| Responsibility | Owner |
| --- | --- |
| Fetch sources, permission checks, connectors, processors, evaluation, deduplication, monitoring, SQLite histories, CLI, versioned JSON/NDJSON | `source-scraper` engine |
| Parse/export contract at the boundary, present entities/evidence/reviews, configure note mapping/destination, preview and safely create Obsidian notes | This plugin |
| Source choices, domain terms, weights, rules, inclusion/exclusion criteria, destination preferences, custom note templates | User-owned config, not plugin code |
| Personal frontend/React/X research setup | A separate private/user project using the two public products |

**Never hardcode:** X For You, React, motion/design, job search, particular license labels, `References.md`, a specific source adapter, `minimumScore>0`, automatic approval or user-specific tags. Examples may show public npm, synthetic observations, RSS, generic job records and data **without URLs**; no example becomes a required runtime setting.

**Out of scope for initial release:** rewriting the engine, a React/Electron GUI, remote cloud sync/telemetry, webhooks, automated source collection at startup, automatic changes to existing vault notes, automatic deletion of rejected data, specialized user configuration or undocumented authenticated X scraping.

## 2. Architecture and version boundary

```text
  Public source / local JSON / authorized MCP
                  |
                  v
    Source Scraper engine (separate repo)
       SourceAdapter → Processor → Evaluator
       SQLite history/reviews/change evidence
                  |
                  v
       CLI export: JSON/NDJSON v1
                  |
          [validated boundary]
                  |
                  v
   Plugin import service and local UI
   - read versioned export
   - show project/entities/evidence/history
   - user chooses notes and template
   - preview new files and conflicts
                  |
                  v
    Obsidian Vault API (create-only)
        user-approved destination
```

**Primary integration is the public JSON v1 file/stream**, not direct imports from `source-scraper/packages/*`, private SQLite tables, the old authenticated local HTTP server, or the old plugin's stored vault path. Source Scraper package is currently `private:true` and **not published on npm**; do not declare an imaginary registry dependency.

Accepted by the published 0.1.0 and 1.0.0 releases: explicit `schemaVersion:1`, `dataset:"entities"`. Standalone `observations`, `changes` and `alerts` datasets are **not supported**; their possible read-only views remain future work. JSON envelope fields: `schemaVersion,dataset,projectId,exportedAt,limit,offset,count,records`. Entity fields include `projectId,key,type,title,attributes,category,score,confidence,reasons,review,updatedAt,observationCount`, optional `url` and `provenance` (mentions/reviews/assessmentHistory/mentionsTruncated). **Never invent missing evidence.** NDJSON has `schemaVersion,dataset,projectId,record` on every line. Unknown schema versions or malformed/oversized records **fail closed** with useful, redacted errors. Reference: engine's [export v1 schema](https://github.com/ibbuilds/source-scraper/blob/v0.14.0-beta.1/schemas/export-v1.schema.json) and [NDJSON schema](https://github.com/ibbuilds/source-scraper/blob/v0.14.0-beta.1/schemas/ndjson-v1.schema.json).

Compatibility baseline:

- Published plugins `0.1.0` and `1.0.0` consume `schemaVersion:1` entity JSON/NDJSON, tested against engine `v0.14.0-beta.1`. Other engine versions require separate compatibility verification.
- The optional desktop bridge checks CLI identity and JSON schema using `source-scraper version`, then validates the selected project. It exposes manual run/export and human review; other command workflows need separate implementation and tests. No blind download or execution of extensions.

## 3. Obsidian identity and packaging

The GitHub repository is `obsidian-source-scraper-plugin`. The **distributed manifest ID is `source-scraper`**, name `Source Scraper`, since 0.1.0; it is no longer a proposed identity. It contains neither `obsidian` nor the `plugin` suffix. Do not rename the ID after distribution. Plugin folder: `<vault>/.obsidian/plugins/source-scraper/`. Community directory submission and registry acceptance remain separate and are not claimed by a manual release.

Do **not** reuse old `x-feed-scraper` ID: existing installs must be able to coexist during a reversible migration. Old settings, CLI files and note ownership hashes are not imported automatically.

The initial preview `0.1.0` and the published stable `1.0.0` use GitHub tags exactly matching `manifest.json.version` (no `v` prefix) with the three standard assets `main.js`, `manifest.json` and `styles.css`. The `source-scraper` ID remains fixed. The manifest declares `isDesktopOnly:true` and `minAppVersion:1.9.2`; tested Desktop CI currently uses `latest/latest`, so a dedicated run on 1.9.2 remains an open compatibility check.

**Do not copy Source Scraper's one-release cleanup policy to this repository**: retaining historical plugin release tags/assets is important for Obsidian updates and older-version fallback. The two products have independent versions and release lifecycles. Later consider submission to the Community Plugins directory *only after* native app QA and permission/description requirements are met; manual installation from the three release assets is already available.

The release workflow builds and publishes only after successful `push` CI on the exact newest `main` commit, retaining historical plugin versions. It published `1.0.0` at `97f7ea69` and verified the tag SHA and all three assets. Subsequent maintenance commits with the same manifest version must preserve the existing immutable release/tag rather than republish it.

Official references:

- Manifest: https://docs.obsidian.md/Reference/Manifest
- Release/Community submission: https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin
- Vault API: https://docs.obsidian.md/Plugins/Vault

## 4. Implementation milestones (each is independently reviewable)

### M0 — Audit and freeze behavior

**Implemented:** the inventory and migration decisions are recorded in [CODE-MIGRATION-MAP.md](CODE-MIGRATION-MAP.md). The original engine and legacy plugin were retained. The inventory records the original baseline; it does not establish feature parity with the replacement.

- Inventory old plugin `main.ts` (currently roughly 919 lines), `setup.ts`, `bridge.ts`, `embedded.ts`, optional output adapter, `library.ts`, note ownership and desktop E2E tests.
- Classify code as **reuse after refactor**, **engine-owned**, **legacy-specialized**, or **unsafe-by-default**.
- Explicit hazards: old append flow touches root `References.md` after confirmation; old generic sink `retireManagedNote` removes some previously generated notes; old defaults mention `motion, design, research`; old plugin embeds a `collector.cjs` and design profile. **These behaviors are not suitable as generic defaults.**
- Snapshot existing core release, desktop test outcomes and old plugin ID/settings. Do not alter any user vault.
- Acceptance: repository inventory and migration safety checklist reviewed, no code deleted from engine.

### M1 — Independent plugin skeleton and releasable build

**Implemented and shipped in 0.1.0:** native plugin lifecycle, sidebar, settings, independent build and standard release assets. Settings and views are currently in `src/main.ts`; there is no separate `src/settings.ts` or `views/` directory.

- Independent `package.json`, lockfile, TypeScript strict config, esbuild setup, `src/main.ts`, root `manifest.json`, `styles.css`, `LICENSE`, `.gitignore` and npm scripts.
- Single native sidebar/settings panel with obvious **Import JSON**, **Preview notes**, **Create selected notes** and **Diagnostics** actions; no React app and no automatic collection.
- Settings default to **no configured engine/project**, **no source access**, **no output destination until explicitly selected**, **zero automatic writes**. Settings stored using Obsidian's `loadData/saveData` only; never include X browser sessions, tokens or passwords.
- Compile a single installable `main.js`; fail CI on plugin import-time crashes or accidental engine package imports. Verify manifest ID/name and build artifact contents.
- Verified acceptance includes loading the plugin in a synthetic Desktop vault, an available native UI, unchanged preexisting notes and builds on Linux/macOS/Windows. Explicit restart/disable/uninstall and side-by-side legacy acceptance remain part of the migration checklist; do not infer them from the current ten Desktop scenarios.

### M2 — Generic JSON/NDJSON import, proof and preview

**Implemented and shipped in 0.1.0; extended in 1.0.0:** entity import, browsing, original review/evidence display and Markdown preview. Version 1.0.0 fixes single-record NDJSON without a final newline and adds portable note mapping.

- `src/contracts.ts` runtime-validates schema v1. Accept a chosen export file or explicitly pasted JSON/NDJSON. Do not require a separate Node installation to import pre-existing JSON in Obsidian Desktop.
- Enforce bounded input bytes, record count, JSON nesting, normalized file paths and URLs; reject unsafe `__proto__` and credential-bearing URLs in exported note links.
- The entity detail view presents typed attributes, machine assessment, review and available provenance/history. Standalone observation/change/alert browsers and a separate field-change UI were design ideas and are not implemented views. Source-provided claims such as a license remain source data, not independent verification. No topic-specific filters or automatic approvals.
- Reimport is idempotent based on `projectId + entity.key`. A missing `url` is legitimate. A pending/rejected review is presented as data, not silently promoted to approved.
- Preview generic Markdown; 1.0.0 adds configurable properties, title field and section selection. Filenames remain deterministic by identity rather than user-scriptable. Examples stay neutral and separate from the user's private research.
- Verified acceptance includes a genuine **offline** export produced by the independent engine, fixtures with missing URLs, JSON/NDJSON validation and rejected malformed/unsafe/oversized input. A fresh live npm fetch through Desktop was an additional original acceptance goal, not evidence established by the offline CI fixture.

### M3 — Create-only, vault-safe note output

**Implemented and shipped in 0.1.0:** explicit preview and creation of new notes only. 1.0.0 preserves this boundary and applies create-only handling to project JSON files as well.

- User picks a dedicated vault-relative folder; suggested `Source Scraper/Imported/<projectId>/`, **not** an existing `References.md` or `Sources.md`. Preview with count and exact paths, then require a manual button click.
- For both published 0.1.0 and 1.0.0: **create new files only**, via Obsidian's Vault API. Every existing destination is reported as a **conflict**, including an identical note; content is never compared for replacement. Symlink/unsafe paths and unexpected folders are rejected before writing.
- Stable non-personal filenames derived from `SHA-256(projectId + "\\0" + entity.key)`, plus visible title in note body. Sanitize YAML/Markdown/links and preserve source identity, evaluated score/reasons, review state and available provenance; never fabricate license facts.
- **No call to vault.delete, trash, rename, modify or process on existing user notes**. No `retireManagedNote` behavior, no automatic merge into root `References.md`, no cleanup job.
- If note updates are requested in future, they require a **separate design/review** with plugin ownership marker, last-written hash, preview, user confirmation, backup and conflict behavior. Unmodified preexisting notes must never be claimed as owned.
- Verified acceptance includes byte-for-byte preservation of sentinel notes and manually edited generated notes, repeated imports, traversal/symlink rejection and file/folder conflicts. The broader migration proof still requires all-file snapshots, side-by-side plugin verification, lifecycle checks and interruption/concurrency scenarios; do not treat the existing unit and Desktop tests as proof of every migration condition.

### M4 — Optional local Source Scraper execution

**Implemented:** an optional bridge shipped in 0.1.0; 1.0.0 exercises real CLI run/export/review/replay and strengthens project-identity validation. JSON-only use remains independent of the CLI.

- The user selects a **trusted local Node executable**, Source Scraper CLI path and project manifest. No CLI is bundled or downloaded. A pinned bundled CLI was an exploratory design option and remains unimplemented.
- Before use, query `source-scraper version` and check CLI identity and JSON schema, then validate the configured project. Current public workflows invoke `version`, `validate`, `run`, `export` and `review` with fixed argument vectors and **shell:false**. A private allowlist is not a user-facing `query`, `inspect` or `reprocess` workflow; those additions require implementation, compatibility checks and tests.
- Project JSON can be authored as a new file in a user-approved folder or selected read-only; existing project files are not edited. The plugin does not open SQLite directly. Storage remains engine-controlled and must not be assumed to be inside the vault. The Run confirmation discloses that configured sources or trusted MCP executables may execute; there is no automatic source execution on load.
- Bound stdout/stderr size and run timeout; redact error details; support cancel/child cleanup and prevent concurrent runs. **No automatic output sink or webhook** from normal collection/export.
- No account secrets in command arguments, notes or logs. No invisible fetches or installation on app startup.
- Verified acceptance: bridge unit tests on Linux/macOS/Windows and a separately compiled real engine on Linux, including run/export, persisted review and replay with retained provenance. The original broader goal of a real-engine process smoke on every OS and every interruption/permission failure is not established by this matrix. Preserve bounds, cancellation, redacted errors and project checks as release requirements. No direct SQL queries from Obsidian.

### M5 — Native review, browsing, configuration portability

**Implemented and published in 1.0.0 within the following scope:** text-based JSON configuration and declarative note mapping. There is no advanced visual rule builder, executable template language or in-place configuration editor.

- Browse/search/paginate imported entities and open original evidence/review data. Sorting controls, multiple simultaneous project views and standalone changes/history browsers remain future enhancements.
- Explicit human review goes through the matching engine project's `review` command with a required reason and confirmed result. Without a configured CLI, the plugin displays imported review state and explains the connection requirement; it does not offer or silently persist a local draft-review workflow.
- Author or load project manifests as JSON, validate bounded/basic structure and create a **new** manifest file; choose an existing file without modifying it. The engine remains responsible for adapter/processor semantics. No personal keywords are included in the neutral template.
- Edit/copy/paste **version-1 note-mapping JSON** for a title field, additional YAML properties and optional assessment/attributes/provenance sections. Saved mappings reside in plugin preferences; destination settings are configured separately. No claim of a separate config-export wizard or automatic schema migration is made.
- Verified acceptance includes manifest/mapping validation and round trips, unsafe-data rejection, preservation of manually edited configs, genuine Desktop configuration flows and project-matched real CLI reviews. Mapping changes affect previews and future new notes only.

### M6 — Release and genuine device acceptance

**Split status:** 0.1.0 and 1.0.0 publication and five-job automated acceptance are complete. The 1.0.0 release tag equals tested `main` commit `97f7ea69`; installation and acceptance on the owner's actual device remain open in [#6](https://github.com/ibbuilds/obsidian-source-scraper-plugin/issues/6). Published code does not itself prove minimum-version compatibility or legacy coexistence.

- CI gates TypeScript, dependency audit, unit/security tests and build/assets on Linux/macOS/Windows; Desktop E2E and genuine engine integration currently run on Linux. Desktop uses a disposable synthetic vault. Passing those jobs must not be described as three-platform Desktop or personal-device acceptance.
- Retain coverage for import, preview, creation, duplicate/conflict preservation, invalid data, JSON configuration and keyboard filtering. The migration checklist separately calls for restart/disable/uninstall, legacy coexistence and all-file preservation snapshots. Live source and declared-minimum-version checks require their own evidence.
- Every new release requires review, passing CI for its exact candidate, successful main CI and publisher, a matching manifest/tag SHA and the three downloadable assets. Preserve 0.1.0 and later historical releases. Community Plugins submission/review is a separate step and requires user confirmation.
- For the user's personal vault, **first obtain a backup confirmation and choose a brand-new test folder**. Do a non-destructive, create-only E2E check, verify original files' hashes before/after and explicitly distinguish a real running plugin from a direct ChatGPT Obsidian-MCP note write.

### M7 — Carefully retire duplicated legacy plugin code in the engine repo

**Blocked:** automated release CI alone does not finish M6's owner-device acceptance or prove legacy parity. The old repo `source-scraper` must retain its tested CLI, SQLite state, JSON contracts, releases and general tests. The old `x-feed-scraper` plugin continues working during migration. See [#7](https://github.com/ibbuilds/obsidian-source-scraper-plugin/issues/7).

- Provide side-by-side installation path, explicit export/import instructions and compatibility notes. **No automatic deletion** of legacy plugin/settings or generated notes.
- Add deprecation notices for old plugin build/docs; move only generic Obsidian tests and UI code to the new repo, with attribution and licensing. Do not rewrite engine functionality.
- In a separate **engine PR**, remove engine build/release dependencies on Obsidian only after the standalone plugin passes compatibility tests. Determine if any old code should remain archived for legacy installs; do not eliminate still-needed workflows.
- Require engine Linux/macOS/Windows tests and JSON contract tests to pass with the new repo absent. Require independent plugin CI to pass against an exact engine release.
- Old Git tags and compatible data remain available; user vault files are never migrated/deleted without explicit approval.

## 5. Current source tree (1.0.0 release)

```text
README.md, LICENSE, manifest.json, package.json, package-lock.json
tsconfig.json, styles.css, esbuild.config.mjs, versions.json
src/
  main.ts                    lifecycle, native views/modals and preferences
  contracts.ts               bounded JSON/NDJSON v1 parsing and types
  cli-bridge.ts              optional trusted standalone CLI
  project-manifest.ts        basic config validation and new-file creation
  note-mapping.ts            versioned declarative note mapping
  render.ts                  Markdown/frontmatter and deterministic paths
  vault-writer.ts            create-only notes and JSON documents
scripts/
  verify-engine-json.mjs     independently generated engine JSON acceptance
  verify-real-cli.mjs        real CLI run/export/review/replay acceptance
  bench-import.mjs           bounded synthetic import/preview profile
tests/
  unit/                      import, render, CLI, mapping and write safety
  desktop/                   real Obsidian harness and synthetic vault
.github/workflows/
  ci.yml                     cross-platform checks, Desktop and real engine
  release.yml                publish assets after exact main push CI
docs/
  IMPLEMENTATION-PLAN.md
  CODE-MIGRATION-MAP.md
  SAFETY.md
  USER-GUIDE.md
  COMPATIBILITY.md
  releases/                  historical preview and stable release notes
```

The original planning tree proposed separate `settings`, `services` and `views` modules. The implementation uses the smaller flat layout above. Split files only when the maintenance benefit warrants it; **do not introduce unnecessary frameworks or internal services**.

## 6. Quality gates and decision/rollback rules

Every PR must independently answer:

1. Does it increase the **generic** capability rather than encode a personal preference?
2. Can it run with *no Obsidian-existing-files modifications* and *no unexpected network*?
3. Does it preserve JSON v1 content exactly where required and report missing provenance honestly?
4. Is it safe on import repeats, failures, interruption, malformed input and concurrent file edits?
5. Are old plugin installations/settings and the engine `source-scraper` still working?
6. Is there a tested, reviewable rollback (revert PR, keep legacy plugin and personal notes)?
7. Does any new package, process or network permission have a clear reason and user disclosure?

**Ship blockers:** any existing vault-note overwrite/delete, wrong manifest ID/release tag, GUI crashes, security regression, unreviewed subprocess downloads, bad JSON version handling, missed provenance or failed desktop/CLI tests. Do **not** paper over failing tests, relax assertions to make CI green, or claim a plugin has been installed in the user's personal Obsidian from isolated CI alone.

## 7. User-specific work comes after the general plugin

After the independent plugin v0.1+ passes generic acceptance, implement the owner's desired frontend/React/X research as **external project manifests, adapter(s) and note mappings**. Put personalized project settings in a separate private/user-owned directory/repo. The engine/provider authorization for the actual personalized X For You timeline remains a separate unresolved blocker; it cannot be solved by changing the Obsidian plugin.

## 8. Definition of done

`obsidian-source-scraper-plugin` is **ready** when a stranger can:

1. Install the compiled release without cloning the source or compiling TypeScript.
2. Import bounded, valid Source Scraper **entity** JSON v1/NDJSON without a separate Node installation or a running collector.
3. See source, score, review, available provenance/history and generic metadata without invented claims or unsupported standalone dataset promises.
4. Preview and explicitly create new Markdown notes in a folder they approve, then reimport without modifying any existing file.
5. Optionally connect to a trusted local Source Scraper CLI and run a general project with proper version checks and error handling.
6. Uninstall the plugin leaving every existing note, project and source database intact.
7. See passing independent unit, packaging, cross-platform and actual Obsidian Desktop integration tests and reproducible release assets.

**No Community Plugins availability, user vault installation, X access or universal research quality is claimed before the corresponding explicit acceptance.**
