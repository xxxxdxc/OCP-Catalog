# Minimal OCP Catalog Node — Python

The smallest spec-valid [OCP Catalog Node](../../docs/specs), serving three
hardcoded in-memory products. Standard library only — no framework, no
third-party dependencies. Requires Python 3.9+.

## Run

```bash
python server.py        # listens on http://localhost:4401
```

Then:

```bash
curl http://localhost:4401/ocp/manifest
curl http://localhost:4401/ocp/health
curl -X POST http://localhost:4401/ocp/query   -H 'content-type: application/json' -d '{"query":"headphones"}'
curl -X POST http://localhost:4401/ocp/resolve -H 'content-type: application/json' -d '{"entry_id":"entry_example_inmemory_sku-001"}'
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/.well-known/ocp-catalog` | discovery |
| GET | `/ocp/manifest` | capabilities + query packs |
| GET | `/ocp/health` | liveness |
| GET | `/ocp/contracts` | object contracts (empty — read-only node) |
| POST | `/ocp/query` | keyword search over products |
| POST | `/ocp/resolve` | resolve one entry into action bindings |

## Conformance

`conformance_test.py` starts the server and asserts every response carries the
required OCP fields (structural check — there is no OCP pip package yet; the
canonical schemas live in [`@ocp-catalog/ocp-schema`](https://www.npmjs.com/package/@ocp-catalog/ocp-schema)
and [`docs/specs`](../../docs/specs)):

```bash
python conformance_test.py
```

Configuration via env: `CATALOG_ID`, `CATALOG_NAME`, `PORT`, `PUBLIC_BASE_URL`.

## Query input validation

`POST /ocp/query` accepts a JSON object. Omitted `query` defaults to `""` and
omitted `limit` defaults to `20`; `{}` remains a valid query returning the
example products. If provided, `query` must be a string and `limit` must be an
integer from 1 through 50. Values are not coerced or clamped: strings, booleans,
fractional numbers, `null`, and out-of-range limits are rejected.

Malformed JSON, non-object JSON bodies, invalid UTF-8, and invalid `query` or
`limit` values return HTTP 400 with a JSON error identifying the field:

```json
{"error":{"code":"invalid_request","field":"limit","message":"limit must be an integer between 1 and 50."}}
```

This example validates these query inputs, not the complete OCP request schema.
