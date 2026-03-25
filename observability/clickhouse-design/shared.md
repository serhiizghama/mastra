# ClickHouse vNext Observability Shared Design

## Status

Working shared design for the ClickHouse `v-next` observability domain.

## Purpose

Capture the decisions that apply across the ClickHouse `v-next` observability domain so the per-table docs can stay focused on table-specific behavior.

## Scope

- support all five observability signals in the first `v-next` pass:
  - `span_events`
  - `metric_events`
  - `log_events`
  - `score_events`
  - `feedback_events`
- keep the `v-next` code path isolated from the current ClickHouse observability implementation
- preserve the standard Mastra `ObservabilityStorage` integration surface with `DefaultExporter`

## Non-Goals

- reusing the current ClickHouse observability schema as the design driver
- requiring materialized views in v0
- finalizing every long-term optimization before the base tables exist
- forcing ClickHouse semantics to mirror DuckDB internals when ClickHouse-specific behavior is a better fit

## Write Path Assumptions

The intended write path does not change:

1. observability signals are emitted from the runtime
2. `DefaultExporter` batches the events
3. the exporter calls the relevant `batchCreate*` method on the observability storage domain
4. ClickHouse `v-next` persists and queries those records through the standard storage interface

Important note:

- in the current exporter implementation, `observabilityStrategy` affects tracing-event routing only
- metrics, logs, scores, and feedback still flow as create-only batched writes
- this means ClickHouse can keep `event-sourced` exporter routing for all signals while still choosing a narrower storage model for `span_events`
- tracing event type is still visible inside `DefaultExporter` before `buildCreateSpanRecord` runs
- the current shared record-builders do not yet populate every field required by the `v-next` score/feedback designs
- the `v-next` implementation should update the write path and record-builder layer as needed to populate the agreed typed columns

## Storage Strategy

Current v0 direction:

- use append-only tables for all five signals
- use `event-sourced` exporter routing for ClickHouse `v-next`
- treat ended-span persistence as the actual tracing storage model in v0
- persist only tracing create events corresponding to completed spans
- if the ingest path only sees created span records and not tracing event type, first normalize event spans so `endedAt = startedAt` when `isEvent = true` and `endedAt` is null
- after that normalization, use `endedAt != null` as the v0 persistence gate
- do not add physical `createdAt` or `updatedAt` columns to the append-only `v-next` tables
- do not use a mutation-oriented span table design as the primary model
- use `MergeTree` base tables in v0

Expected `observabilityStrategy` direction:

- preferred: `event-sourced`
- supported: `event-sourced`

## Domain Layout

Planned layout:

```text
stores/clickhouse/src/storage/domains/observability/v-next/
  index.ts
  ddl.ts
  metrics.ts
  tracing.ts
  logs.ts
  scores.ts
  feedback.ts
  discovery.ts
  filters.ts
  helpers.ts
```

## API To Storage Mapping

Current v0 direction:

- the storage layer should keep a small explicit mapping layer between public API field names and ClickHouse physical column names
- do not scatter ad hoc name remapping across query code

Known mappings:

- span API field `name` -> `span_events.spanName`
- metric API field `name` -> `metric_events.metricName`
- feedback API filter field `source` -> `feedback_events.feedbackSource`

Important note:

- `scoreSource` is currently a storage-column naming decision rather than a public score filter field because the current score filter schema does not expose score source filtering

## Shared Field Policy

### Typed query-hot columns

Current v0 direction:

- keep query-hot dimensions in typed columns
- do not hide stable product dimensions inside JSON if we already know they need filtering, grouping, or discovery support

### Information-only semi-structured payloads

These fields should remain off the hot query path in v0:

- `metadata`
- `scope`
- `costMetadata`
- log `data`
- span `attributes`
- span `links`
- span `input`
- span `output`
- span `error`
- span `requestContext`

Current v0 direction:

- store them as JSON-encoded strings
- keep them available for retention and inspection
- do not use them for discovery
- do not use them for grouping

Important note:

- JSON encoding here means the storage layer should preserve any JSON-serializable value shape, not just objects
- this includes strings, numbers, booleans, arrays, objects, and `null`
- the storage write path should JSON-encode these values before insert and JSON-decode them on reads
- `requestContext` is explicitly an information-only JSON payload in v0
- `requestContext` should not participate in filtering or search

Important note:

- this default `metadata` rule applies to metrics, logs, scores, and feedback
- tracing is the exception:
  - `span_events.metadataRaw` is information-only and stays off the hot path
  - `span_events.metadataSearch` is query-relevant and exists specifically for trace metadata filtering

### Query-relevant flexible fields

These fields remain query-relevant in v0:

- `labels`
- `tags`
- `span_events.metadataSearch`

Current v0 direction:

- `tags` should use `Array(LowCardinality(String))`
- `labels` should use `Map(LowCardinality(String), String)`
- `span_events.metadataSearch` should use `Map(LowCardinality(String), String)`

Important note:

- the shared direction applies only where those fields actually exist on a table
- not every signal needs `labels`
- not every signal needs `tags`

## Shared Normalization Rules

Normalization should live in shared code rather than being reimplemented separately per backend.

For `labels`:

- trim string values before storage
- drop entries whose value is `null`
- drop entries whose value is not a string
- drop entries whose trimmed value is empty

For `tags`:

- trim string values before storage
- drop `null` values
- drop non-string values
- drop entries whose trimmed value is empty
- de-duplicate repeated tags within the same row before insert

For `span_events.metadataSearch`:

- trim string values before storage
- drop entries whose value is `null`
- drop entries whose value is not a string
- drop entries whose trimmed value is empty
- remove keys already promoted into typed columns before storage

## Shared LowCardinality Guidance

Strong v0 candidates:

- entity hierarchy fields
- `environment`
- `source`
- `serviceName`
- metric `metricName`
- `provider`
- `model`
- span `status`

Intentional v0 decisions:

- treat all `entityId` fields as `LowCardinality`
- do not treat `feedback_events.value` as `LowCardinality`

## Discovery Policy

Current v0 direction:

- discovery queries should operate directly on the base tables
- do not add helper views in v0 unless implementation evidence justifies them

Cross-signal discovery should operate over the tables that actually carry those fields in v0:

- `span_events`
- `metric_events`
- `log_events`

Scores and feedback should not be forced into cross-signal entity discovery just for symmetry.

## Deletes And Clearing

Current v0 direction:

- `batchDeleteTraces` and similar delete-style operations should use ClickHouse lightweight deletes
- the design should assume eventual consistency for deletes
- `dangerouslyClearAll` should use `TRUNCATE TABLE`

## DDL Strategy

Current v0 direction:

- use raw ClickHouse DDL in `v-next/ddl.ts` for the observability base tables
- do not try to force `Map(...)`, `Array(...)`, or `LowCardinality(...)` through the current generic storage-schema abstraction

## Additional ClickHouse Structures

Current v0 direction:

- do not add projections, materialized views, or helper tables beyond the base layout in v0
- if a specific query becomes a concrete implementation problem, add a targeted optimization only with a measured reason

## Testing Requirements

At minimum, `v-next` tests should cover:

- per-table write/read happy paths
- tracing event-sourced routing with ended-span-only persistence
- per-table `ORDER BY` expectations where testable
- span `status`
- trace `hasChildError`
- `metadataRaw` vs `metadataSearch`
- exact filter-surface behavior per signal
- shared normalization rules
- mixed `costUnit` behavior in metrics responses
- delete eventual-consistency expectations

## Implementation Notes

- ClickHouse semantics should be the primary reference for `v-next`
- DuckDB should be treated as a parity reference, not as the source of ClickHouse query semantics
- implementation should include explicit read/write adapters for the storage-column renames introduced by `v-next`
