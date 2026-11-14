#!/usr/bin/env python3
"""Lane-3 native Home installer for 65A85QEVS — the tvsh port of
tools/launcher-host/native-install.cjs.

The 50u7dse/75u8qtuk flow, step for step, but the transport is the node
rshell (:8008, tools/tvsh.py) instead of SSH (this TV has no dropbear):

  bootstrap  verify the live stock app.js, install the switch script and the
             once-only stock backup into /var/local/alvidaa
  dry        the gate: supervised SystemUI restart with the stock bundle only,
             no file or cache changes
  install    upload + verify the candidate, then the atomic switch
  rollback   restore the stock bundle and the JS cache, restart
  status     read-only: what is installed, which md5, SystemUI pid

Safety rules copied from native-install.cjs: the stock bundle is verified
against the model profile before anything is written, the stock backup is
taken once and never replaced, and the switch only runs while SystemUI is
down, launched detached with the captured vendor environment.
"""
import argparse
import base64
import gzip
import hashlib
import socket
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
HOST = os.environ.get("TV_HOST", "192.168.0.11")
PORT = int(os.environ.get("TV_PORT", "8008"))

MODEL = {
    "app": "/APPS/pkgs/tv.vidaa.app.operationui/CHB/apps/launcher/js/app.js",
    "state": "/var/local/alvidaa",
    "switch_local": REPO / "tools/launcher-host/switch-home-65a85qevs.sh",
    "stock_local": REPO / "firmware/65a85qevs/operationui/apps/launcher/js/app.js",
    "candidate_local": REPO / "firmware/65a85qevs/candidate-fmtv-65a85qevs.js",
    "stock_md5": "45626039103fb60060618545dba6f0f5",
}

TV_MD5_CACHE: dict = {}


def tv(batch: str, timeout: float = 40.0) -> str:
    s = socket.create_connection((HOST, PORT), timeout=10)
    s.settimeout(timeout)
    s.sendall((batch.rstrip("\n") + "\nexit\n").encode())
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


def md5_local(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


def md5_tv(path: str) -> str:
    if path in TV_MD5_CACHE:
        return TV_MD5_CACHE[path]
    out = tv("md5sum '%s'" % path)
    for tok in out.split():
        if len(tok) == 32 and all(c in "0123456789abcdef" for c in tok):
            TV_MD5_CACHE[path] = tok
            return tok
    return ""


def upload(local: Path, remote: str) -> None:
    """Upload byte-exact: gzip + base64 in append chunks, decode on the TV."""
    data = local.read_bytes()
    b64 = base64.b64encode(gzip.compress(data, 9)).decode()
    tmp = remote + ".alvidaa-up.b64"
    chunk = 48 * 1024
    tv("rm -f '%s'" % tmp)
    for i in range(0, len(b64), chunk):
        part = b64[i:i + chunk]
        r = tv("printf '%%s' '%s' >> '%s' && echo CHUNK_OK" % (part, tmp))
        if "CHUNK_OK" not in r:
            raise SystemExit("chunk %d failed to append: %r" % (i // chunk, r[:120]))
    expect = hashlib.md5(data).hexdigest()
    out = tv(
        "/usr/local/bin/busybox base64 -d '%s' | /usr/local/bin/busybox gzip -d > '%s'; "
        "rm -f '%s'; md5sum '%s'" % (tmp, remote, tmp, remote)
    )
    tok = ""
    for t in out.split():
        if len(t) == 32 and all(c in "0123456789abcdef" for c in t):
            tok = t
            break
    if tok != expect:
        raise SystemExit("upload %s failed md5: got %r want %s (out %r)" %
                         (remote, tok, expect, out[:200]))
    print("  uploaded %s -> %s (%d bytes, md5 ok)" % (local.name, remote, len(data)))


def bootstrap() -> None:
    m = MODEL
    print("bootstrap 65A85QEVS")
    live = md5_tv(m["app"])
    assert live == m["stock_md5"], (
        "live app.js md5 %r does not match the pinned stock %s — pin the real "
        "revision before building" % (live, m["stock_md5"]))
    print("  live stock verified:", live)
    stock_local_md5 = md5_local(m["stock_local"])
    assert stock_local_md5 == m["stock_md5"], "local stock copy drifted"
    tv("mkdir -p %s/backup" % m["state"])
    # once-only backup: refuse to replace an existing one (native-install rule)
    have = tv("test -f %s/backup/app.js.stock && echo HAVE || echo NO" % m["state"])
    if "HAVE" in have:
        print("  stock backup already present — keeping it")
    else:
        upload(m["stock_local"], m["state"] + "/backup/app.js.stock")
        tv("chmod 600 %s/backup/app.js.stock" % m["state"])
    upload(m["switch_local"], m["state"] + "/switch-home.sh")
    tv("chmod 700 %s/switch-home.sh" % m["state"])
    print("  switch script installed")


def run_switch(mode: str) -> None:
    m = MODEL
    tv("rm -f %s/switch.done %s/switch.log" % (m["state"], m["state"]))
    tv(
        "/bin/sh -c 'trap \"\" HUP; exec /bin/sh %s/switch-home.sh %s' "
        ">/dev/null 2>&1 </dev/null & echo started" % (m["state"], mode)
    )
    print("  switch %s started (SystemUI will restart)" % mode)
    for _ in range(45):
        import time
        time.sleep(2)
        done = tv("cat %s/switch.done 2>/dev/null" % m["state"])
        if done.strip():
            log = tv("cat %s/switch.log 2>/dev/null" % m["state"])
            print(log.strip())
            if not done.strip().startswith("OK"):
                raise SystemExit("switch failed: %s" % done.strip())
            return
    raise SystemExit("switch did not finish in 90s; check %s/switch.log" % m["state"])


def cmd_dry() -> None:
    print("dry gate: stock-only SystemUI restart")
    run_switch("dry")


def cmd_install() -> None:
    m = MODEL
    print("install: candidate %s" % m["candidate_local"].name)
    cand_md5 = md5_local(m["candidate_local"])
    upload(m["candidate_local"], m["state"] + "/candidate-native-home.js")
    tv("chmod 600 %s/candidate-native-home.js; printf '%%s' '%s' > %s/candidate.md5" %
       (m["state"], cand_md5, m["state"]))
    run_switch("install")


def cmd_rollback() -> None:
    print("rollback to stock")
    run_switch("rollback")


def cmd_status() -> None:
    m = MODEL
    live = md5_tv(m["app"])
    state = "stock" if live == m["stock_md5"] else ("candidate" if live else "unknown")
    print("app.js md5 :", live or "<unreadable>", "(%s)" % state)
    print("SystemUI   :", tv("/bin/pidof SystemUI 2>/dev/null").strip() or "not running")
    print("backup     :", tv("ls -l %s/backup/app.js.stock 2>&1" % m["state"]).strip())
    print("candidate  :", tv("ls -l %s/candidate-native-home.js 2>&1" % m["state"]).strip())
    print("switch done:", tv("cat %s/switch.done 2>/dev/null" % m["state"]).strip() or "-")
    print("boot.log-3 :", tv("/usr/local/bin/busybox tail -3 %s/boot.log 2>/dev/null" % m["state"]).strip())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("cmd", choices=["bootstrap", "dry", "install", "rollback", "status"])
    a = ap.parse_args()
    {"bootstrap": bootstrap, "dry": cmd_dry, "install": cmd_install,
     "rollback": cmd_rollback, "status": cmd_status}[a.cmd]()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
