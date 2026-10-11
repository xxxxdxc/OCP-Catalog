"""Conformance checks for the minimal Python OCP Catalog Node.

Runs the WSGI-free stdlib server in a background thread and asserts every
endpoint returns the required OCP shapes. This mirrors the TypeScript example's
schema test; here we assert the required keys structurally (no OCP pip package
exists yet).

    python conformance_test.py
"""
from __future__ import annotations

import json
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer

import server

REQUIRED = {
    "manifest": {"ocp_version", "kind", "id", "catalog_id", "catalog_name", "endpoints", "query_capabilities", "object_contracts"},
    "health": {"ocp_version", "kind", "catalog_id", "status", "ready", "checked_at"},
    "query": {"ocp_version", "kind", "id", "catalog_id", "query", "result_count", "page", "entries"},
    "resolve": {"ocp_version", "kind", "id", "catalog_id", "entry_id", "commercial_object_id", "object_id", "object_type", "provider_id", "title", "visible_attributes", "action_bindings", "freshness", "expires_at"},
}


def _get(port: int, path: str):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}") as resp:
        return resp.status, json.loads(resp.read().decode())


def _post(port: int, path: str, body: dict):
    return _post_raw(port, path, json.dumps(body).encode())


def _post_raw(port: int, path: str, data: bytes):
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", data=data, headers={"content-type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        with exc:
            return exc.code, json.loads(exc.read().decode())


class ConformanceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.httpd.shutdown()
        cls.thread.join()
        cls.httpd.server_close()

    def test_manifest(self) -> None:
        status, body = _get(self.port, "/ocp/manifest")
        self.assertEqual(status, 200)
        self.assertLessEqual(REQUIRED["manifest"], set(body))
        self.assertEqual(body["object_contracts"], [])
        self.assertTrue(body["query_capabilities"])

    def test_health(self) -> None:
        status, body = _get(self.port, "/ocp/health")
        self.assertEqual(status, 200)
        self.assertLessEqual(REQUIRED["health"], set(body))
        self.assertTrue(body["ready"])

    def test_discovery(self) -> None:
        status, body = _get(self.port, "/.well-known/ocp-catalog")
        self.assertEqual(status, 200)
        self.assertIn("/ocp/query", body["query_url"])

    def test_query_keyword(self) -> None:
        status, body = _post(self.port, "/ocp/query", {"query": "headphones"})
        self.assertEqual(status, 200)
        self.assertLessEqual(REQUIRED["query"], set(body))
        self.assertEqual(body["result_count"], 1)
        self.assertEqual(body["page"]["offset"], 0)
        self.assertIn("Headphones", body["entries"][0]["entry"]["title"])

    def test_query_empty_returns_all(self) -> None:
        _, body = _post(self.port, "/ocp/query", {})
        self.assertEqual(body["result_count"], 3)

    def test_resolve(self) -> None:
        status, body = _post(self.port, "/ocp/resolve", {"entry_id": "entry_example_inmemory_sku-001"})
        self.assertEqual(status, 200)
        self.assertLessEqual(REQUIRED["resolve"], set(body))
        self.assertEqual(body["action_bindings"][0]["action_type"], "url")

    def test_get_routes_with_query_string(self) -> None:
        routes = (
            ("/.well-known/ocp-catalog", "WellKnownCatalogDiscovery"),
            ("/ocp/manifest", "CatalogManifest"),
            ("/ocp/health", "CatalogHealth"),
            ("/ocp/contracts", "ObjectContractList"),
        )
        for path, kind in routes:
            with self.subTest(path=path):
                status, body = _get(self.port, f"{path}?trace=example")
                self.assertEqual(status, 200)
                self.assertEqual(body["kind"], kind)

    def test_post_routes_with_query_string(self) -> None:
        routes = (
            ("/ocp/query", {"query": "headphones"}, "CatalogQueryResult"),
            ("/ocp/resolve", {"entry_id": "entry_example_inmemory_sku-001"}, "ResolvableReference"),
        )
        for path, payload, kind in routes:
            with self.subTest(path=path):
                status, body = _post(self.port, f"{path}?trace=example", payload)
                self.assertEqual(status, 200)
                self.assertEqual(body["kind"], kind)

    def test_query_rejects_invalid_limits(self) -> None:
        for value in ("abc", "5", 1.5, 0, -1, 51, True, False, None, [], {}):
            with self.subTest(limit=value):
                status, body = _post(self.port, "/ocp/query", {"limit": value})
                self.assertEqual(status, 400)
                self.assertEqual(body["error"]["code"], "invalid_request")
                self.assertEqual(body["error"]["field"], "limit")
                self.assertTrue(body["error"]["message"])

    def test_query_rejects_invalid_queries(self) -> None:
        for value in (123, True, None, [], {}):
            with self.subTest(query=value):
                status, body = _post(self.port, "/ocp/query", {"query": value})
                self.assertEqual(status, 400)
                self.assertEqual(body["error"]["field"], "query")

    def test_query_rejects_invalid_json_bodies(self) -> None:
        for data in (b"{", b"[]", b"null", b"123", b'"headphones"', b"\xff"):
            with self.subTest(data=data):
                status, body = _post_raw(self.port, "/ocp/query", data)
                self.assertEqual(status, 400)
                self.assertEqual(body["error"]["code"], "invalid_request")
                self.assertEqual(body["error"]["field"], "body")
                self.assertTrue(body["error"]["message"])

    def test_query_limits_and_defaults(self) -> None:
        for limit in (1, 50):
            with self.subTest(limit=limit):
                status, body = _post(self.port, "/ocp/query", {"limit": limit})
                self.assertEqual(status, 200)
                self.assertEqual(body["page"]["limit"], limit)
                self.assertEqual(body["result_count"], min(limit, 3))
        for payload in ({}, {"query": ""}, {"query": "headphones"}):
            with self.subTest(payload=payload):
                status, body = _post(self.port, "/ocp/query", payload)
                self.assertEqual(status, 200)
                self.assertEqual(body["page"]["limit"], 20)
                self.assertEqual(body["query"], payload.get("query", ""))
        status, body = _post(self.port, "/ocp/query", {"query": "headphones", "limit": 1})
        self.assertEqual(status, 200)
        self.assertEqual(body["result_count"], 1)
        # An invalid request must not prevent the next valid request from succeeding.
        status, _ = _post(self.port, "/ocp/query", {"limit": 0})
        self.assertEqual(status, 400)
        status, _ = _post(self.port, "/ocp/query", {})
        self.assertEqual(status, 200)

    def test_resolve_unknown_404(self) -> None:
        status, _ = _post(self.port, "/ocp/resolve", {"entry_id": "entry_example_inmemory_nope"})
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
