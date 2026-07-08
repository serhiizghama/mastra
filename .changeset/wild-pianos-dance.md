---
'@mastra/memory': patch
---

Fixed observational memory polluting message history: the OM status snapshot (data-om-status) is now marked transient, so it is no longer persisted as a standalone assistant message in mastra_messages.
