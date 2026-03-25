# Costing Next Steps

## Current State

The initial v0 runtime costing slice is now implemented.

Primary references:

- `observability/costing/metrics-costing-design.md`
- `observability/costing/metrics-costing-design-review.md`

Current implementation status:

- model token metrics can now carry:
  - `provider`
  - `model`
  - `estimatedCost`
  - `costUnit`
  - slim `costMetadata`
- the estimator lives in `observability/mastra/src/metrics/estimator.ts`
- the embedded snapshot lives in `observability/mastra/src/metrics/pricing-data.jsonl`
- auto-extracted model token metrics now attach row-local `costContext`
- storage/query code already supports `estimatedCost` alongside `value`

## v0 Guardrails

- Use the embedded pricing snapshot only
- Assume one pricing row per `provider + model`
- Avoid richer qualifiers like service tier, region, endpoint variant, or cache TTL
- Do not require ClickHouse-backed pricing lookup
- Do not require materialized views up front

## ClickHouse Notes To Preserve

- Production target is ClickHouse, but current ClickHouse code in the repo should not be used as a design reference
- Current v0 leaning:
  - partition by time for retention
  - simple `ORDER BY (name, timestamp)`
  - revisit using real query telemetry later

## Next Steps

- ClickHouse-specific implications beyond the initial v0 layout
