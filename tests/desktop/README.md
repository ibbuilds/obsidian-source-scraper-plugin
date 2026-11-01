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

The tests load the genuine plugin, import versioned JSON, select a record and preview
Markdown drafts. They assert that no note/project-file creation control is exposed,
reimport/evidence inspection/filtering create no files, and every existing fixture
file stays byte-for-byte unchanged. There is no note-writing acceptance step.
