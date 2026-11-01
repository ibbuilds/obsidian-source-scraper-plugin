# Free local X For You setup

Uses [Twifork](https://github.com/PawiX25/twifork) 2.4.0 to read For You directly from X. No paid API, commercial key, subscription or third-party session service. GetXAPI is retired. Real personalized account access still needs live acceptance.

1. Prepare the engine's isolated Python runtime (`scripts/setup-x-local.ps1` on Windows) and configure its absolute interpreter path in plugin settings.
2. Supply `SOURCE_SCRAPER_X_ACCOUNT_SESSION` and `SOURCE_SCRAPER_X_CSRF` locally before starting Obsidian. Never place them in chat, remote arguments, project JSON, notes or Git. No browser cookie extraction or automated login is included.
3. Open **Source Scraper → X feed setup**. Enter the numeric account ID, edit relevance filters and choose 1–10 pages. Prepare the project in the external workspace; this does not contact X or create a note.
4. Enable **Allow local read-only X feed access** when the local session is ready. This starts no collection. Remote tools cannot enable it or choose executable paths. Disabled child processes receive no X session values; commercial API credentials/approval are always stripped.
5. Run explicitly with page size 100–500. Account identity is checked, original evidence and expanded links are retained, and continuation persists between bounded windows. Access errors, rate limits, account mismatch, challenges and unsupported operations stop collection. No posting, likes, follows, automated login, TLS impersonation or paid fallback.
6. Inspect findings, let ChatGPT assess quality separately, and stage its shortlist. Only the separate Obsidian connector writes final notes on user instruction.

Public bootstrap scripts receive no account cookies; authenticated requests stay on X first-party hosts. This unofficial client may stop working when X changes or restricts access. Mocked tests or an installed library do not verify the actual personalized feed.
