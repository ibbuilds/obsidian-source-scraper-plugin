# Free local X For You setup

Uses [Twifork](https://github.com/PawiX25/twifork) 2.4.0 to read For You directly from X. No paid API, commercial key, subscription or third-party session service. GetXAPI is retired. Bounded authenticated reads have recorded live acceptance; a new account/session must still complete its own successful run.

1. Prepare the engine's isolated Python runtime (`scripts/setup-x-local.ps1` on Windows) and configure its absolute interpreter path in plugin settings.
2. Click **Source Scraper** immediately after ChatGPT in Obsidian's status bar. Select the X project, then choose **Connect X** (or **Options → Change session**). Enter the numeric account ID and the two session values in the masked local fields (`auth_token` and `ct0`). Never place them in chat, remote arguments, project JSON, notes or Git. No browser cookie extraction or automated login is included.
3. Choose relevance filters and 1–10 pages for a new project. **Connect** prepares the external project and enables local access, without contacting X or creating a note. Changed filters create a new external profile while retaining prior project manifests/data. With a loaded session, blank cookie fields retain the current values.
4. On Windows, session values are encrypted for the current Windows user with DPAPI in `%LOCALAPPDATA%/SourceScraper/sessions/<vault-hash>.dpapi`, outside the vault. A fresh plugin instance restores them only while the existing local grant is enabled; it never starts collection automatically. **Options → Disconnect X** deletes the encrypted copy. Values never enter preferences, project files, notes, command arguments or Git. Other operating systems retain the previous memory-only behavior, without a plaintext persistence fallback. Expired/revoked X sessions still need renewal. A preconfigured local process environment remains supported. Remote tools cannot enable access or choose executable paths. Disabled child processes receive no X session values; commercial API credentials/approval are always stripped.
5. Choose **Find resources**, or start a bounded cycle under **Options → Collection and feedback**. Account identity is checked, original evidence and expanded links are retained, and continuation persists between bounded windows. Access errors, account mismatch, challenges and unsupported operations stop collection. Rate limits schedule a persisted, bounded cooldown respecting safe server deadlines; repeated 429 failures eventually require manual recovery. Likes require a separate local permission and verified resource/post evidence; reading never grants that permission. No posting, follows, automated login, TLS impersonation or paid fallback.
6. Inspect and choose resources manually, or use optional AI assistance through MCP. Keeping alone queues no likes. Only the separate Obsidian connector writes final notes on user instruction.

The capabilities tool does not contact X. Its legacy `liveVerified: false` field
means this report has not probed live access; `liveVerification: "not-probed"`
makes that scope explicit. Use successful collection results as access evidence,
not the presence of credentials or this capability report. Collection and
already-evaluated feedback need Obsidian and the computer to remain open. No
background model evaluates new resources while the chat is closed.

Public bootstrap scripts receive no account cookies; authenticated requests stay on X first-party hosts. This unofficial client may stop working when X changes or restricts access. Mocked tests or an installed library do not verify the actual personalized feed.
