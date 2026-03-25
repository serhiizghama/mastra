Findings

  1. Critical: the proposed span_events shape is not implementable against the current tracing contract because it drops startedAt while also dropping
     start events. The design says only completed spans are stored and lists eventType, timestamp, and endedAt, but not startedAt (observability/costing/
     clickhouse-v-next-observability-design.md:173). The storage contract requires startedAt on every span and listTraces filters/orders on it (packages/
     core/src/storage/domains/observability/tracing.ts:104, packages/core/src/storage/domains/observability/tracing.ts:290). DuckDB gets startedAt from
     start events; your design removes that path without replacing it (stores/duckdb/src/storage/domains/observability/tracing.ts:61).
  2. Critical: the strategy section contradicts the ended-span-only design and the actual exporter behavior. The doc says no exporter changes, and says
     ClickHouse v-next should prefer/support event-sourced (observability/costing/clickhouse-v-next-observability-design.md:13, observability/costing/
     clickhouse-v-next-observability-design.md:72). But the exporter’s event-sourced mode buffers SPAN_STARTED as creates; only insert-only ignores start/
     update events and only persists ended spans (observability/mastra/src/exporters/event-buffer.ts:79, observability/mastra/src/exporters/event-
     buffer.ts:101). As written, either the doc is wrong about strategy, or the implementation will immediately diverge from the doc.
  3. High: the design does not state what the query contract becomes for running traces. If only ended spans exist, status=running, endedAt IS NULL, and
     “show me the live trace” semantics are either unsupported or silently empty. The public trace schema still exposes running status and running-based
     filters (packages/core/src/storage/domains/observability/tracing.ts:48, packages/core/src/storage/domains/observability/tracing.ts:291). The doc hints
     at a future short-lived store for in-progress spans, but that is not a v0 decision, it is an unresolved dependency (observability/costing/clickhouse-
     v-next-observability-design.md:269).
  4. High: span_events.metadata vs metadataRaw is under-specified and likely breaks the existing API contract. The doc wants metadata to be a stripped,
     searchable key/value map and metadataRaw to preserve the original payload (observability/costing/clickhouse-v-next-observability-design.md:245). But
     the storage contract has one metadata field on the returned span record and trace filters accept arbitrary metadata values, not “string-only leftovers
     after column promotion” (packages/core/src/storage/domains/observability/tracing.ts:76, packages/core/src/storage/domains/observability/
     tracing.ts:122). If metadata becomes labels-like, non-string values and promoted keys disappear from the queryable field. If reads return metadataRaw
     instead, say that explicitly. Right now the design leaves the hardest part unspecified.
  5. High: the ClickHouse physical section is not concrete enough to implement, and part of it is just invalid as a shared rule. The doc says non-metric
     tables inherit the shared physical direction (observability/costing/clickhouse-v-next-observability-design.md:159), then defines PRIMARY KEY (name,
     timestamp) / ORDER BY (name, timestamp) (observability/costing/clickhouse-v-next-observability-design.md:404). That only makes sense for
     metric_events. score_events, feedback_events, and log_events do not have name. span_events has name, but its query shapes are trace-oriented, not
     metric-name-oriented. You need per-table ENGINE, partition key, and ORDER BY, not a global hand-wave.
  6. High: the proposed semi-structured types do not fit the current ClickHouse schema helper layer. The design leans on Array(LowCardinality(String)) for
     tags and Map(LowCardinality(String), String) for labels (observability/costing/clickhouse-v-next-observability-design.md:468). The existing storage
     schema abstraction only knows primitive storage types, and the ClickHouse adapter maps jsonb to plain String (packages/core/src/storage/types.ts:15,
     stores/clickhouse/src/storage/db/utils.ts:65). Inference: if v-next is supposed to reuse StorageColumn/ClickhouseDB.createTable, it cannot represent
     the proposed DDL. If v-next is supposed to bypass that with raw DDL, the doc should say so explicitly.
  7. Medium: query behavior is still too vague for a real implementation. DuckDB already defines concrete behavior for groupBy: real column names win
     first, otherwise keys are treated as label keys (stores/duckdb/src/storage/domains/observability/metrics.ts:172). The doc says “same logical metrics
     surface” and “discovery on base tables” but does not define group-by precedence, exact metadata filter semantics for spans, or what discovery
     endpoints are allowed to scan without extra filters (observability/costing/clickhouse-v-next-observability-design.md:534, observability/costing/
     clickhouse-v-next-observability-design.md:551). That means the implementer will invent semantics during coding.
  8. Medium: the metrics shape is inconsistent with the referenced costing direction. This doc omits first-class metric status entirely (observability/
     costing/clickhouse-v-next-observability-design.md:99), while the costing design explicitly called for first-class status in the storage/query model
     and typed-column strategy (observability/costing/metrics-costing-design.md:976, observability/costing/metrics-costing-design.md:997). If status was
     dropped intentionally, say that. If not, the design is already stale.
  9. Medium: the “immediate next steps” are not complete enough for implementation planning. They omit cutover/migration mechanics, batchDeleteTraces, what
     happens with updateSpan/batchUpdateSpans in the new contract, whether createScore/createFeedback parity matters, and anything beyond happy-path tests
     (observability/costing/clickhouse-v-next-observability-design.md:578, packages/core/src/storage/domains/observability/base.ts:173, packages/core/src/
     storage/domains/observability/base.ts:185). “Happy paths for all endpoints” is not enough for ClickHouse work; the risky parts are nullability, mixed
     costUnit, label/tag normalization, metadata filtering, and live-vs-ended trace behavior.
  10. Low: the feedback table section claims it preserves current record-builder output, but the standard exporter path does not populate sourceId today
     (observability/costing/clickhouse-v-next-observability-design.md:371, packages/core/src/storage/domains/observability/record-builders.ts:306,
     packages/_internal-core/src/storage/domains/observability/feedback.ts:32). That column is fine to keep, but the doc should admit it will be mostly
     empty on the default write path unless propagation changes.

  Open Questions

  - Is v-next actually insert-only for tracing, or truly event-sourced? You have to pick one.
  - If spans are ended-only, what is the official v0 behavior for status=running and live trace reads?
  - Which field is returned as span.metadata: the stripped searchable map, or the original raw metadata?
  - Is v-next allowed to bypass the existing ClickHouse schema abstraction with raw DDL, or do you plan to extend that abstraction first?
  - What are the exact per-table ENGINE and ORDER BY definitions for all five tables?

  Doc Shape
  The doc is too long in the wrong places. It repeats shared policy (“append-only”, “typed hot columns”, “information-only JSON”, LowCardinality) across
  sections, but still misses the decisions that actually block coding: startedAt, running-trace semantics, per-table ordering, and read-path mapping for
  span metadata.

  The span metadata/search design should probably be split into its own short follow-up doc. It is the most contract-sensitive part of the proposal, and
  burying it inside the general table-shape doc makes the whole thing harder to implement correctly.

  ClickHouse Traps

  - Validate JSONEachRow insert/read behavior for Map(...) and Array(...) immediately. The current adapter assumes most semi-structured fields are JSON
    strings (stores/clickhouse/src/storage/db/utils.ts:107).
  - Base-table discovery over labels/tags will turn into mapKeys/arrayJoin-style scans. If that is a v0 choice, define acceptable scope and limits up
    front.
  - Do not let the implementer guess nullability placement for LowCardinality columns. That is DDL, not commentary.

  Net: this is not implementation-ready. The core span model and the ClickHouse DDL story are still unresolved enough that whoever builds stores/
  clickhouse/src/storage/domains/observability/v-next/ would be forced to redesign key parts during implementation.
