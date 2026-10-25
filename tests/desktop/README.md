# Genuine Obsidian Desktop acceptance

Runs with `wdio-obsidian-service` in the isolated fixture vault in this directory.
Never point this at a personal vault.

At the repository root:

```sh
npm ci
npm run build
npm install --prefix tests/desktop --no-audit --no-fund
npm --prefix tests/desktop test
```

The test loads the genuine plugin, imports versioned JSON, explicitly selects one record,
previews the note, creates it only once, then manually edits and repeats export.
It verifies existing References.md and Projects/Important.md survive unchanged.
