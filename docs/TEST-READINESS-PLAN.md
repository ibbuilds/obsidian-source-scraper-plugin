# Native Obsidian interface — acceptance

The supplied ChatGPT connection panel is the interaction reference. Source Scraper remains directly after ChatGPT in the status bar and opens a compact, anchored, non-modal popover. The visible label is always **Source Scraper**, with no count, state suffix or custom colour. Readiness is available in its tooltip and inside the popover.

Use Obsidian's ButtonComponent, SearchComponent, DropdownComponent, interface font, semantic colours, radii, spacing and shadows. No added fonts, fixed brand palette, dashboard, tab strip, decorative icons or separate sidebar. The Taste proposal informed hierarchy; the user's explicit native-Obsidian requirement governs all visual tokens.

The header, content and navigation/footer actions use whitespace instead of separator lines, matching the ChatGPT connection panel's native padding and control geometry.

## Main journey

1. Home: the selected source project and its own readiness, one action (Connect X, Find resources, Stop or Retry), then Resources with its count. Generic projects require no X session or Python reader. Configured example data must remain labeled examples. Fixed panel size: 400 × 500 px, clamped to the viewport.
2. Resources: native search, explicit selection checkboxes, titles opening external resources and separate evidence buttons, official domain, concise description and Copy links / Keep / Hide. All resources, Kept and Hidden are views, not quality verdicts. Select page chooses only the 40 visible rows. Preview drafts is optional. A back arrow returns home.
3. Options: import results, Add source, registered projects, relevant X session/collection controls, collapsed advanced tools, plugin settings and diagnostics. The back arrow returns to the originating screen. All advanced functionality remains available.
4. Drafts: previews only. Source Scraper never writes notes. ChatGPT uses the existing separate connector only on the user's explicit order.

## Verification

- Typecheck, unit tests and build.
- Genuine isolated Obsidian Desktop: status ordering and fixed label width; keyboard activation, back navigation, focus restoration, Escape/outside click; no idle DOM rewrites; import and invalid-import recovery; native filtering and clear button; native selection and preview; evidence; advanced tools; masked session setup, no plaintext preferences and Windows DPAPI restore across a genuine plugin reload; explicit collection/cancel/no duplicate runs; completed empty results; light/dark and narrow layout, including long names; passive MCP arrivals and cleanup on unload.
- Existing isolated-vault files remain byte-for-byte unchanged throughout all scenarios.
- Screenshots come from the genuine running plugin, with illustrative fixtures explicitly marked. They are not stand-alone HTML mockups.
- Native recovery checks: a failed query can be retried in place; expired selections refresh without retaining stale checked rows; uncertain saves block new decisions and retry the original request identity. A stopped batch must finish before a new cycle starts.
- Bounded live X reads have recorded acceptance, separate from CI. Neither fixture success nor loading a local session certifies current feed access or resource quality. Do not repeat an account mutation to smoke-test a build.
