• Findings

  1. High: the proposed span_events physical layout is wrong for Mastra’s core trace reads. The design sets PARTITION BY toDate(endedAt) and ORDER BY
     (endedAt, traceId) while also requiring getSpan, getRootSpan, and getTrace by trace identity, not by time (observability/clickhouse-design/span-
     events.md:169, observability/clickhouse-design/span-events.md:170, observability/clickhouse-design/span-events.md:184). Inference from ClickHouse
     MergeTree behavior: getTrace(traceId) will have poor partition pruning and poor primary-key locality, especially if a trace spans day boundaries. That
     is a bad trade when the current ClickHouse store already treated (traceId, spanId) sorting as important enough to force a migration (stores/
     clickhouse/src/storage/domains/observability/index.ts:69). With helper structures explicitly deferred in v0, this problem is baked into the base table
     (observability/clickhouse-design/shared.md:246).
  
  2. High: trace metadata filtering is not specified tightly enough to implement without inventing behavior, and it regresses the current contract. The
     design says trace filters should hit metadataSearch, which only keeps searchable string-string pairs, while non-string metadata becomes unsearchable
     (observability/clickhouse-design/span-events.md:142, observability/clickhouse-design/span-events.md:144, observability/clickhouse-design/
     shared.md:159). But it never defines whether nested metadata keys are flattened, what key syntax is legal, what happens for numeric/boolean/object
     filter values, or whether unsupported filters error or silently miss. The current parity behavior does support nested JSON-path filtering and non-
     string values (stores/duckdb/src/storage/domains/observability/filters.ts:4, stores/duckdb/src/storage/domains/observability/filters.ts:13, stores/
     duckdb/src/storage/domains/observability/filters.ts:93). This needs a concrete normalization/query spec before anyone writes filters.ts.
  
  3. High: the tracing design knowingly forks the shared storage contract, but it does not resolve that fork. It says running remains in the public API yet
     ClickHouse v-next should always return no rows for it, and it aliases parentEntity*/rootEntity* trace filters to the root span’s entity* fields
     (observability/clickhouse-design/span-events.md:121, observability/clickhouse-design/span-events.md:188, observability/clickhouse-design/span-
     events.md:230). The shared tracing schema still models running as a real status and exposes distinct parent/root fields in the filter surface
     (packages/core/src/storage/domains/observability/tracing.ts:48, packages/core/src/storage/domains/observability/tracing.ts:291). If this backend-
     specific degradation is acceptable, it needs to be made explicit at the contract/test level; otherwise you are just shipping silent cross-backend
     inconsistency.
  
  4. High: score and feedback are still underdesigned at the write-contract level, and the rollout plan hides that. The docs require typed context columns
     on score_events and feedback_events, but today the shared builders do not populate them beyond feedback.userId, and the event shapes only say that
     context lives somewhere in metadata (observability/clickhouse-design/shared.md:44, observability/clickhouse-design/score-events.md:85, observability/
     clickhouse-design/feedback-events.md:89, packages/core/src/storage/domains/observability/record-builders.ts:288, packages/core/src/storage/domains/
     observability/record-builders.ts:306, packages/core/src/observability/types/scores.ts:45, packages/core/src/observability/types/feedback.ts:42).
     Inference: if v-next stays behind the existing batchCreateScores/batchCreateFeedback path, the backend cannot recover missing typed fields unless you
     first define exact extraction rules from metadata or add a first-class correlation context. The rollout order should explicitly include those upstream
     core/exporter changes before backend implementation starts (observability/clickhouse-design/README.md:50).
  
  5. Medium: the ClickHouse-specific query behavior is still too hand-wavy for Map/Array heavy features. The design says metrics filters/grouping/discovery
     should work directly off labels/tags, and discovery should hit base tables with no time filters and no helper structures (observability/clickhouse-
     design/metric-events.md:141, observability/clickhouse-design/metric-events.md:149, observability/clickhouse-design/discovery.md:69, observability/
     clickhouse-design/discovery.md:82, observability/clickhouse-design/discovery.md:100). That is not unimplementable, but it is under-specified: no exact
     groupBy collision rules beyond “typed column first”, no concrete label-key extraction semantics, no stated acceptance criteria for scan cost, and no
     escape hatch except “measure later”. For ClickHouse, that is where churn comes from.

  Secondary Notes

  - The docs are noisier than they need to be. Repeating Status, Purpose, Current v0 direction, and rationale in every file makes the actual invariants
    harder to extract. The metadata-search contract and the span physical/query contract should be shorter and much more formal.
  
  - The document set is mixing base-schema decisions with follow-up physical-optimization policy. The “no projections/materialized views/helper tables in
    v0” stance (observability/clickhouse-design/shared.md:246) probably belongs in a separate physical-optimization doc, because right now it obscures the
    more important question: whether the base tables are sound on their own.
  
  - ClickHouse traps I would expect:
      - LowCardinality on every entityId is an inference-heavy blanket rule; if users feed high-cardinality IDs there, this may backfire rather than help
        (observability/clickhouse-design/shared.md:209).
      
      - arrayJoin/map-key discovery without time bounds will get expensive fast.
      - 
      - lightweight deletes plus read-after-delete tests will be flaky unless the tests explicitly account for eventual consistency (observability/
        clickhouse-design/shared.md:231).

  Bottom line: this is not ready to implement as written. I would not start stores/clickhouse/src/storage/domains/observability/v-next/ until the span
  primary-key strategy, metadata-search semantics, and score/feedback write contract are resolved.
