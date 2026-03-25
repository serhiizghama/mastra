# ClickHouse vNext Span Events Design

## Status

Working table design for `span_events`.

## Purpose

Define the logical shape, physical shape, and query contract for ClickHouse `v-next` tracing storage.

## v0 Model

Current v0 direction:

- persist only completed spans
- ClickHouse may receive started-span writes through `event-sourced` routing
- conceptually, only tracing create events corresponding to `SPAN_ENDED` should be persisted
- in the storage-facing `batchCreateSpans` path, event spans should first be normalized so `endedAt = startedAt` when `isEvent = true` and `endedAt` is null
- after that normalization, the v0 persistence gate is whether the row represents a completed/ended span
- each stored row represents the final ended span state
- do not store `eventType`

This intentionally diverges from DuckDB's start/end event model.

## Trace Model

Current v0 direction:

- a trace is the set of spans sharing the same `traceId`
- the root span is the span whose `parentSpanId` is `null`
- `listTraces` should operate on root spans only
- trace-level filters should be evaluated against the root span unless the filter is explicitly trace-aggregate behavior such as `hasChildError`
- because trace listing operates on root spans, `entity*`, `parentEntity*`, and `rootEntity*` trace filters collapse to the same root-span entity values
- no separate physical parent/root entity columns are required on `span_events` in v0
- span tags should be treated as a root-span feature in v0
- non-root span tags should not be relied on for query behavior in v0

## Logical Shape

### IDs

- `traceId`
- `spanId`
- `parentSpanId`
- `experimentId`

### Entity

- `entityType`
- `entityId`
- `entityName`

### Context

- `userId`
- `organizationId`
- `resourceId`
- `runId`
- `sessionId`
- `threadId`
- `requestId`
- `environment`
- `source`
- `serviceName`
- `requestContext`

Important note:

- `requestContext` should be stored as a serialized JSON blob
- `requestContext` is retained for inspection only in v0
- `requestContext` should not participate in filtering, search, discovery, or grouping in v0

### Span-specific scalars

- `spanName`
- `spanType`
- `isEvent`
- `status`
- `startedAt`
- `endedAt`

### Searchable metadata

- `metadataSearch`

### Information-only payloads

- `attributes`
- `scope`
- `links`
- `input`
- `output`
- `error`
- `metadataRaw`

Important note:

- `input`, `output`, `scope`, `links`, `error`, `requestContext`, `attributes`, and `metadataRaw` should all be stored as JSON-encoded strings in ClickHouse
- the write path should preserve any JSON-serializable value shape for these fields, including scalar values
- the read path should JSON-decode them back into their original logical shapes

### Query-relevant flexible fields

- `tags`

## Span Status

Current v0 direction:

- store a typed `status` column
- allowed values:
  - `success`
  - `error`
- determine write-time `status` from the presence of span error information
- do not determine `status` by inspecting `output`

Important note:

- stored span `status` is not the same thing as the public trace `status` filter surface
- `span_events.status` only stores `success` or `error`
- `running` remains part of the public trace API, but ClickHouse `v-next` v0 intentionally returns no rows for it

## Event Span Normalization

Current v0 direction:

- event spans should be stored in ClickHouse as zero-duration spans
- when `isEvent = true` and `endedAt` is null on ingest, set `endedAt = startedAt` before persistence
- this normalization is ClickHouse-internal and exists to make ended-span-only storage workable for event spans

Important note:

- this means event spans should still be persisted from `SPAN_ENDED` tracing events even though the exported span shape does not carry a real end time
- if preserving the current public contract matters on reads, ClickHouse can normalize `endedAt` back to `null` for event spans when returning API records

## Metadata Model

Current v0 direction:

- keep the original metadata payload in `metadataRaw`
- return span `metadata` by reconstructing from `metadataRaw`
- keep only searchable string-string pairs in `metadataSearch`
- filter/search only against `metadataSearch`
- do not support searching non-string metadata values in v0
- `scope` remains a serialized JSON blob and should only be filtered through JSON extraction because the current trace filter schema exposes it

Important note:

- `metadataRaw` should be JSON-encoded at write time even when the original metadata contains scalar leaf values or mixed nested shapes

Before writing `metadataSearch`, remove keys already promoted into typed columns, including:

- `userId`
- `organizationId`
- `resourceId`
- `runId`
- `sessionId`
- `threadId`
- `requestId`
- `environment`
- `source`
- `serviceName`

## Physical Shape

Current v0 direction:

- `ENGINE = MergeTree`
- `PARTITION BY toDate(endedAt)`
- `ORDER BY (endedAt, traceId)`

Additional notes:

- `startedAt` must be stored directly because there are no started-span rows to reconstruct it from
- `status`, `spanType`, `entityType`, `entityId`, `entityName`, `environment`, `source`, and `serviceName` are good `LowCardinality` candidates
- `PARTITION BY toDate(endedAt)` keeps the physical layout aligned with the stored ended-span model
- `ORDER BY (endedAt, traceId)` prioritizes time-window and recency-oriented trace queries in v0
- event spans should have `startedAt = endedAt` after ClickHouse ingest normalization

## Query Contract

Current v0 direction:

- `getSpan`, `getRootSpan`, `getTrace`, and `listTraces` should operate only on completed spans/traces
- ClickHouse `v-next` v0 does not support live/running trace visibility
- `getRootSpan` and `listTraces` should read only spans where `parentSpanId IS NULL`
- trace `status` in `listTraces` should be derived from the root span
- filters asking for `status = running` should return no rows
- `hasChildError` should be computed at query time as "any span in the same trace has `status = error`"
- `hasChildError` should not require a stored helper column in v0
- metadata filtering should target `metadataSearch`, not `metadataRaw`
- scope filtering should target the serialized `scope` payload via JSON extraction
- returned span records should reconstruct `metadata` from `metadataRaw`
- returned span records should populate `createdAt = startedAt` and `updatedAt = null` in v0

Current public trace filter schema includes:

- `startedAt`
- `endedAt`
- `spanType`
- `entityType`
- `entityId`
- `entityName`
- `parentEntityType`
- `parentEntityId`
- `parentEntityName`
- `rootEntityType`
- `rootEntityId`
- `rootEntityName`
- `userId`
- `organizationId`
- `resourceId`
- `runId`
- `sessionId`
- `threadId`
- `requestId`
- `environment`
- `source`
- `serviceName`
- `scope`
- `experimentId`
- `metadata`
- `tags`
- `status`
- `hasChildError`

Important note:

- all trace filters other than `hasChildError` should be evaluated against the root span
- because trace filters are evaluated on the root span, `parentEntityType`, `parentEntityId`, `parentEntityName`, `rootEntityType`, `rootEntityId`, and `rootEntityName` should be treated as aliases of the root span's `entityType`, `entityId`, and `entityName`
- returned API field `name` should map to storage column `spanName`
- trace `metadata` filters should target `metadataSearch`
- trace `scope` filters should target the serialized `scope` payload
- ClickHouse should map normalized zero-duration event spans back to `endedAt = null` on reads to preserve the current public event-span shape

## Intentional v0 Limitations

- no live/running trace visibility
- no reconstruction from start/end span events
- started-span writes are intentionally discarded in v0
- no searching non-string metadata values
- no metadata grouping/discovery from `metadataRaw`
- no dedicated optimization for `hasChildError` beyond trace-local query structure in v0
