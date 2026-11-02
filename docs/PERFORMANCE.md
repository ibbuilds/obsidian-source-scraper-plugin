# Performance validation

The client keeps a bounded import (5,000 records / 8 MB), a 200-record selection
and native paged rendering. Its existing benchmark on Windows / Node v24.15.0
measured a 4,000-record, 1.87 MB import at 12.19 ms median and a 200-draft preview
at 5.03 ms. These paths were already fast; their code and safety limits were retained.

```sh
node --experimental-strip-types scripts/bench-import.mjs
```

The matching engine performance update removes repeated page scans from ordinary
entity exports, reuses snapshot rows for provenance and adds bounded concurrent
public metadata enrichment. At 20,000 records, compact JSON exports measured
2120.72 → 379.86 ms and full-provenance JSON 3378.47 → 1072.49 ms on the same
Windows / Node v24.15.0 / Ryzen 7 3700X setup. At 100,000 links, compact NDJSON
export took about 1.4 s; full-provenance NDJSON took 4.4–5.1 s. All output keys,
counts, order and provenance presence were checked.

See the engine's [reproducible full-pipeline report](https://github.com/ibbuilds/source-scraper/blob/main/docs/pipeline-performance.md)
for workload definitions, samples, memory costs and limitations. The provider CI
pins the compatible engine commit and tests the actual independent subprocess bridge.
No new client tool, server, import limit, trust-cache shortcut, model evaluation or
vault-note mutation was introduced. These local/synthetic measurements are not
claims about live X network throughput; collection still needs the locally granted
session and obeys the adapter's page/rate boundaries.
