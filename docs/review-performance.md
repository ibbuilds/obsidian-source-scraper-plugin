# Review interaction performance — 2026-11-03

Windows, Obsidian 1.14.5 / Chromium 150, synthetic 4,000-record import,
40 visible rows, no network or personal-vault access. Baseline `0c9178e`.
Both before/after desktop suites passed all 18 scenarios. Times measure the
synchronous event handler/DOM work inside actual Obsidian, not complete paint
or human typing latency. No noisy timing assertion is added to CI.

| Workload | Baseline | Optimized |
| --- | ---: | ---: |
| Five search edits, median ms | 7.10 | 1.70 |
| Twenty checkbox clicks, median ms | 6.10 | below timer resolution |
| Checkbox click range, ms | 5.4–7.4 | 0–0.3 |
| Child-list mutation records over all actions | 8501 | 1850 |
| Same search input retained | no | yes |

Search edits now rebuild only the bounded result page and pagination. The
search input/footer stay mounted, so focus and cursor do not need restoration.
Selecting updates only the selection count and preview-button state; the
checkbox and result rows remain in place. Preview reads the current selection.

A lazy search index normalizes the four existing searchable fields once per
mounted import. It caches only the most recent nonempty query; it has no global,
cross-project or unbounded-query cache. Closing/replacing the result view releases
the index with its DOM handlers. Empty searches reuse the original ordered array.
Per-field, case-insensitive substring matching remains unchanged.

## Reproduce

```sh
npm run package
npm run test:desktop
```

The desktop test emits `REVIEW_PERFORMANCE` with samples, DOM identity and
mutation counts. Run before/after on the same Obsidian build for comparison.
Functional assertions cover stable DOM identity, 40-row bounding, selection,
preview, keyboard filtering, encrypted session reload and zero vault-note writes.
The original 5,000-record / 8 MB import limits and 200-draft limit remain intact.
