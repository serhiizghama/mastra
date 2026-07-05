---
'@mastra/core': patch
---

Fixed `Agent#generate` and `stream` rejecting AI SDK v7 (`ai@7`) `ModelMessage[]` and `UIMessage[]`. The `MessageInput` union declared `@internal/ai-v7` as a dependency but never added the v7 branch, so under `exactOptionalPropertyTypes: true` a v7 message fell through to the v4 branch and failed to type-check. v7 messages are now accepted without turning off strict options.
