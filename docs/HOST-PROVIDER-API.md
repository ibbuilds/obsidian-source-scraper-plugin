# Reproduce the existing MCP host extension

The provider hook is a small compatibility patch to the existing Vault as MCP server, not a second server or forked product. Its source is included in [the patch](../compat/vault-as-mcp-1.2.0-provider-api.patch), with the pinned upstream commit and SHA-256 in [provider-api.json](../compat/provider-api.json).

The patch adds a trusted local provider registry, local enablement and namespacing, lifecycle disposal, authenticated HTTP regression tests and a cross-platform postbuild asset copy. It preserves the existing note endpoint and permissions. Source Scraper's provider is review-only and cannot write notes. Upstream adoption is not assumed.

## Build and test

Check out ebullient/obsidian-vault-mcp at commit 0f801bdb94cbf543a8f303b1ca950f30b2783595 (tag 1.2.0). Verify the patch SHA-256 against provider-api.json. From that checkout, run git apply --check followed by git apply using the patch's absolute path. Then run npm ci, npx tsc --noEmit, npm test and npm run build. The build directory contains main.js, styles.css, manifest.json and README.md.

The plugin CI independently checks out that exact upstream commit, applies this patch, runs host tests and builds it. A separate provider/engine CI job exercises this plugin against the matching advertised CLI capabilities; the stable JSON-contract job continues testing the previously released engine.

## Deployment and compatibility

Back up the existing installation and user content privately. Unload the existing Vault as MCP plugin before replacing its built assets in its current directory; preserve data.json, plugin identity, endpoint, authentication and note ACLs. Locally enable provider ID source-scraper in enabledToolProviders, then reload the host and Source Scraper. Refresh an existing connector with a cached tool inventory. There is no remote provider-registration or permission-granting tool.

Registration is trust in local plugin code, not an OS sandbox. The provider cannot replace built-in tool names and cannot register unless locally enabled. It does not grant access beyond its own admitted operations. Source Scraper uses host read ACL checks and exposes no note-write operation; ChatGPT's separate connector remains the sole route for an explicit user-directed note change.

If the host lacks this API, Source Scraper reports incompatibility while ordinary JSON import remains usable. A future upstream host update must be checked for the required API before replacing the custom build. Retire this compatibility patch when an upstream version supplies an equivalent verified API. Do not silently monkey-patch internal objects or add another server to hide incompatibility.

Rollback disables the provider and restores backed-up host assets. It never deletes, restores over or otherwise manages user notes. Keep deployment hashes, backups and private paths out of public artifacts.
