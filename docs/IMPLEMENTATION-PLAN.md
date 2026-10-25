# Implementation plan — independent, general-purpose Obsidian client

**Status:** execution in progress on [implementation PR #8](https://github.com/ibbuilds/obsidian-source-scraper-plugin/pull/8). M1–M4 are implemented and tested; M5 generic configuration-editor portability remains future work; M6 first release requires green CI and real Obsidian Desktop; M7 removal of duplicated legacy code is **intentionally blocked until proven replacement parity**. Last reviewed: 2026-10-24.

- Target: [ibbuilds/obsidian-source-scraper-plugin](https://github.com/ibbuilds/obsidian-source-scraper-plugin).
- Existing engine and legacy plugin: [ibbuilds/source-scraper](https://github.com/ibbuilds/source-scraper), verified at `0f9271cf92fde6d0c773e60590df4f009ac4cedf` / `v0.14.0-beta.1`.
- Initial repository was empty before planning. Implementation assets now exist in PR #8, but a user installation is **not implied** and no release is claimed before the publisher succeeds.
- Old optional plugin: Obsidian ID `x-feed-scraper`, branded `Discovery Engine`, built from `apps/obsidian-plugin`. Preserve it and its data until the new independent client is proven compatible.

## 1. Goal, product boundary, and explicit non-goals

**Goal:** a small, functional Obsidian client which consumes *any* Source Scraper project output and lets users inspect, review and explicitly turn structured information into safely created Markdown notes. No project-specific business logic is embedded.

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

Accepted versions for v0.1: explicit `schemaVersion:1`; `dataset:"entities"` exports, optionally `observations`, `changes` and `alerts` in read-only views. JSON envelope fields: `schemaVersion,dataset,projectId,exportedAt,limit,offset,count,records`. Entity fields include `projectId,key,type,title,attributes,category,score,confidence,reasons,review,updatedAt,observationCount`, optional `url` and `provenance` (mentions/reviews/assessmentHistory/mentionsTruncated). **Never invent missing evidence.** NDJSON has `schemaVersion,dataset,projectId,record` on every line. Unknown schema versions or malformed/oversized records **fail closed** with useful, redacted errors. Reference: engine's [export v1 schema](https://github.com/ibbuilds/source-scraper/blob/v0.14.0-beta.1/schemas/export-v1.schema.json) and [NDJSON schema](https://github.com/ibbuilds/source-scraper/blob/v0.14.0-beta.1/schemas/ndjson-v1.schema.json).

Plan an explicit compatibility matrix:
- Plugin `0.1.x`: consumes `schemaVersion:1` JSON/NDJSON, tested with engine CLI `v0.14.0-beta.1` and a future current version.
- Later CLI commands are **optional desktop integration**, discovered via `source-scraper version`, not assumed from a project manifest or private internal SDK. No blind download or execution of extensions.

## 3. Obsidian identity and packaging

The **GitHub repository name** can be `obsidian-source-scraper-plugin`. The **manifest plugin ID must not** contain `obsidian` **or end with** `plugin`. Proposed new stable ID: `source-scraper`, name: `Source Scraper`, subject to official Community Plugins registry uniqueness check **before first release**. No id rename after distribution. Plugin folder: `<vault>/.obsidian/plugins/source-scraper/`.

Do **not** reuse old `x-feed-scraper` ID: existing installs must be able to coexist during a reversible migration. Old settings, CLI files and note ownership hashes are not imported automatically.

Initial release should be `0.1.0` (three-part semver), with GitHub release tag **exactly `0.1.0`, no `v` and no `-beta`**, matching `manifest.json.version`. Build `main.js` and optional `styles.css`; attach both plus `manifest.json` as release assets, and optionally a ZIP for manual installation. Put `README.md`, `LICENSE`, `manifest.json` in repo root. Use the actual minimum tested Obsidian API version, not a guessed ancient version. Set `isDesktopOnly:true` if this version imports Node/Electron APIs or starts a CLI subprocess.

**Do not copy Source Scraper's one-release cleanup policy to this repository**: retaining historical plugin release tags/assets is important for Obsidian updates and older-version fallback. The two products have independent versions and release lifecycles. Later consider submission to the Community Plugins directory *only after* native app QA and permission/description requirements are met; manual ZIP installation remains available beforehand.

Official references:
- Manifest: https://docs.obsidian.md/Reference/Manifest
- Release/Community submission: https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin
- Vault API: https://docs.obsidian.md/Plugins/Vault

## 4. Implementation milestones (each is independently reviewable)

### M0 — Audit and freeze behavior (documentation only)

- Inventory old plugin `main.ts` (currently roughly 919 lines), `setup.ts`, `bridge.ts`, `embedded.ts`, optional output adapter, `library.ts`, note ownership and desktop E2E tests.
- Classify code as **reuse after refactor**, **engine-owned**, **legacy-specialized**, or **unsafe-by-default**.
- Explicit hazards: old append flow touches root `References.md` after confirmation; old generic sink `retireManagedNote` removes some previously generated notes; old defaults mention `motion, design, research`; old plugin embeds a `collector.cjs` and design profile. **These behaviors are not suitable as generic defaults.**
- Snapshot existing core release, desktop test outcomes and old plugin ID/settings. Do not alter any user vault.
- Acceptance: repository inventory and migration safety checklist reviewed, no code deleted from engine.

### M1 — Independent plugin skeleton and releaseable build

- New `package.json`, lockfile, TypeScript strict config, esbuild setup, `src/main.ts`, `src/settings.ts`, root `manifest.json`, `styles.css`, `LICENSE`, `.gitignore`, npm scripts.
- Single native sidebar/settings panel with obvious **Import JSON**, **Preview notes**, **Create selected notes** and **Diagnostics** actions; no React app and no automatic collection.
- Settings default to **no configured engine/project**, **no source access**, **no output destination until explicitly selected**, **zero automatic writes**. Settings stored using Obsidian's `loadData/saveData` only; never include X browser sessions, tokens or passwords.
- Compile a single installable `main.js`; fail CI on plugin import-time crashes or accidental engine package imports. Verify manifest ID/name and build artifact contents.
- Acceptance: install, enable, disable and reload in a synthetic test vault; zero writes to existing notes; native UI appears; build is reproducible.

### M2 — Generic JSON/NDJSON import, proof and preview

- Implement `src/contracts`/parser with runtime schema v1 validation. Accept a chosen export file or explicitly pasted JSON/NDJSON. Do not require Node to import pre-existing JSON.
- Enforce bounded input bytes, record count, JSON nesting, normalized file paths and URLs; reject unsafe `__proto__` and credential-bearing URLs in exported note links.
- A data model/view separates observation, normalized entity, machine assessment, original mentions, review history and field changes. Show `license` as *unverified source claim* where present. No topic-specific filters or automatic approvals.
- Reimport is idempotent based on `projectId + entity.key`. A missing `url` is legitimate. A pending/rejected review is presented as data, not silently promoted to approved.
- Preview generic note Markdown and configurable property mapping/filename strategy. The default example must be neutral, e.g. npm package, synthetic book or lab sample; not the user's private research.
- Acceptance: real npm v1 export from the standalone CLI imported into an isolated vault; malformed schema, secrets, custom fields, missing URLs, NDJSON lines, >limit and idempotent import tests.

### M3 — Create-only, vault-safe note output

- User picks a dedicated vault-relative folder; suggested `Source Scraper/Imported/<projectId>/`, **not** an existing `References.md` or `Sources.md`. Preview with count and exact paths, then require a manual button click.
- For v0.1: **create new files only**, via Obsidian's Vault API. Check each destination before writing and treat any existing file, symlink/unsafe path or unexpected folder as a **conflict**. A repeated import may report identical content but must not silently overwrite it.
- Stable non-personal filenames derived from `SHA-256(projectId + "\\0" + entity.key)`, plus visible title in note body. Sanitize YAML/Markdown/links and preserve source identity, evaluated score/reasons, review state and available provenance; never fabricate license facts.
- **No call to vault.delete, trash, rename, modify or process on existing user notes in v0.1**. No `retireManagedNote` behavior, no automatic merge into root `References.md`, no cleanup job.
- If note updates are requested in future, they require a **separate design/review** with plugin ownership marker, last-written hash, preview, user confirmation, backup and conflict behavior. Unmodified preexisting notes must never be claimed as owned.
- Acceptance: sentinel `References.md` and multiple user-authored files hashed before/after; import creates only selected paths; reimport produces no overwrites; malicious traversal, collisions, concurrent edits, conflicting plugin IDs and interrupted writes covered.

### M4 — Optional local Source Scraper execution

- Desktop-only optional feature: user selects an explicit **trusted local Node executable** and Source Scraper CLI path (or uses a separately reviewed, SHA-256 pinned bundled release asset). Import-only workflow must continue to work without a running engine.
- Before using CLI, query `source-scraper version`; require the expected JSON schema version and supported command set. Only spawn **fixed, allowlisted commands** (`validate`, `run`, `query`, `inspect`, `review`, `reprocess`, `export`) with an argument array and **shell:false**.
- Project JSON is created/edited under user-approved location or selected read-only; SQLite lives outside the synced vault by default. No third-party executable extensions/MCP spawned without explicit user consent and security warning.
- Bound stdout/stderr size and run timeout; redact error details; support cancel/child cleanup and prevent concurrent runs. **No automatic output sink or webhook** from normal collection/export.
- No account secrets in command arguments, notes or logs. No invisible fetches or installation on app startup.
- Acceptance: exact CLI binary smoke on Linux/macOS/Windows, localized Node missing/version mismatch/permission errors, interrupted/failed process, sensitive output redaction, consistent JSON and managed job status. No direct SQL queries from Obsidian.

### M5 — Native review, browsing, configuration portability

- Show projects, entities, evidence, review history and changes without imposing data-specific fields; user can search/sort and open records.
- Optional explicit human review action mapped to the engine `review` command if CLI is connected; otherwise record only a clearly labeled local draft decision and never claim it was committed to engine SQLite.
- Read/write project manifests using public v1 schema. No default positive/negative keywords; any policy is chosen by the user.
- Generic mapping templates and destination configuration are **exportable JSON**, with a version and migration path, so users can share workflows without sharing data or credentials.
- Acceptance: change policy and review in one project without touching another; import/export project config round trip; no score-based auto-approval; no hardcoded source names or paths.

### M6 — Release and genuine device acceptance

- CI: TypeScript, static checks, deterministic import/renderer unit tests, vault-safety tests, binary package smoke on Linux/macOS/Windows and **genuine Obsidian Desktop E2E in an isolated synthetic vault**.
- Test install/enable, import real public npm export (captured from a verified live API workflow), preview, create new files, duplicate import, conflict, reload/restart and persistence. Preserve sentinel user files exactly.
- Publish `0.1.0` independently **only after** all tests and actual file artifacts pass. GitHub release must include the standard plugin assets and tag matching manifest. Later Community Plugins review is a separate step and requires user confirmation.
- For the user's personal vault, **first obtain a backup confirmation and choose a brand-new test folder**. Do a non-destructive, create-only E2E check, verify original files' hashes before/after and explicitly distinguish a real running plugin from a direct ChatGPT Obsidian-MCP note write.

### M7 — Carefully retire duplicated legacy plugin code in the engine repo

**Not before M6 succeeds.** The old repo `source-scraper` must retain its tested CLI, SQLite state, JSON contracts, releases and general tests. The old `x-feed-scraper` plugin continues working during migration.

- Provide side-by-side installation path, explicit export/import instructions and compatibility notes. **No automatic deletion** of legacy plugin/settings or generated notes.
- Add deprecation notices for old plugin build/docs; move only generic Obsidian tests and UI code to the new repo, with attribution and licensing. Do not rewrite engine functionality.
- In a separate **engine PR**, remove engine build/release dependencies on Obsidian only after the standalone plugin passes compatibility tests. Determine if any old code should remain archived for legacy installs; do not eliminate still-needed workflows.
- Require engine Linux/macOS/Windows tests and JSON contract tests to pass with the new repo absent. Require independent plugin CI to pass against an exact engine release.
- Old Git tags and compatible data remain available; user vault files are never migrated/deleted without explicit approval.

## 5. Proposed source tree (implementation, not yet present)

```text
README.md, LICENSE, manifest.json, package.json, package-lock.json
tsconfig.json, styles.css, esbuild.config.mjs, versions.json (when needed)
src/
  main.ts                    native plugin lifecycle and commands
  settings.ts                per-vault configuration (no secrets)
  contracts/                 JSON v1 parsers and types
  services/importer.ts       validated file/NDJSON import
  services/cli-bridge.ts     OPTIONAL trusted standalone Node CLI
  services/vault-writer.ts   create-only note output
  services/note-renderer.ts  generic Markdown/frontmatter templates
  services/identity.ts       stable note naming and collision checks
  views/                     project/entity/evidence list and preview
tests/
  unit/                      parsers, renderer, identity, errors, safety
  integration/               synthetic vault, real npm export fixtures
  desktop/                   genuine Obsidian Desktop isolated vault
.github/workflows/
  ci.yml                     typecheck + tests + packaged smoke
  release.yml                signed-off plugin release artifacts
docs/
  IMPLEMENTATION-PLAN.md
  SAFETY.md
  USER-GUIDE.md
  COMPATIBILITY.md
```

Files and boundaries can be simplified further during implementation; **do not introduce unnecessary frameworks or internal services**.

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
2. Import arbitrary valid Source Scraper JSON v1/NDJSON **without Node or a running X/Obsidian-specific collector**.
3. See source, score, review, provenance, changes and unknown metadata without invented claims.
4. Preview and explicitly create new Markdown notes in a folder they approve, then reimport without modifying any existing file.
5. Optionally connect to a trusted local Source Scraper CLI and run a general project with proper version checks and error handling.
6. Uninstall the plugin leaving every existing note, project and source database intact.
7. See passing independent unit, packaging, cross-platform and actual Obsidian Desktop integration tests and reproducible release assets.

**No Community Plugins availability, user vault installation, X access or universal research quality is claimed before the corresponding explicit acceptance.**
