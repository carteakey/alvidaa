#!/usr/bin/env python3
"""Static server for launcher/ + collector endpoint for TV-side file dumps.

The TV page reads files through the vendor bridge and POSTs the JSON here, so
nothing has to be photographed off the screen.

    POST /collect   -> writes tvcollect/collect-<timestamp>.json

Usage: python tools/tvcollect.py [port]   (default 8765)
"""
import json
import os
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
LAUNCHER = os.path.join(ROOT, "launcher")
OUTDIR = os.path.join(ROOT, "tvcollect")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
MAX_BODY = 8 * 1024 * 1024


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=LAUNCHER, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        if not self.path.startswith("/collect"):
            self.send_error(404, "not found")
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n <= 0 or n > MAX_BODY:
            self.send_error(400, "bad length")
            return
        body = self.rfile.read(n)
        os.makedirs(OUTDIR, exist_ok=True)
        stamp = time.strftime("%Y%m%d-%H%M%S")
        path = os.path.join(OUTDIR, f"collect-{stamp}.json")
        try:
            data = json.loads(body.decode("utf-8", "replace"))
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=1)
            print(f"[collect] {n} bytes -> {path}", flush=True)
        except Exception as e:
            raw = os.path.join(OUTDIR, f"collect-{stamp}.raw")
            with open(raw, "wb") as f:
                f.write(body)
            print(f"[collect] non-JSON saved to {raw}: {e}", flush=True)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")


srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
print(f"serving {LAUNCHER} on 0.0.0.0:{PORT}; dumps -> {OUTDIR}", flush=True)
srv.serve_forever()
