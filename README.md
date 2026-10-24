# Source Scraper for Obsidian

**Planned independent, general-purpose Obsidian client for [Source Scraper](https://github.com/ibbuilds/source-scraper).**

> **Development status:** architecture and migration planning. **No plugin binary, installable release, or Community Plugins listing exists yet.** The GitHub repository is not an Obsidian installation.

## Purpose

Consume Source Scraper's documented, versioned JSON/NDJSON records and let users review, browse, and **explicitly export** information to their Obsidian vault without imposing any particular topic, source, ranking rule, folder name, or workflow.

**Source Scraper is the data engine. This repository will contain only the Obsidian client.**

```text
Source adapters → Source Scraper CLI → versioned JSON/NDJSON
                                               ↓
                              Obsidian Source Scraper client
                                               ↓
                             Preview → create-only Markdown notes
```

Users choose their own projects, schemas, sources, processors, evaluation criteria, mappings, and destinations. No React/design/X/marketing rules belong in this integration.

## Non-negotiable protections

- **Never delete, move, rename or overwrite existing vault notes automatically.**
- No default writes to `References.md`, `Sources.md`, existing libraries, or user projects.
- No automatic network collection, file edits, plugin install/migration, or external output on startup.
- First release uses **create-only writes** into a dedicated, user-approved folder. Reimporting a record reports an existing-file conflict or leaves an identical file unchanged.
- All input data is treated as untrusted. Paths, Markdown, links, YAML, schema versions and file sizes are validated before writing.
- Human review and machine scores are separate. The plugin will not auto-approve records.
- Never ask users to paste X cookies, sessions, API secrets or private vault notes into issues.
- The old plugin, with ID `x-feed-scraper`, and its data remain untouched while the independent replacement is built and verified.

## Implementation

The complete staged plan, architecture decisions, dependencies and acceptance gates are in [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md). There is **no installable plugin yet**; this repository will get `manifest.json` and built `main.js` only as working implementation milestones are completed.

**Planned manifest identity:** `source-scraper` (subject to official Community directory uniqueness validation). The repository name can include `obsidian`, but the *plugin ID* cannot contain it or end in `plugin`, per Obsidian's manifest requirements.

## Two independent products

- Engine: [ibbuilds/source-scraper](https://github.com/ibbuilds/source-scraper) — data collection, normalization, persistence, review, versioned JSON API/CLI and independent SDK.
- This repository — optional UI, safe vault import/export, human review interactions, and Obsidian-specific conventions.

Personal or domain-specific projects belong in **external configuration files or adapters**, not hardcoded plugin behavior.

## License

The planned license is MIT, consistent with the source project. A root `LICENSE` file will be included before implementation or publication. Reused code will retain the original license and attribution.
