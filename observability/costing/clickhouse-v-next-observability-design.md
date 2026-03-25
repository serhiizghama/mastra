# ClickHouse vNext Observability Design

## Status

Working design index for the new ClickHouse observability domain under `stores/clickhouse/src/storage/domains/observability/v-next/`.

## Purpose

This file is now the overview and entry point for the ClickHouse `v-next` observability design. The detailed design has been split into one shared document plus one document per table so implementation decisions are easier to find and maintain.

## Design Set

- [Shared Design](./clickhouse-v-next-observability-shared.md)
- [Discovery Design](./clickhouse-v-next-observability-discovery.md)
- [Physical Types](./clickhouse-v-next-observability-physical-types.md)
- [Span Events](./clickhouse-v-next-observability-span-events.md)
- [Metric Events](./clickhouse-v-next-observability-metric-events.md)
- [Log Events](./clickhouse-v-next-observability-log-events.md)
- [Score Events](./clickhouse-v-next-observability-score-events.md)
- [Feedback Events](./clickhouse-v-next-observability-feedback-events.md)

## Core v0 Decisions

- ClickHouse `v-next` should use append-only storage for all five signals.
- ClickHouse `v-next` v0 should follow ClickHouse best practices wherever practical instead of inheriting design constraints from DuckDB or other storage backends.
- ClickHouse `v-next` should use `event-sourced` exporter routing semantics.
- ClickHouse `v-next` v0 should store only completed spans.
- ClickHouse `v-next` v0 should persist only tracing create events corresponding to completed spans.
- ClickHouse `v-next` v0 should not support live/running trace visibility.
- `span_events` should store `startedAt`, `endedAt`, and a typed `status`.
- `span_events` should keep original metadata in `metadataRaw` and a separate searchable string-string map in `metadataSearch`.
- `metric_events` should not store a `status` column in v0.
- Per-table physical design should be defined per table, not through one shared `ORDER BY`.
- Raw ClickHouse DDL should be used for `v-next` base tables.
- ClickHouse semantics should be the primary reference for `v-next`; DuckDB is a parity reference, not the source of truth.

## Scope

- Cloud ClickHouse physical design is the target for this work.
- Mastra runtime should continue writing through the standard storage interface via `DefaultExporter`.
- ClickHouse `v-next` should be designed around the batched create path used by `DefaultExporter`.
- Legacy observability methods outside that path are expected to be deprecated and should not drive `v-next` design decisions.
- Previous DuckDB or other storage implementations may be used as parity references, but they should not be treated as the design source of truth for ClickHouse `v-next`.
- New code should live under `stores/clickhouse/src/storage/domains/observability/v-next/`.
- Transition, migration, and cutover planning are intentionally out of scope for this design.
- The existing ClickHouse observability domain can remain separate while `v-next` is implemented.

## Rollout Order

1. Finalize the shared and per-table docs.
2. Implement raw ClickHouse DDL for all five `v-next` tables.
3. Implement writes and reads for the five signals.
4. Add targeted tests around the risky contract points:
   - tracing event-sourced routing with ended-span-only persistence
   - per-table ordering
   - span status
   - trace `hasChildError`
   - `metadataRaw` vs `metadataSearch`
   - exact filter-surface behavior per signal
   - label/tag normalization
   - delete eventual consistency

Important note:

- this document set is intentionally about steady-state `v-next` design, not transition mechanics
- migration, cutover, and coexistence planning should not block v0 implementation work

## Related Material

- [Metrics Costing Design](./metrics-costing-design.md)
- [Metrics Costing Design Review](./metrics-costing-design-review.md)
- [Codex Review](./clickhosue-v-next-observability-codex-review.md)
- [Claude Review](./clickhosue-v-next-observability-claude-review.md)
