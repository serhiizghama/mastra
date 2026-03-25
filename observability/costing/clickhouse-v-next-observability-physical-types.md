# ClickHouse vNext Observability Physical Types

## Status

Working physical type and nullability matrix for ClickHouse `v-next`.

## Purpose

Define the concrete ClickHouse column types and nullability direction for the `v-next` observability tables so DDL work is mechanical rather than inferred during implementation.

## Shared Conventions

Current v0 direction:

- event and span timestamps should use `DateTime64(3, 'UTC')`
- required textual identifiers should use `String`
- nullable textual identifiers should use `Nullable(String)` unless they are explicitly marked as `LowCardinality` candidates
- nullable low-cardinality textual dimensions should use `LowCardinality(Nullable(String))`
- required low-cardinality textual dimensions should use `LowCardinality(String)`
- boolean fields should use `Bool`
- numeric measurements should use `Float64`
- serialized JSON payloads should use `Nullable(String)`
- do not add physical `createdAt` or `updatedAt` columns to `v-next` append-only tables
- `tags` should use `Array(LowCardinality(String)) DEFAULT []`
- `labels` should use `Map(LowCardinality(String), String) DEFAULT {}`
- `metadataSearch` should use `Map(LowCardinality(String), String) DEFAULT {}`

Important note:

- any column described as a serialized JSON payload should store the JSON-encoded representation of the logical value
- this rule applies even when the logical value is a scalar such as a string, number, boolean, or `null`

## `span_events`

- `traceId`: `String`
- `spanId`: `String`
- `parentSpanId`: `Nullable(String)`
- `experimentId`: `Nullable(String)`
- `entityType`: `LowCardinality(Nullable(String))`
- `entityId`: `LowCardinality(Nullable(String))`
- `entityName`: `LowCardinality(Nullable(String))`
- `userId`: `Nullable(String)`
- `organizationId`: `Nullable(String)`
- `resourceId`: `Nullable(String)`
- `runId`: `Nullable(String)`
- `sessionId`: `Nullable(String)`
- `threadId`: `Nullable(String)`
- `requestId`: `Nullable(String)`
- `environment`: `LowCardinality(Nullable(String))`
- `source`: `LowCardinality(Nullable(String))`
- `serviceName`: `LowCardinality(Nullable(String))`
- `requestContext`: `Nullable(String)`
- `spanName`: `String`
- `spanType`: `LowCardinality(String)`
- `isEvent`: `Bool`
- `status`: `LowCardinality(String)`
- `startedAt`: `DateTime64(3, 'UTC')`
- `endedAt`: `DateTime64(3, 'UTC')`
- `metadataSearch`: `Map(LowCardinality(String), String) DEFAULT {}`
- `tags`: `Array(LowCardinality(String)) DEFAULT []`
- `attributes`: `Nullable(String)`
- `scope`: `Nullable(String)`
- `links`: `Nullable(String)`
- `input`: `Nullable(String)`
- `output`: `Nullable(String)`
- `error`: `Nullable(String)`
- `metadataRaw`: `Nullable(String)`

Read-path notes:

- returned span `metadata` should be reconstructed from `metadataRaw`
- returned span `createdAt` should be populated as `startedAt`
- returned span `updatedAt` should be `null` in v0

## `metric_events`

- `timestamp`: `DateTime64(3, 'UTC')`
- `metricName`: `LowCardinality(String)`
- `traceId`: `Nullable(String)`
- `spanId`: `Nullable(String)`
- `experimentId`: `Nullable(String)`
- `entityType`: `LowCardinality(Nullable(String))`
- `entityId`: `LowCardinality(Nullable(String))`
- `entityName`: `LowCardinality(Nullable(String))`
- `parentEntityType`: `LowCardinality(Nullable(String))`
- `parentEntityId`: `LowCardinality(Nullable(String))`
- `parentEntityName`: `LowCardinality(Nullable(String))`
- `rootEntityType`: `LowCardinality(Nullable(String))`
- `rootEntityId`: `LowCardinality(Nullable(String))`
- `rootEntityName`: `LowCardinality(Nullable(String))`
- `userId`: `Nullable(String)`
- `organizationId`: `Nullable(String)`
- `resourceId`: `Nullable(String)`
- `runId`: `Nullable(String)`
- `sessionId`: `Nullable(String)`
- `threadId`: `Nullable(String)`
- `requestId`: `Nullable(String)`
- `environment`: `LowCardinality(Nullable(String))`
- `source`: `LowCardinality(Nullable(String))`
- `serviceName`: `LowCardinality(Nullable(String))`
- `provider`: `LowCardinality(Nullable(String))`
- `model`: `LowCardinality(Nullable(String))`
- `value`: `Float64`
- `estimatedCost`: `Nullable(Float64)`
- `costUnit`: `LowCardinality(Nullable(String))`
- `tags`: `Array(LowCardinality(String)) DEFAULT []`
- `labels`: `Map(LowCardinality(String), String) DEFAULT {}`
- `costMetadata`: `Nullable(String)`
- `metadata`: `Nullable(String)`
- `scope`: `Nullable(String)`

## `log_events`

- `timestamp`: `DateTime64(3, 'UTC')`
- `level`: `LowCardinality(String)`
- `message`: `String`
- `data`: `Nullable(String)`
- `traceId`: `Nullable(String)`
- `spanId`: `Nullable(String)`
- `experimentId`: `Nullable(String)`
- `entityType`: `LowCardinality(Nullable(String))`
- `entityId`: `LowCardinality(Nullable(String))`
- `entityName`: `LowCardinality(Nullable(String))`
- `parentEntityType`: `LowCardinality(Nullable(String))`
- `parentEntityId`: `LowCardinality(Nullable(String))`
- `parentEntityName`: `LowCardinality(Nullable(String))`
- `rootEntityType`: `LowCardinality(Nullable(String))`
- `rootEntityId`: `LowCardinality(Nullable(String))`
- `rootEntityName`: `LowCardinality(Nullable(String))`
- `userId`: `Nullable(String)`
- `organizationId`: `Nullable(String)`
- `resourceId`: `Nullable(String)`
- `runId`: `Nullable(String)`
- `sessionId`: `Nullable(String)`
- `threadId`: `Nullable(String)`
- `requestId`: `Nullable(String)`
- `environment`: `LowCardinality(Nullable(String))`
- `source`: `LowCardinality(Nullable(String))`
- `serviceName`: `LowCardinality(Nullable(String))`
- `tags`: `Array(LowCardinality(String)) DEFAULT []`
- `metadata`: `Nullable(String)`
- `scope`: `Nullable(String)`

## `score_events`

- `timestamp`: `DateTime64(3, 'UTC')`
- `traceId`: `String`
- `spanId`: `Nullable(String)`
- `experimentId`: `Nullable(String)`
- `scoreTraceId`: `Nullable(String)`
- `entityType`: `LowCardinality(Nullable(String))`
- `entityId`: `LowCardinality(Nullable(String))`
- `entityName`: `LowCardinality(Nullable(String))`
- `userId`: `Nullable(String)`
- `organizationId`: `Nullable(String)`
- `environment`: `LowCardinality(Nullable(String))`
- `serviceName`: `LowCardinality(Nullable(String))`
- `scorerId`: `LowCardinality(String)`
- `scorerVersion`: `LowCardinality(Nullable(String))`
- `scoreSource`: `LowCardinality(Nullable(String))`
- `score`: `Float64`
- `reason`: `Nullable(String)`
- `metadata`: `Nullable(String)`

## `feedback_events`

- `timestamp`: `DateTime64(3, 'UTC')`
- `traceId`: `String`
- `spanId`: `Nullable(String)`
- `experimentId`: `Nullable(String)`
- `userId`: `Nullable(String)`
- `sourceId`: `Nullable(String)`
- `entityType`: `LowCardinality(Nullable(String))`
- `entityId`: `LowCardinality(Nullable(String))`
- `entityName`: `LowCardinality(Nullable(String))`
- `organizationId`: `Nullable(String)`
- `environment`: `LowCardinality(Nullable(String))`
- `serviceName`: `LowCardinality(Nullable(String))`
- `feedbackSource`: `LowCardinality(String)`
- `feedbackType`: `LowCardinality(String)`
- `value`: `String`
- `comment`: `Nullable(String)`
- `metadata`: `Nullable(String)`

Important note:

- `feedback.value` is `number | string` in the public API but should not be queryable in v0
- current v0 direction is to store the JSON-encoded representation in `String` so read-time decoding preserves `number` vs `string`
- if stronger type fidelity becomes important later, `feedback.value` should be redesigned explicitly rather than inferred during implementation
