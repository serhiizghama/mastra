---
'@mastra/core': patch
---

Fixed streaming agent runs pinning a CPU core on long responses. Result deduplication in the workflow engine re-serialized the full, ever-growing run context once per stream chunk (O(n²) in output length), starving the event loop. The structural comparison is now size-bounded, so streaming CPU scales linearly with output length as generate() already does.
