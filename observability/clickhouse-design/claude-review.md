  Design Review: ClickHouse v-next Observability

  Critical Findings

  1. event-sourced strategy choice contradicts the storage model

  Severity: High
  Files: shared.md:49-64, event-buffer.ts:79-122, default.ts:366-384

  The design specifies event-sourced exporter routing, but the storage model is ended-span-only. These are in tension.

  With event-sourced, the EventBuffer routes both SPAN_STARTED and SPAN_ENDED to the creates queue (event-buffer.ts:84-86, event-buffer.ts:111). The
  DefaultExporter then calls batchCreateSpans with buildCreateSpanRecord for all of them (default.ts:379-383). The v-next storage layer would receive two
  create records per span — one without endedAt, one with — and must discard the started-span records internally.

  With insert-only (what the current ClickHouse implementation already uses), the EventBuffer ignores SPAN_STARTED entirely (event-buffer.ts:81-88). Only
  SPAN_ENDED events reach batchCreateSpans. This is exactly what the design wants.

  The stated rationale in shared.md:42 — "ClickHouse can keep event-sourced exporter routing for all signals while still choosing a narrower storage model
  for span_events" — is true but costs:
  - 2x tracing write volume through the buffer (started + ended creates)
  - Storage-layer filtering logic that duplicates what the exporter already knows
  - The CreateSpanRecord passed to storage doesn't carry eventType, so the storage layer must infer "is this a started span?" from endedAt == null, which
  is fragile (what about event spans pre-normalization?)

  The design should either switch to insert-only or provide a concrete reason why event-sourced routing is needed when the storage model throws away half
  the data. The event-span normalization (endedAt = startedAt when isEvent && !endedAt) would need to happen before the persistence gate regardless.

  2. Score and feedback context field population is unresolved

  Severity: High — blocks implementation
  Files: score-events.md:84-86, feedback-events.md:89-91, record-builders.ts:288-321

  The design adds entityType, entityId, entityName, userId, organizationId, environment, serviceName to score_events, and similar columns to
  feedback_events. The design acknowledges this gap: "the score write path will need to propagate these fields from emitted score context or enclosing
  trace/span context during implementation."

  But buildScoreRecord (record-builders.ts:288-303) doesn't extract any of these fields. buildFeedbackRecord (record-builders.ts:306-321) only extracts
  userId from metadata. Neither ScoreEvent nor FeedbackEvent carries CorrelationContext — that's only available on metrics and logs.

  This isn't a "the record builder needs updating" problem. The event types themselves don't carry the data. Someone needs to decide:
  - Do score/feedback events get enriched with correlation context at emission time?
  - Does the exporter look up the enclosing trace?
  - Does the storage layer join against span_events?
  - Or do these columns stay null in v0?

  This should be resolved before implementation starts. The design adds typed columns that can't currently be populated, which means the filter surface for
   scores/feedback will silently return nothing for these fields.

  ---
  Significant Findings

  3. hasChildError subquery will be expensive without a secondary index

  Severity: Medium
  Files: span-events.md:189, physical-types.md:33-67

  The ORDER BY (endedAt, traceId) means the primary index is optimized for time-range scans. A hasChildError check is effectively EXISTS (SELECT 1 FROM
  span_events WHERE traceId = ? AND status = 'error'). Since traceId is the second key component, ClickHouse can't use the primary index efficiently for
  traceId-only lookups — it has to scan across time partitions.

  For listTraces with hasChildError, this becomes a correlated subquery executed for every root span in the result set. At scale, this is a table scan per
  page of results.

  Recommendation: Add INDEX idx_trace_id traceId TYPE bloom_filter GRANULARITY 1 to span_events DDL, or acknowledge this as a known v0 performance
  limitation with a plan for follow-up.

  4. getSpan and getTrace point lookups lack primary key support

  Severity: Medium
  Files: span-events.md:184, physical-types.md:57-58

  getSpan(traceId, spanId) and getTrace(traceId) are point lookups by traceId. With ORDER BY (endedAt, traceId), these queries can't efficiently use the
  primary index without constraining endedAt. They'll scan across all date partitions.

  Same mitigation as Finding 3: a bloom filter index on traceId would help. The existing ClickHouse implementation uses ReplacingMergeTree with a sort key
  that includes (traceId, spanId), so point lookups work there. The v-next design loses this.

  5. LowCardinality(Nullable(String)) performance penalty

  Severity: Medium
  Files: physical-types.md:18, all table type matrices

  ClickHouse documentation explicitly warns: "Using Nullable almost always negatively affects performance, keep this in mind when designing your
  databases." The combination LowCardinality(Nullable(String)) is used for ~15 columns across the tables (entityType, entityId, entityName, environment,
  source, serviceName, etc.).

  For columns where the distinction between null and empty string doesn't matter (which is most observability context fields), LowCardinality(String)
  DEFAULT '' avoids the Nullable overhead. The existing ClickHouse implementation already treats null and empty string as equivalent in many places (e.g.,
  index.ts:431: (parentSpanId IS NULL OR parentSpanId = '')).

  Recommendation: Use LowCardinality(String) DEFAULT '' for context columns where null vs empty string is not semantically meaningful. Reserve Nullable for
   columns where null has distinct meaning (like parentSpanId where null = root span).

  6. Cross-signal discovery queries are unbounded full-table scans

  Severity: Medium
  Files: discovery.md:44-71, discovery.md:98-100

  The design acknowledges this: "v0 discovery queries may require broad scans of the base tables." But the impact is understated for ClickHouse Cloud.
  getEntityTypes() unions across 3 tables with no time-range filter. Each table is partitioned by date. This reads ALL partitions of ALL 3 tables.

  On DuckDB (local, small data), this is fine. On ClickHouse Cloud (potentially months of data, billed by scan volume), this can be expensive and slow.

  Recommendation: At minimum, document this as a known cost/performance risk. Consider whether a default lookback window (e.g., last 7 days) would be
  acceptable for discovery endpoints even if the API doesn't currently expose time-range parameters.

  7. No TTL mentioned

  Severity: Medium
  Files: Not present in any design doc

  The existing ClickHouse implementation supports TTL (resolveClickhouseConfig in index.ts:39). The v-next design doesn't mention TTL at all. For
  observability data on ClickHouse Cloud, TTL is critical for cost management.

  Recommendation: Add TTL to the physical shape section of each table, even if it's just "TTL to be configured identically to current implementation."

  ---
  Minor Findings

  8. Column rename mapping is a consistent bug risk

  Severity: Low-Medium
  Files: shared.md:87-99

  The renames (name → spanName, name → metricName, source → feedbackSource/scoreSource) must be applied in DDL, write path, read path, filter building,
  discovery queries, and order-by clauses. The DuckDB implementation uses the public API names directly as column names and has no mapping layer.

  Every query touchpoint needs the mapping. A single omission causes a silent failure or ClickHouse error. This is a maintenance burden that buys you...
  slightly more self-documenting column names in ClickHouse.

  9. endedAt non-nullable requires careful event-span handling

  Severity: Low-Medium
  Files: physical-types.md:58, span-events.md:127-134

  endedAt: DateTime64(3, 'UTC') (NOT nullable). Event spans get endedAt = startedAt on write. On read, the design says to map back to endedAt = null for
  event spans (span-events.md:134). This round-trip normalization is documented but is a correctness trap — if any code path forgets the read-time
  denormalization, event spans will appear to have duration.

  10. feedback.value as JSON-encoded String

  Severity: Low
  Files: physical-types.md:181, feedback-events.md:67-68

  Storing value as String containing JSON means "hello" → "\"hello\"" and 42 → "42". This works but every read path must remember to JSON.parse the value,
  and every write path must JSON.stringify. If anyone writes a raw string to this column, reads will break silently.

  ---
  Document Structure Issues

  11. Redundancy across documents creates drift risk

  The same decisions appear in 3-4 places:
  - LowCardinality candidates: shared.md:196-210, physical-types.md, each per-table doc
  - Tags/labels types: shared.md:157-159, physical-types.md:24-26, each per-table doc
  - MergeTree engine choice: shared.md:59, each per-table doc

  Recommendation: physical-types.md should be the single source of truth for column types and nullability. Per-table docs should reference it, not
  duplicate it. Currently if you change the tags type in shared.md but not physical-types.md, you have a silent inconsistency.

  12. physical-types.md should become the DDL

  physical-types.md is essentially the DDL spec in markdown. Once v-next/ddl.ts is written, maintaining both is asking for drift. The markdown should be
  treated as a pre-implementation artifact that becomes the DDL file, not a permanent parallel document.

  13. Discovery doc + per-table filter surfaces could be consolidated

  The filter surface is documented in both the per-table docs and implicitly in the discovery doc. A single "query contract" reference per signal would be
  cleaner.

  ---
  What's Good

  - The ended-span-only storage decision is sound for ClickHouse. It avoids ReplacingMergeTree, FINAL queries, and read-time reconstruction.
  - The metadataRaw / metadataSearch split is well-thought-out.
  - Per-table physical design (vs shared ORDER BY) is the right call.
  - The normalization rules for tags/labels/metadataSearch are explicit and implementable.
  - The scope of v0 limitations is clearly stated.
  - Keeping v-next isolated from the current implementation avoids migration pressure during development.

  ---
  Summary of Must-Resolve-Before-Implementation

  1. Strategy choice: Switch to insert-only or justify event-sourced with a concrete benefit.
  2. Score/feedback context propagation: Decide where entity/context data comes from, or explicitly accept null columns in v0.
  3. traceId lookup performance: Decide on bloom filter index or accept slow point lookups.
  4. LowCardinality + Nullable: Make a deliberate choice about the performance tradeoff for ~15 columns.
