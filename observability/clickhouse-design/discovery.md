# ClickHouse vNext Observability Discovery Design

## Status

Working discovery design for the ClickHouse `v-next` observability domain.

## Purpose

Define the discovery endpoints, table coverage, and query behavior for ClickHouse `v-next`.

## v0 Direction

- discovery should operate directly on the base tables
- do not add helper views or materialized views in v0
- do not add discovery over JSON payloads in v0
- do not force scores or feedback into cross-signal discovery just for symmetry

## Public Discovery API

Current storage API discovery endpoints are:

- `getEntityTypes`
- `getEntityNames`
- `getServiceNames`
- `getEnvironments`
- `getTags`
- `getMetricNames`
- `getMetricLabelKeys`
- `getMetricLabelValues`

Current API argument surface:

- `getEntityTypes()`
- `getEntityNames({ entityType? })`
- `getServiceNames()`
- `getEnvironments()`
- `getTags({ entityType? })`
- `getMetricNames({ prefix?, limit? })`
- `getMetricLabelKeys({ metricName })`
- `getMetricLabelValues({ metricName, labelKey, prefix?, limit? })`

## Cross-Signal Discovery

Cross-signal discovery should operate only over the tables that actually carry those fields in v0:

- `span_events`
- `metric_events`
- `log_events`

### Entity discovery

Current v0 direction:

- `getEntityTypes` should union distinct `entityType` values from `span_events`, `metric_events`, and `log_events`
- `getEntityNames` should union distinct `entityName` values from the same three tables
- when `entityType` is provided to `getEntityNames`, it should filter each contributing table before the union

### Service/environment discovery

Current v0 direction:

- `getServiceNames` should union distinct `serviceName` values from `span_events`, `metric_events`, and `log_events`
- `getEnvironments` should union distinct `environment` values from `span_events`, `metric_events`, and `log_events`

### Tag discovery

Current v0 direction:

- `getTags` should union distinct tags from `span_events`, `metric_events`, and `log_events`
- for `span_events`, tags should be read from root spans only
- when `entityType` is provided to `getTags`, it should filter the contributing rows before unnesting tags

## Metric Discovery

Metric-specific discovery should operate only on `metric_events`.

Current v0 direction:

- `getMetricNames` should return distinct metric names from `metric_events.metricName`
- `prefix` should apply as a name prefix filter before distinct/ordering
- `limit` should apply after ordering
- `getMetricLabelKeys` should return distinct keys from `metric_events.labels` for the requested metric name
- `getMetricLabelValues` should return distinct values for the requested label key from the requested metric name
- `prefix` on `getMetricLabelValues` should apply before distinct/ordering
- `limit` on `getMetricLabelValues` should apply after ordering

## Explicit Non-Goals

Current v0 direction:

- no discovery over `metadata`
- no discovery over `scope`
- no discovery over `costMetadata`
- no discovery over log `data`
- no discovery over span `metadataRaw`
- no discovery over scores or feedback

## Operational Note

The current discovery API does not expose time-range filters for these endpoints. Inference: v0 discovery queries may require broad scans of the base tables, especially for tags and label discovery. That is acceptable for v0, but should not be hidden by the design.
