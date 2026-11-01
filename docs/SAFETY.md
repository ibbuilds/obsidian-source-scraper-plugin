# Safety and vault ownership

The user owns all vault notes and existing content. Source Scraper's active UI and MCP provider do not create, modify, append, rename, delete, trash, retire or overwrite any user note. This includes new final notes: only ChatGPT may request their creation through the separate existing Obsidian connector when explicitly instructed by the user.

## Runtime boundary

- Collection, import, assessment, staging, queue restoration and draft previews create zero vault notes.
- The provider receives read callbacks and an existing-path predicate, not a Vault writer or note-creation callback.
- No save-notes tool, write toggle or create-notes UI action is registered. Unknown write-tool calls are rejected.
- Project JSON creation is restricted to the registered external workspace and refuses a workspace inside the vault. The UI can inspect existing vault manifests but cannot create or overwrite them.
- The plugin may update its own settings and private job/queue metadata. Developer installation/build changes apply only to the explicitly authorized plugin/code directories.
- Historical create-only helpers and their tests are retained in the repository for compatibility, but the active entry point does not import their mutation functions.

The existing Obsidian connector keeps its own read/write permissions and ACLs. Source Scraper does not call the connector to write, change those permissions, or impersonate a user order. Source content and AI recommendations never grant authority. Engine human reviews remain separate from agent records.

## Source and process trust

Only locally registered project IDs resolve to canonical paths and trusted manifest digests. The CLI is pinned by SHA-256 and Node uses an absolute locally configured executable. Remote tool input cannot supply a shell, executable, extension, database path or arbitrary process flags. Changing a manifest or CLI requires local reverification.

The current remote provider rejects custom/executable source adapters, including mcp-stdio. Admitted file sources must remain inside the approved project workspace, including realpath and reparse-point checks. Public network sources use the engine's existing validation and network restrictions. No cookies, sessions or secrets are collected or committed.

Fixed subprocess arguments use shell:false, bounded output/timeouts and UTF-8-safe decoding. Only the owned active command can be cancelled. Valid partial JSON from nonzero engine exits is retained; stderr is bounded and redacted. User/private source contents are not logged by provider dispatch.

## Evidence and drafts

Entity JSON v1 is runtime-validated and bounded. Unsafe paths, credential-bearing URLs, prototype pollution, duplicate identity, excessive nesting and unsupported schemas are rejected. Markdown-sensitive content is escaped and evidence is rendered as data. Draft generation does not execute source HTML or templates.

Agent records require the current engine evidence fingerprint. Reference paths pass host read ACL checks and supplied hashes are compared with readable reference content. Full private reference-note bodies are not required in persistent agent records. Changed or unreadable references make prior recommendations stale.

## Verification

The provider harness and policy tests prove that no note-write operation is exposed, draft previews create no files, unknown write requests fail, and existing sentinel notes remain unchanged. Synthetic engine and legacy writer tests are distinct from the running personal vault. Never target a personal vault with CI or create personal-vault notes as a development acceptance step.

Preserve the legacy repository, original plugin assets and uncommitted tunnel work before deployment. Verify backups and compare pre-existing user-content hashes after installation. Rollback restores or disables project code; it does not delete, restore over, or otherwise manage user notes.
