#!/usr/bin/env python3
"""Run a command batch on the TV over the root shell service (node rshell).

The TV runs /var/local/alvidaa/rshell.js under the vendor node runtime
(`phoenix`), which spawns /bin/sh per connection on port 8008 as uid 0.

Usage:
    python tools/tvsh.py "id; uname -a"
    python tools/tvsh.py --file tools/batches/recon1.sh
    python tools/tvsh.py --timeout 60 "cat /proc/mounts"
"""
import argparse
import os
import socket
import sys

DEFAULT_HOST = os.environ.get("TV_HOST", "192.168.0.11")
DEFAULT_PORT = int(os.environ.get("TV_PORT", "8008"))


def run(host, port, batch, timeout):
    batch = batch.rstrip("\n") + "\nexit\n"
    s = socket.create_connection((host, port), timeout=10)
    s.settimeout(timeout)
    s.sendall(batch.encode())
    chunks = []
    while True:
        try:
            data = s.recv(65536)
        except socket.timeout:
            break
        if not data:
            break
        chunks.append(data)
    s.close()
    return b"".join(chunks).decode("utf-8", "replace")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", nargs="?", help="command batch")
    ap.add_argument("--file", help="read the batch from this file")
    ap.add_argument("--host", default=DEFAULT_HOST)
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--timeout", type=float, default=25.0)
    a = ap.parse_args()

    if a.file:
        with open(a.file, encoding="utf-8") as fh:
            batch = fh.read()
    elif a.command:
        batch = a.command
    else:
        batch = sys.stdin.read()

    if not batch.strip():
        ap.error("empty command")
    out = run(a.host, a.port, batch, a.timeout)
    sys.stdout.write(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
