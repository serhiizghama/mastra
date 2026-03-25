---
  Design Review: ClickHouse v-Next Observability

  Findings (ordered by severity)

  CRITICAL

  1. ORDER BY (name, timestamp) / PRIMARY KEY (name, timestamp) cannot apply to all five tables

  The "ClickHouse v0 Physical Direction" section (lines 406-419) specifies a single physical layout for the whole domain:

  ENGINE = MergeTree
  PARTITION BY toDate(timestamp)
  PRIMARY KEY (name, timestamp)
  ORDER BY (name, timestamp)

  This makes sense for metric_events, where name is the metric name and almost every query filters on it. It does not make sense for:

  - span_events — the dominant access pattern is by traceId (get a trace, get a span, list traces). name is just a span name, not a primary query
  dimension. With ORDER BY (name, timestamp), getTrace(traceId) will scan the entire partition. This will be unacceptably slow even at moderate scale.
  - score_events — has no name column at all.
  - feedback_events — has no name column at all.
  - log_events — name is not present; the dominant query dimension is likely traceId or time + level.

  This is the single highest-risk item. A wrong ORDER BY in ClickHouse is not a minor tuning issue — it's the difference between queries that touch a few
  granules and queries that scan the whole table. The design needs per-table ORDER BY guidance, not a single global rule.

  Recommendation: Define ORDER BY per table. For span_events, something like (traceId, spanId) is likely correct. For score_events and feedback_events,
  (traceId, timestamp) or similar. The current single directive will cause the implementer to either apply it blindly (bad performance) or guess
  (inconsistency).

  ---
  2. span_events is missing parent/root entity hierarchy

  The span_events logical shape (lines 196-200) includes only:
  entityType, entityId, entityName

  But metric_events (lines 114-124) and log_events (lines 286-297) both include the full 9-field entity hierarchy:
  entityType, entityId, entityName
  parentEntityType, parentEntityId, parentEntityName
  rootEntityType, rootEntityId, rootEntityName

  The score_events table (lines 334-367) is missing the entity hierarchy entirely — no entity fields at all. Same for feedback_events (lines 369-402).

  This creates an inconsistency across the five tables. Discovery endpoints like getEntityTypes and getEntityNames query span_events in the DuckDB
  implementation (stores/duckdb/src/storage/domains/observability/discovery.ts). If span_events lacks the parent/root hierarchy, cross-signal entity
  queries won't be consistent.

  For scores and feedback, the absence of entity hierarchy means you can't filter or discover scores/feedback by entity — which seems like a real product
  gap.

  Inference: I believe the span_events entity shape intentionally follows the DuckDB span_events DDL (which also only has entityType/entityId/entityName —
  see ddl.ts:28-30). But the design doc's own principle says all five tables should "follow the same overall design discipline as metric_events" (line
  159). This is contradictory.

  Recommendation: Either explicitly call out the entity-hierarchy difference as intentional and explain why, or add the full hierarchy to
  span_events/scores/feedback for consistency.

  ---
  HIGH

  3. status column is missing from the design

  The costing design (metrics-costing-design.md:786) lists status as a hot-path dashboard column. The costing review (metrics-costing-design-review.md:482)
   also calls it a fast dashboard dimension. But the v-next design doc doesn't include status on any table.

  The DuckDB DDL also doesn't have status. The existing ClickHouse observability implementation derives status from error and endedAt at query time (see
  index.ts:569-584).

  This needs resolution: Is status a stored column or a derived query-time concept? If derived, the design should say so. If stored, it should appear in
  the logical shape.

  ---
  4. span_events has eventType column but only stores ended spans — contradicts itself

  The design says (lines 177-181):
  ▎ persist only completed spans / do not persist started-span rows / each stored span row should represent the final ended span state

  But the logical shape still includes eventType (line 185). If you're only storing ended spans, eventType is always the same value. It's a useless column
  that wastes storage and confuses implementers.

  The DuckDB implementation stores both start and end events and uses eventType for event-sourced reconstruction via arg_max(..., timestamp) FILTER (WHERE
  eventType = 'start') (see tracing.ts:66-103). The ClickHouse design explicitly abandons that model. So eventType is a leftover from the DuckDB pattern
  that wasn't cleaned from the design.

  Recommendation: Remove eventType from the ClickHouse span_events schema, or explain what value it would have in an ended-spans-only model.

  ---
  5. batchDeleteTraces on append-only ClickHouse tables is unaddressed

  The ObservabilityStorage base class requires batchDeleteTraces. The DuckDB implementation does DELETE FROM span_events WHERE traceId IN (...) (see
  tracing.ts:342-346). The existing ClickHouse implementation also does a DELETE FROM (see index.ts:774-792).

  But ClickHouse's DELETE FROM on MergeTree is a lightweight delete (mutation), which is:
  - Asynchronous
  - Potentially slow on large datasets
  - Not immediately visible without FINAL or SELECT ... WHERE NOT _row_exists

  The design says "append-only event tables" (line 77) but doesn't address how deletes work on append-only ClickHouse tables. This is an implementation
  trap — the developer will discover the async delete semantics at test time and need to decide on a strategy.

  Recommendation: Acknowledge that batchDeleteTraces will use ClickHouse lightweight deletes, and document the expected behavioral differences (eventual
  consistency of deletes).

  ---
  6. The observabilityStrategy getter name is wrong in the current ClickHouse implementation

  The existing ClickHouse implementation (index.ts:188-199) uses tracingStrategy, which is the deprecated name. The base class shows tracingStrategy
  delegates to observabilityStrategy (base.ts:91-95). The DuckDB implementation uses observabilityStrategy (see index.ts:95-103).

  The design doc says the v-next should return preferred: 'event-sourced' from the strategy getter. But the existing ClickHouse implementation returns
  preferred: 'insert-only' from tracingStrategy.

  This is actually the most important architectural question the design glosses over: The DuckDB implementation is event-sourced (stores start + end
  events, reconstructs). The ClickHouse v-next stores only ended spans. That's closer to insert-only than event-sourced. But the design says event-sourced.

  What does "event-sourced" mean here if you're only storing the final state? It's not event-sourced in the traditional sense — it's "store the final
  snapshot." The strategy value matters because DefaultExporter uses it to decide how to flush (see default.ts:41-61). An event-sourced strategy tells the
  exporter to emit both start and end events. But the design says ClickHouse should only store ended spans. So either the exporter will send data that gets
   dropped, or the ClickHouse domain needs to handle and discard start events.

  Recommendation: Clarify the strategy value and how the exporter/storage interaction works for ended-spans-only. This is not a name bikeshed — it affects
  the actual write path behavior.

  ---
  MEDIUM

  7. labels appears on metric_events but not on log_events, score_events, or feedback_events

  The design says labels uses Map(LowCardinality(String), String) on metric_events. But log_events, score_events, and feedback_events don't have labels.
  Only tags appears on log_events, and neither tags nor labels appears on scores or feedback.

  This is consistent with the DuckDB DDL. But the design's section "Semi-Structured Field Direction" (lines 426-505) discusses labels and tags as shared
  concerns across the domain, which implies they could appear on multiple tables. The inconsistency between the generic guidance and the per-table shapes
  could confuse an implementer.

  ---
  8. metadata on span_events has a split personality that will be tricky to implement

  The design proposes:
  - metadata as a searchable Map(LowCardinality(String), String) (like labels)
  - metadataRaw as a serialized JSON blob for faithful reconstruction

  With logic to:
  - Strip promoted fields (userId, organizationId, etc.) from the searchable map before insert (lines 252-264)
  - Only the searchable map participates in filtering

  This is reasonable but under-specified:
  - What happens when a metadata value is not a string? The Map type only holds strings. Do you stringify nested objects? Drop them? The DuckDB metadata is
   JSON — it can hold anything.
  - How does the filter layer know to query metadata as a Map on span_events but as JSON on other tables? The filter helpers will need per-table type
  awareness.
  - The buildCreateSpanRecord function (record-builders.ts:164-212) passes span.metadata as-is. It doesn't strip promoted fields. That stripping logic
  would need to live in the ClickHouse storage domain write path, not in the shared record builder. The design should say this explicitly.

  ---
  9. LowCardinality on entityId is questionable

  The design lists all 9 entity hierarchy fields as LowCardinality candidates (lines 509-520), including entityId, parentEntityId, and rootEntityId. The
  reasoning (lines 529-530) says "entity hierarchy fields are product identifiers but behave more like names than unbounded UUID-style ids."

  This is risky. Entity IDs in the Mastra codebase are things like agent names, tool names, workflow names — yes, these repeat. But if a deployment has
  many agents or tools, or if entity IDs become more dynamic in the future, LowCardinality can degrade. ClickHouse documentation warns that LowCardinality
  works best under ~10,000 unique values.

  This probably won't break anything — ClickHouse falls back gracefully — but it's worth noting that entityId is the weakest LowCardinality candidate in
  the list. If entity IDs ever become UUIDs or similar high-cardinality values, the dictionary overhead will be a net negative.

  ---
  10. feedback_events.value as LowCardinality is dubious

  Line 400 says value is a "good LowCardinality candidate" for feedback_events. But value in the DuckDB DDL is VARCHAR NOT NULL — it could be anything the
  user sends. If feedback values are things like "good"/"bad"/"neutral", LowCardinality is fine. If they're freeform text or numeric strings, it's not. The
   design doesn't constrain what value contains.

  ---
  11. No data column on log_events in the design

  The DuckDB log_events DDL has a data JSON column (see ddl.ts:151). The design's log_events logical shape (lines 316-320) lists data under
  "Information-only semi-structured fields." This is fine and consistent — just flagging that the design should be explicit that data is a JSON blob stored
   as String in ClickHouse, since it's easy to miss among all the other fields.

  ---
  LOW / NITS

  12. No sourceId on feedback_events in DuckDB DDL but it's in the design

  Actually, the DuckDB DDL does have sourceId (line 191 of ddl.ts). This is consistent. False alarm — ignore this.

  13. dangerouslyClearAll on ClickHouse needs TRUNCATE TABLE semantics

  ClickHouse supports TRUNCATE TABLE and it's instant. The DuckDB implementation uses TRUNCATE TABLE too. The design doesn't mention this but it's
  straightforward to implement. Just noting it's not called out.

  14. Percentile queries in ClickHouse

  DuckDB uses percentile_cont(p) WITHIN GROUP (ORDER BY value). ClickHouse uses quantile(p)(value) or quantileExact(p)(value). The design doesn't mention
  this SQL dialect difference. It's obvious to anyone who knows both databases, but since the design says "use DuckDB as the logical reference," an
  implementer who copies the DuckDB SQL literally will get syntax errors.

  ---
  Structural / Doc Quality Issues

  A. The "ClickHouse v0 Physical Direction" section tries to be global but only works for metrics

  This is finding #1 restated as a doc-structure problem. The section should either be explicitly scoped to metric_events or broken into per-table physical
   guidance.

  B. The design is too long for what it actually decides

  The doc is ~600 lines and makes roughly 10-15 concrete decisions. The rest is context-setting and repeating principles from the costing design doc and
  its review. For example, the "Storage Strategy" section (lines 72-84) is 12 lines to say "use event-sourced." The "Additional ClickHouse Structures"
  section (lines 560-569) is 10 lines to say "don't add indexes yet."

  This isn't just aesthetic — longer docs increase the chance that implementers miss the actual decisions buried in the narrative. A more compact format
  (decision table + notes) would be more actionable.

  C. The normalization rules for labels and tags (lines 484-505) should be shared code, not just prose

  These rules apply across DuckDB and ClickHouse. They should probably be implemented once in the shared record-builder layer (record-builders.ts) rather
  than re-implemented per storage backend. The design doesn't say where this normalization lives.

  D. The "Immediate Next Steps" section is realistic but under-ordered

  Step 2 says "write DDL for all five tables" and step 3 says "implement the write path for all five signals." But finding #1 means the DDL can't be
  written correctly until the per-table ORDER BY question is resolved. Step 1 (scaffold) is fine. Steps 2-3 should be blocked on resolving the physical
  layout per table.

  ---
  Things That Should Probably Be Split Out

  1. The span_events.metadata searchable-map design (lines 245-270) is complex enough to warrant its own design spike or mini-doc. The interaction between
  metadata stripping, Map type choice, filter behavior, and metadataRaw preservation has enough surface area to trip up implementation.
  2. Per-table ORDER BY / PRIMARY KEY strategy — this deserves its own focused section or mini-doc, since it's the single highest-leverage ClickHouse
  design decision and the current doc punts on it while appearing not to.

  ---
  ClickHouse Implementation Traps to Watch For

  1. Map column type and NULL values: ClickHouse Map(K, V) doesn't support NULL values within the map. If label values are nullable upstream, inserts will
  fail silently or error depending on settings.
  2. Array(LowCardinality(String)) for tags: Works well but be aware that has() on Array columns doesn't use indexes. Tag filtering will always be a scan
  within the partition/granule. This is probably fine for v0 but worth knowing.
  3. toDate(timestamp) partitioning with DateTime64: If timestamp is DateTime64(3), the partition expression toDate(timestamp) works but make sure the
  timezone handling is explicit. ClickHouse DateTime64 without a timezone uses server timezone, which can cause partition-boundary surprises across
  different environments.
  4. TRUNCATE TABLE requires specific grants in ClickHouse Cloud: Unlike self-hosted, ClickHouse Cloud may require explicit permissions for TRUNCATE. The
  dangerouslyClearAll method may need a fallback or clear error message.
  5. Batch inserts with the @clickhouse/client: The existing ClickHouse implementation uses client.insert() with JSONEachRow format. For the v-next, batch
  inserts across all 5 tables should be concurrent (one insert per table), not sequential. The DuckDB implementation does sequential DDL init but
  concurrent writes would be important at scale.

  ---
  Summary

  The design is a solid directional document but has one critical gap (per-table ORDER BY), one significant inconsistency (observabilityStrategy vs.
  ended-spans-only semantics), and several medium-severity under-specifications that will cause implementation churn if not resolved upfront. The strongest
   parts are the semi-structured field treatment and the normalization rules. The weakest part is that the ClickHouse-specific physical design section is
  actually only valid for one of the five tables.

  I'd resolve findings #1, #4, and #6 before anyone starts writing DDL.