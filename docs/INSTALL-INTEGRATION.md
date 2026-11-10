# Install the verified integration bundle

Use the **source-scraper-integration.zip** asset from the new plugin release, not the old embedded `x-feed-scraper` ZIP. Verify the archive against that release's SHA256SUMS before extracting it. Node.js 22.16+ and Obsidian Desktop are required. The bundle includes the engine, independent plugin and the reviewed existing Vault as MCP host; no npm installation is needed on the target machine.

## Preview first

Choose an existing workspace directory outside the vault (neither its child nor its parent). Extract the bundle into its own directory. With absolute paths, run:

```sh
node /absolute/bundle/install.mjs --vault /absolute/vault --workspace /absolute/workspace
```

This is a read-only plan. It prints the number of files to change and `manifestHash`; it neither collects sources nor writes notes. It rejects tampered assets, linked destination paths, changed trusted project manifests and unsafe directory relationships. Review the release identity and digest rather than trusting an arbitrary archive because it printed a hash.

Close Obsidian before applying. Back up personal content independently; this installer backs up only the code and configuration files it changes, not the entire vault. Repeat with the printed manifest fingerprint:

```sh
node /absolute/bundle/install.mjs --vault /absolute/vault --workspace /absolute/workspace --apply --obsidian-closed --trust-bundle SHA256_FROM_PREVIEW
```

PowerShell uses the same arguments; quote paths containing spaces. To choose a different installed Node executable, supply its absolute path with `--node`. The script uses the standard `.obsidian` configuration directory. It does not guess other vaults or modify other plugin directories.

## What changes

Only `main.js`, `manifest.json` and `styles.css` for `source-scraper` and `vault-as-mcp`; those two plugins' `data.json`; `.obsidian/community-plugins.json`; and the external workspace runtime/starter files. The engine is stored by its content digest. Existing host authentication, endpoint and note ACL settings are preserved. Existing registered projects and X settings are preserved, not granted anew. Never publish the private backup folder or configuration.

The installer enables the `source-scraper` provider and MCP access locally. It never changes the tunnel, logs in to X, runs a source, enables X likes, opens SQLite, or creates/edits a user note. When no projects exist, it creates a clearly labeled offline synthetic starter outside the vault, without running it.

## Verify the device and ChatGPT separately

Reopen Obsidian. In Source Scraper settings, select **Integration diagnostics → Check setup**. The host API, permission, 28-tool registration, CLI digest/contracts and project checks must pass. This diagnoses local setup only. Refresh the existing Obsidian app's tool inventory in ChatGPT, then actually invoke `source_scraper_capabilities` and `source_scraper_list_projects`. No second MCP endpoint is required.

Run the offline starter explicitly, inspect evidence, stage candidates and preview drafts. Then test a bounded public source and, only with the locally configured session/read grant, one X window. A local capabilities result cannot certify current X access. Do not enter cookies or host tokens in chat.

## Failure and rollback

Changed files are backed up under the external workspace's `installation-backups/<receipt>/`; the receipt records before/after digests and target paths. A write failure immediately rolls back only this installer's writes. Concurrent modifications are preserved and reported as conflicts. No historical SQLite, legacy plugin or user content is removed.

For a later manual code rollback, close Obsidian, read the private receipt, verify that each target still matches its recorded `after` digest, and restore its matching numbered backup (or remove only installer-created files whose `before` is null). Do not restore over changed configuration or newer user data. Resolve mismatches manually, retain the receipt, and never restore a database automatically. The standard note-only MCP host can be restored without changing any notes.

## Acceptance record

`integration.json` records exact source commits, patch digest and artifact fingerprints. It deliberately says device and cloud acceptance are not tested. Record those outcomes only after the actual checks above. Passing CI is not a substitute for a live cloud tool call or a human assessment of resource quality.
