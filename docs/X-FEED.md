# Free local X For You setup

Uses [Twifork](https://github.com/PawiX25/twifork) 2.4.0 to read For You directly from X. No paid API, commercial key, subscription or third-party session service. GetXAPI is retired. Real personalized account access still needs live acceptance.

1. Prepare the engine's isolated Python runtime (`scripts/setup-x-local.ps1` on Windows) and configure its absolute interpreter path in plugin settings.
2. Click **Source Scraper** immediately after ChatGPT in Obsidian's status bar, open **Buscar**, then choose **Conectar X**. Enter the numeric account ID and the two session values in the masked local fields (`auth_token` and `ct0`). Never place them in chat, remote arguments, project JSON, notes or Git. No browser cookie extraction or automated login is included.
3. Choose relevance filters and 1–10 pages for a new project. **Conectar** prepares the external project and enables local access, without contacting X or creating a note. Changed filters create a new external profile while retaining prior project manifests/data. With a loaded session, blank cookie fields retain the in-memory values.
4. Session values stay in memory until **Más opciones → Desconectar X** or plugin unload/Obsidian exit. They are not saved in preferences. A preconfigured local process environment remains supported. Remote tools cannot enable access or choose executable paths. Disabled child processes receive no X session values; commercial API credentials/approval are always stripped.
5. Run explicitly with page size 100–500. Account identity is checked, original evidence and expanded links are retained, and continuation persists between bounded windows. Access errors, rate limits, account mismatch, challenges and unsupported operations stop collection. No posting, likes, follows, automated login, TLS impersonation or paid fallback.
6. Inspect findings, let ChatGPT assess quality separately, and stage its shortlist. Only the separate Obsidian connector writes final notes on user instruction.

Public bootstrap scripts receive no account cookies; authenticated requests stay on X first-party hosts. This unofficial client may stop working when X changes or restricts access. Mocked tests or an installed library do not verify the actual personalized feed.
