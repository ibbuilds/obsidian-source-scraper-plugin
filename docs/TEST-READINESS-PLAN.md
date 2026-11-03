# Native Obsidian interface — acceptance

The supplied ChatGPT connection panel is the interaction reference. Source Scraper remains directly after ChatGPT in the status bar and opens a compact, anchored, non-modal popover. The visible label is always **Source Scraper**, with no count, state suffix or custom colour. Readiness is available in its tooltip and inside the popover.

Use Obsidian's ButtonComponent, SearchComponent, DropdownComponent, interface font, semantic colours, radii, spacing and shadows. No added fonts, fixed brand palette, dashboard, tab strip, decorative icons or separate sidebar. The Taste proposal informed hierarchy; the user's explicit native-Obsidian requirement governs all visual tokens.

The header, content and navigation/footer actions use whitespace instead of separator lines, matching the ChatGPT connection panel's native padding and control geometry.

## Main journey

1. Home: X / For You, actual connection state, one action (Connect X, Find resources, Stop or Retry), then Resources with its count. Configured example data must remain labeled examples. Fixed panel size: 400 × 500 px, clamped to the viewport.
2. Resources: native search, native selection checkboxes, title opening source evidence, official domain, concise description, selected count and Preview drafts. A back arrow returns home. Scores and full evidence remain in the detail dialog. Non-pending human decisions remain visible.
3. Options: import results, change/disconnect X, other registered sources, collapsed advanced tools, plugin settings and diagnostics. The back arrow returns to the originating screen. All advanced functionality remains available.
4. Drafts: previews only. Source Scraper never writes notes. ChatGPT uses the existing separate connector only on the user's explicit order.

## Verification

- Typecheck, unit tests and build.
- Genuine isolated Obsidian Desktop: status ordering and fixed label width; keyboard activation, back navigation, focus restoration, Escape/outside click; no idle DOM rewrites; import and invalid-import recovery; native filtering and clear button; native selection and preview; evidence; advanced tools; masked session setup, no plaintext preferences and Windows DPAPI restore across a genuine plugin reload; explicit collection/cancel/no duplicate runs; completed empty results; light/dark and narrow layout, including long names; passive MCP arrivals and cleanup on unload.
- Existing isolated-vault files remain byte-for-byte unchanged throughout all scenarios.
- Screenshots come from the genuine running plugin, with illustrative fixtures explicitly marked. They are not stand-alone HTML mockups.
- Remaining external gate: load the owner's X session locally and inspect a real For You sample. Neither fixture success nor loading a local session certifies live feed access or quality.
