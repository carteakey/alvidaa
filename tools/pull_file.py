#!/usr/bin/env python3
"""Pull a file from the TV byte-exact over the rshell lane (tvsh backend).

Usage: python tools/pull_file.py <tv-path> <local-out>
Prints md5/sha256 of what landed locally. The payload is sent as
base64 chunks so encoding survives the /bin/sh pipe.
"""
import base64
import hashlib
import socket
import sys

HOST = os.environ.get("TV_HOST", "192.168.0.11")
PORT = int(os.environ.get("TV_PORT", "8008"))


def run(batch: str, timeout: float = 60.0) -> bytes:
    s = socket.create_connection((HOST, PORT), timeout=10)
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
    return b"".join(chunks)


def main() -> int:
    src, dst = sys.argv[1], sys.argv[2]
    # base64 with line-wrapping disabled markers: use busybox, split by lines
    batch = (
        "export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin\n"
        "B=/usr/local/bin/busybox\n"
        "if [ -f '{s}' ]; then $B base64 '{s}' ; echo '\\nPULL_DONE'; "
        "else echo 'PULL_ENOENT {s}'; fi\n"
        "exit\n"
    ).format(s=src)
    out = run(batch, timeout=120.0)
    text = out.decode("utf-8", "replace")
    if "PULL_ENOENT" in text:
        print("not found:", src)
        return 1
    b64 = text.replace("PULL_DONE", "").strip()
    data = base64.b64decode("".join(b64.split()))
    with open(dst, "wb") as fh:
        fh.write(data)
    print("wrote", dst, len(data), "bytes")
    print("md5   ", hashlib.md5(data).hexdigest())
    print("sha256", hashlib.sha256(data).hexdigest())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
