#!/usr/bin/env python3
"""Tiny HTTPS static server for the alvidaa launcher pages (read-only).

TV browsers sometimes upgrade a bare host:port URL to https://; this serves the
same directory over TLS with a locally generated self-signed certificate so the
page still loads (the TV will warn once, then continue).

Usage: python serve_https.py [port] [dir]
"""
import http.server
import os
import ssl
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
KEY = os.path.join(HERE, "..", "server", "keys", "local_key.pem")
CRT = os.path.join(HERE, "..", "server", "keys", "local_cert.pem")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
DIR = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "..", "launcher")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=os.path.abspath(DIR), **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(certfile=CRT, keyfile=KEY)
srv = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
print(f"https://0.0.0.0:{PORT}/ -> {os.path.abspath(DIR)}", flush=True)
srv.serve_forever()
