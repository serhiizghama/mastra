# ClickHouse vNext Metric Events Design

## Status

Working table design for `metric_events`.

## Purpose

Define the logical shape, physical shape, and query contract for ClickHouse `v-next` metrics storage and OLAP queries.

## Logical Shape

### Event metadata

- `timestamp`
- `metricName`

### Correlation and experiment ids

- `traceId`
- `spanId`
- `experimentId`

### Entity hierarchy

- `entityType`
- `entityId`
- `entityName`
- `parentEntityType`
- `parentEntityId`
- `parentEntityName`
- `rootEntityType`
- `rootEntityId`
- `rootEntityName`

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
- `provider`
- `model`

### Metric-specific scalars

- `value`
- `estimatedCost`
- `costUnit`

### Semi-structured fields

- `tags`
- `labels`
- `costMetadata`
- `metadata`
- `scope`

Important note:

- `metric_events` should not store a `status` column in v0
- metric emission does not know the final terminal status of the enclosing trace/span at write time

## Physical Shape

Current v0 direction:

- `ENGINE = MergeTree`
- `PARTITION BY toDate(timestamp)`
- `ORDER BY (metricName, timestamp)`

Additional notes:

- `metricName`, entity hierarchy fields, `environment`, `source`, `serviceName`, `provider`, and `model` are strong `LowCardinality` candidates
- `labels` should use `Map(LowCardinality(String), String)`
- `tags` should use `Array(LowCardinality(String))`

## Semi-Structured Policy

Current v0 direction:

- `labels` and `tags` remain query-relevant
- `costMetadata`, `metadata`, and `scope` remain information-only JSON payloads

## Query Contract

The ClickHouse `v-next` metrics implementation should support:

- `batchCreateMetrics`
- `listMetrics`
- `getMetricAggregate`
- `getMetricBreakdown`
- `getMetricTimeSeries`
- `getMetricPercentiles`
- metric discovery for names, label keys, and label values

For OLAP responses in v0:

- aggregate, breakdown, and time series return `value` plus optional `estimatedCost` and `costUnit`
- percentiles remain value-only

### Filter surface

Current public metrics filter schema includes:

- `timestamp`
- `traceId`
- `spanId`
- `entityType`
- `entityName`
- `userId`
- `organizationId`
- `experimentId`
- `serviceName`
- `environment`
- `parentEntityType`
- `parentEntityName`
- `rootEntityType`
- `rootEntityName`
- `resourceId`
- `runId`
- `sessionId`
- `threadId`
- `requestId`
- `source`
- `tags`
- `name`
- `provider`
- `model`
- `costUnit`
- `labels`

Current v0 direction:

- the ClickHouse metrics implementation should support that filter surface directly from typed columns plus `labels`/`tags`
- public metric filter field `name` should map to storage column `metricName`
- `metadata`, `costMetadata`, and `scope` are stored on the record but are not part of the current metrics filter schema

### `groupBy` semantics

Current v0 direction:

- if a `groupBy` key matches a typed metric column, group by that typed column
- otherwise, treat the key as a metric-label key and group by the value stored under `labels`
- `metadata`, `costMetadata`, and `scope` should not participate in `groupBy`

## Discovery Direction

Current v0 direction:

- discovery operates directly on `metric_events`
- do not add helper views in v0 unless implementation evidence justifies them

## Intentional v0 Limitations

- no stored `status`
- no grouping by `metadata`, `costMetadata`, or `scope`
- no query dependence on JSON extraction for label-aware grouping if it can be avoided
