# Compatibility and independent release policy

| Component | Compatibility |
| --- | --- |
| Source Scraper engine | Independent repository `ibbuilds/source-scraper`; plugin imports its public JSON/NDJSON v1 output |
| Public schema | `schemaVersion: 1`, `dataset: entities`; no import of `packages/*` or private SQLite tables |
| Engine tested | `v0.14.0-beta.1` produces valid exports with the fields accepted here |
| Initial Obsidian plugin | `0.1.0`, manifest ID `source-scraper`, installed separately from old `x-feed-scraper` |
| Obsidian Desktop | Minimum manifest version 1.9.2, desktop-only because of Node built-ins |
| Node | Not required as a **separate install** for import/export inside Obsidian Desktop; separate engine CLI requires Node 22.16+ |
| Personal vault | No automatic migration or modifications to pre-existing notes |
| Legacy plugin | Existing `Discovery Engine` (`x-feed-scraper`) remains independently functional; never auto-removed |

JSON is an interchange contract. The plugin does not inspect or modify engine SQLite files directly. The optional local CLI bridge uses documented commands and validates its JSON schema version before running user-confirmed collection. The human-review action uses documented `validate` and `review` CLI commands with an exact project ID check; it never edits the engine's SQLite tables directly.

Release tags in this plugin repository **must match** manifest version exactly (e.g. `0.1.0`, no prefix `v`), with `main.js`, `manifest.json`, `styles.css` attached. Plugin releases are **not purged** because older Obsidian installations may require older compatible downloads.

The user may manually install files from the GitHub release once it is published. The plugin has **not** been approved or indexed by the Obsidian Community directory; enabling a manually installed plugin is a local user action.

The motor's separate GitHub one-release policy does not apply here.
