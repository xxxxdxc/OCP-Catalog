"""A minimal, spec-valid OCP Catalog Node in Python (standard library only).

Serves five endpoints from ~3 in-memory products, with no database, no vendor
client, and no third-party dependencies. It answers the OCP Catalog read
surface:

    GET  /.well-known/ocp-catalog   discovery
    GET  /ocp/manifest              capabilities
    GET  /ocp/health                liveness
    GET  /ocp/contracts             object contracts (empty -- read-only node)
    POST /ocp/query                 keyword search over products
    POST /ocp/resolve               resolve one entry into actions

Response shapes match @ocp-catalog/ocp-schema. Run `python conformance_test.py`
after starting the server to check them.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

CATALOG_ID = os.environ.get("CATALOG_ID", "cat_example_python")
CATALOG_NAME = os.environ.get("CATALOG_NAME", "Example Python Catalog")
PROVIDER_ID = "example_inmemory"
PORT = int(os.environ.get("PORT", "4401"))
BASE_URL = os.environ.get("PUBLIC_BASE_URL", f"http://localhost:{PORT}").rstrip("/")

PRODUCTS = [
    {
        "id": "sku-001",
        "title": "Aurora Wireless Headphones",
        "summary": "Over-ear Bluetooth headphones with active noise cancellation.",
        "brand": "Aurora",
        "category": "electronics",
        "currency": "USD",
        "amount": 199.0,
        "availability": "in_stock",
        "url": "https://example.com/products/aurora-headphones",
        "updated_at": "2026-07-01T00:00:00.000Z",
    },
    {
        "id": "sku-002",
        "title": "Trailhead Running Shoes",
        "summary": "Lightweight trail runners with a grippy all-terrain outsole.",
        "brand": "Trailhead",
        "category": "footwear",
        "currency": "USD",
        "amount": 129.0,
        "availability": "low_stock",
        "url": "https://example.com/products/trailhead-shoes",
        "updated_at": "2026-07-02T00:00:00.000Z",
    },
    {
        "id": "sku-003",
        "title": "Camp Kettle 1.5L",
        "summary": "Hard-anodized aluminium kettle for backcountry cooking.",
        "brand": "Basecamp",
        "category": "outdoors",
        "currency": "USD",
        "amount": 39.0,
        "availability": "in_stock",
        "url": "https://example.com/products/camp-kettle",
        "updated_at": "2026-07-03T00:00:00.000Z",
    },
]


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _entry_id(product: dict) -> str:
    return f"entry_{PROVIDER_ID}_{product['id']}"


def well_known_discovery() -> dict:
    return {
        "ocp_version": "1.0",
        "kind": "WellKnownCatalogDiscovery",
        "catalog_id": CATALOG_ID,
        "catalog_name": CATALOG_NAME,
        "manifest_url": f"{BASE_URL}/ocp/manifest",
        "health_url": f"{BASE_URL}/ocp/health",
        "query_url": f"{BASE_URL}/ocp/query",
        "resolve_url": f"{BASE_URL}/ocp/resolve",
        "contracts_url": f"{BASE_URL}/ocp/contracts",
    }


def manifest() -> dict:
    return {
        "ocp_version": "1.0",
        "kind": "CatalogManifest",
        "id": f"manifest_{CATALOG_ID}",
        "catalog_id": CATALOG_ID,
        "catalog_name": CATALOG_NAME,
        "description": "Minimal in-memory OCP Catalog Node example (Python).",
        "registry_visibility": "public",
        "endpoints": {
            "health": {"url": f"{BASE_URL}/ocp/health", "method": "GET"},
            "query": {"url": f"{BASE_URL}/ocp/query", "method": "POST"},
            "resolve": {"url": f"{BASE_URL}/ocp/resolve", "method": "POST"},
            "contracts": {"url": f"{BASE_URL}/ocp/contracts", "method": "GET"},
        },
        "query_capabilities": [
            {
                "capability_id": "ocp.example.product.search.v1",
                "name": "Keyword product search",
                "description": "Case-insensitive keyword match over the in-memory product list.",
                "query_packs": [
                    {
                        "pack_id": "ocp.query.keyword.v1",
                        "description": "Keyword search over title, summary, brand, and category.",
                        "query_modes": ["keyword"],
                    }
                ],
                "supports_explain": True,
                "supports_resolve": True,
            }
        ],
        # Required by the schema even for a read-only node that ingests nothing.
        "object_contracts": [],
    }


def health() -> dict:
    return {
        "ocp_version": "1.0",
        "kind": "CatalogHealth",
        "catalog_id": CATALOG_ID,
        "status": "healthy",
        "ready": True,
        "checked_at": _now(),
    }


def contracts() -> dict:
    return {
        "ocp_version": "1.0",
        "kind": "ObjectContractList",
        "catalog_id": CATALOG_ID,
        "object_contracts": [],
        "note": "Read-only example node; it does not accept provider object ingestion.",
    }


def _to_entry(product: dict) -> dict:
    return {
        "kind": "CatalogEntry",
        "catalog_id": CATALOG_ID,
        "entry_id": _entry_id(product),
        "provider_id": PROVIDER_ID,
        "object_id": product["id"],
        "object_type": "ocp.commerce.product",
        "title": product["title"],
        "summary": product["summary"],
        "attributes": {
            "brand": product["brand"],
            "category": product["category"],
            "price": {"currency": product["currency"], "amount": product["amount"]},
            "inventory": {"availability_status": product["availability"]},
            "product_url": product["url"],
        },
    }


def query(body: dict) -> dict:
    term = str(body.get("query", "") or "").strip().lower()
    limit = min(max(int(body.get("limit", 20) or 20), 1), 50)
    if term:
        matches = [
            p
            for p in PRODUCTS
            if any(term in str(p[f]).lower() for f in ("title", "summary", "brand", "category"))
        ]
    else:
        matches = list(PRODUCTS)
    page = matches[:limit]
    return {
        "ocp_version": "1.0",
        "kind": "CatalogQueryResult",
        "id": f"qry_{uuid.uuid4()}",
        "catalog_id": CATALOG_ID,
        "query_pack": "ocp.query.keyword.v1",
        "query_mode": "keyword",
        "query": body.get("query", "") or "",
        "result_count": len(page),
        "page": {"limit": limit, "offset": 0, "has_more": False},
        "entries": [
            {"entry": _to_entry(p), "score": 1, "explain": [f"Keyword match for \"{body.get('query', '')}\"."]}
            for p in page
        ],
    }


def resolve(body: dict):
    entry_id = body.get("entry_id")
    product = next((p for p in PRODUCTS if _entry_id(p) == entry_id), None)
    if product is None:
        return 404, {
            "error": {"code": "not_found", "message": f"Unknown entry_id: {entry_id or '(missing)'}"}
        }
    now = _now()
    expires = (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    return 200, {
        "ocp_version": "1.0",
        "kind": "ResolvableReference",
        "id": f"res_{uuid.uuid4()}",
        "catalog_id": CATALOG_ID,
        "entry_id": _entry_id(product),
        "commercial_object_id": f"co_{product['id']}",
        "object_id": product["id"],
        "object_type": "ocp.commerce.product",
        "provider_id": PROVIDER_ID,
        "title": product["title"],
        "visible_attributes": {
            "brand": product["brand"],
            "category": product["category"],
            "price": {"currency": product["currency"], "amount": product["amount"]},
            "availability": product["availability"],
        },
        "action_bindings": [
            {
                "action_id": "view",
                "action_type": "url",
                "label": "View product",
                "entrypoint": {"url": product["url"], "method": "GET"},
            }
        ],
        "freshness": {"object_updated_at": product["updated_at"], "resolved_at": now},
        "expires_at": expires,
    }


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: dict) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self) -> dict:
        length = int(self.headers.get("content-length", 0) or 0)
        if not length:
            return {}
        try:
            parsed = json.loads(self.rfile.read(length).decode("utf-8"))
            return parsed if isinstance(parsed, dict) else {}
        except (ValueError, UnicodeDecodeError):
            return {}

    def do_GET(self) -> None:  # noqa: N802 (http.server API)
        routes = {
            "/.well-known/ocp-catalog": well_known_discovery,
            "/ocp/manifest": manifest,
            "/ocp/health": health,
            "/ocp/contracts": contracts,
        }
        builder = routes.get(urlsplit(self.path).path)
        if builder is None:
            self._send(404, {"error": {"code": "not_found", "message": f"No route for GET {self.path}"}})
            return
        self._send(200, builder())

    def do_POST(self) -> None:  # noqa: N802 (http.server API)
        path = urlsplit(self.path).path
        if path == "/ocp/query":
            self._send(200, query(self._read_json()))
            return
        if path == "/ocp/resolve":
            status, payload = resolve(self._read_json())
            self._send(status, payload)
            return
        self._send(404, {"error": {"code": "not_found", "message": f"No route for POST {self.path}"}})

    def log_message(self, *_args) -> None:  # silence default request logging
        return


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Example Python OCP Catalog Node listening on {BASE_URL}")
    server.serve_forever()


if __name__ == "__main__":
    main()
