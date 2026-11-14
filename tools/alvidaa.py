#!/usr/bin/env python3
"""alvidaa — one CLI for the TV.

Root work goes through the existing server/tv wrapper (SSH is not
reimplemented here); bridge work goes through http://<tv>:8770. Every
health check degrades gracefully: a doctor that dies when the thing it
checks is down is useless.

Subcommands: sys, logs, net, doctor, open, apps, sources, ota, privacy,
backup, restore, key, power, push, pull
Environment: TV_HOST overrides the default 192.168.0.11 (the TV is
DHCP-shuffled — see server/tv).
"""
import base64
import datetime
import hashlib
import io
import json
import os
import posixpath
import re
import socket
import struct
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
TV = os.environ.get("TV_HOST", "192.168.0.11")
BRIDGE = "http://%s:8770" % TV
TV_WRAPPER = os.path.join(HERE, "..", "server", "tv")
TIMEOUT = 12


# LAN tool: never route through any ambient HTTP(S)_PROXY — the bridge is
# on the local network and a proxy env var would blackhole every check.
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


FETCH_PATH = "direct"


def fetch_raw(path, timeout=TIMEOUT, retries=2):
    """Returns (status_text, body) using direct HTTP with SSH-relay fallback."""
    global FETCH_PATH
    last = None
    for attempt in range(retries):
        req = urllib.request.Request(BRIDGE + path, headers={"Cache-Control": "no-store"})
        try:
            with OPENER.open(req, timeout=timeout) as r:
                FETCH_PATH = "direct"
                return "200", r.read()
        except Exception as e:
            last = e
            if attempt < retries - 1:
                time.sleep(2)
    out = tv("/var/local/tvtools/busybox wget -q -O - %s%s" % (BRIDGE, path), timeout=timeout + 15)
    FETCH_PATH = "ssh-relay"
    return "200 (ssh-relay)", out


def fetch(path, timeout=TIMEOUT, retries=2):
    # The TV is dual-homed (wlan0 + ethernet) and its ARP path flaps: fresh
    # TCP from this machine intermittently gets EHOSTUNREACH while
    # established SSH flows keep working. Retry direct first, then fall back
    # to a TV-side loopback fetch relayed over SSH — loopback never flaps.
    global FETCH_PATH
    last = None
    for attempt in range(retries):
        req = urllib.request.Request(BRIDGE + path, headers={"Cache-Control": "no-store"})
        try:
            with OPENER.open(req, timeout=timeout) as r:
                FETCH_PATH = "direct"
                return json.loads(r.read().decode())
        except Exception as e:
            last = e
            if attempt < retries - 1:
                time.sleep(2)
    out = tv("/var/local/tvtools/busybox wget -q -O - %s%s" % (BRIDGE, path), timeout=timeout + 15)
    FETCH_PATH = "ssh-relay"
    return json.loads(out)


def tv(cmd, timeout=25):
    """One-shot root command through the server/tv wrapper."""
    out = subprocess.run(
        [TV_WRAPPER, cmd], capture_output=True, text=True, timeout=timeout
    )
    return out.stdout


def mark(ok):
    return "ok" if ok else "FAIL"


def cmd_sys(args):
    print(tv("cat /proc/uptime; free 2>/dev/null || "
             "/var/local/tvtools/busybox free; /var/local/tvtools/busybox df -h "
             "/var/local /APPS 2>/dev/null"))


def cmd_logs(args):
    which = args[0] if args else "bridge"
    path = {
        "bridge": "/var/local/alvidaa/bridge.log",
        "hook": "/var/local/otaTest.log",
    }.get(which, "/var/local/alvidaa/bridge.log")
    n = args[1] if len(args) > 1 else "30"
    print(tv("/var/local/tvtools/busybox tail -n %s %s" % (n, path)))


def cmd_net(args):
    print(tv("ifconfig 2>/dev/null | grep -A1 'inet addr\\|wlan0\\|eth0' | head -12"))
    for port in (2222, 8770, 36669):
        s = socket.socket()
        s.settimeout(TIMEOUT)
        try:
            s.connect((TV, port))
            print("mac -> %s:%d  open" % (TV, port))
        except OSError as e:
            print("mac -> %s:%d  closed (%s)" % (TV, port, e.__class__.__name__))
        finally:
            s.close()


def cmd_open(args):
    if not args:
        print("usage: alvidaa open <url>")
        return 2
    print(json.dumps(fetch("/api/open?url=" + urllib.parse.quote(args[0], safe=""))))


def cmd_apps(args):
    try:
        apps = fetch("/api/apps").get("apps", [])
    except Exception as e:
        print("unreachable (%s)" % e.__class__.__name__)
        return 2
    if not apps:
        print("(applist empty — press Home once so the framework populates it)")
        return 0
    # appId only exists on bridges built after 2026-11-05; an older daemon
    # sends name+icon only. Degrade to a name list rather than a column of
    # question marks.
    show_id = any(a.get("appId") is not None for a in apps)
    for a in apps:
        if show_id:
            print("%-14s %s" % (a.get("appId", "-"), a.get("name", "?")))
        else:
            print(a.get("name", "?"))
    return 0


def cmd_sources(args):
    try:
        sources = fetch("/api/sources").get("sources", [])
    except Exception as e:
        print("unreachable (%s)" % e.__class__.__name__)
        return 2
    for s in sources:
        sig = "signal" if s.get("signal") else "-"
        print("%-14s %-10s %s" % (s.get("id", "?"), s.get("name", "?"), sig))


def cmd_doctor(args):
    checks = []

    def check(name, fn):
        try:
            ok, detail = fn()
        except Exception as e:  # graceful: a down check is a result, not a crash
            ok, detail = False, "unreachable (%s)" % e.__class__.__name__
        checks.append((name, ok, detail))

    d = {}
    try:
        d = fetch("/api/debug")
    except Exception:
        pass

    def bridge_check():
        h = fetch("/api/health")
        return h.get("ok") and h.get("mqtt"), "%s mqtt:%s clients:%s" % (
            h.get("version", "?"), h.get("mqtt"), h.get("clients"))

    check("bridge", bridge_check)
    check("mqtt", lambda: (
        (d.get("mqtt") or {}).get("connected", False),
        "token:%s id:%s" % ("loaded" if (d.get("mqtt") or {}).get("tokenLoaded") else "MISSING",
                            (d.get("mqtt") or {}).get("clientId", "?"))))
    check("hook", lambda: (
        (d.get("hook") or {}).get("watchdogAlive", False)
        and not (d.get("hook") or {}).get("killSwitch", True),
        "%s watchdog:%s kill-switch:%s" % (
            (d.get("hook") or {}).get("version", "?"),
            "alive" if (d.get("hook") or {}).get("watchdogAlive") else "dead",
            "present" if (d.get("hook") or {}).get("killSwitch") else "absent")))

    def ssh_check():
        last = "untried"
        for attempt in range(3):
            s = socket.socket()
            s.settimeout(TIMEOUT)
            try:
                s.connect((TV, 2222))
                return True, "%s:2222 open" % TV
            except OSError as e:
                last = "%s:2222 %s" % (TV, e.__class__.__name__)
            finally:
                s.close()
            if attempt < 2:
                time.sleep(2)
        # Direct TCP may be blocked by the dual-home ARP flap while SSH
        # itself still works over the surviving path — probe functionally.
        if tv("true", timeout=20) is not None:
            return True, "%s:2222 open (flappy direct path; ssh-relay works)" % TV
        return False, last

    check("ssh", ssh_check)

    def ota_check():
        out = tv("iptables -L -n 2>/dev/null | grep -c DROP")
        n = int(out.strip() or 0)
        return n > 0, "%d DROP rules (kill-list armed)" % n

    check("ota", ota_check)

    def disk_check():
        out = tv("/var/local/tvtools/busybox df /var/local | /var/local/tvtools/busybox tail -n 1")
        parts = out.split()
        if len(parts) < 5:
            return False, "df output unparseable: %r" % out[:80]
        return True, "var/local %s used (%s/%s)" % (parts[4], parts[2], parts[3])

    check("disk", disk_check)

    def launcher_check():
        status, body = fetch_raw("/")
        return True, "GET / %s (%d bytes)" % (status, len(body))

    check("launcher", launcher_check)

    for name, ok, detail in checks:
        print("%-9s %-4s %s" % (name, mark(ok), detail))
    print("path      %-4s %s" % ("info", "bridge checks via %s fetch" % FETCH_PATH))
    passed = sum(1 for _, ok, _ in checks if ok)
    verdict = "HEALTHY" if passed == len(checks) else ("DEGRADED" if passed else "DOWN")
    print("VERDICT: %s (%d/%d checks passed)" % (verdict, passed, len(checks)))
    return 0 if verdict == "HEALTHY" else 1


# ---------------------------------------------------------------- ota freeze
# Firmware-OTA freeze (issue #14): two independent layers, both verified on
# every transition. Kernel layer = dedicated iptables chain ALVIDAA_OTA
# (chain isolation guarantees 'on' can never touch bee2's INPUT kill-list
# or tvfw's own rules). Resolver layer = 0.0.0.0 pins in /tmp/hosts (the
# /etc/hosts symlink target — tmpfs, so the boot re-apply in firmware/tvfw
# rewrites it; reboot survival = hook -> tvfw -> state.sh sidecar with
# pre-resolved IPs, no boot-DNS dependency). Standing policy (ENDPOINTS.md)
# is ALLOW for ota-tv; the freeze is an explicit, tracked override.
OTA_HOSTS = ["ota-tv.vidaahub.com", "upgrade-cus.prod-eu-c.az.vidaahub.com"]
# Collateral candidates (ds41 condition 1, findings 09): prod-eu-c serves
# file-ul/account uploads too, and CDN IPs rotate across the vidaahub set.
# A per-IP freeze REJECT blocks EVERY host sharing that IP — enumerate the
# plausible sharers, report the overlap at freeze time and in status.
OTA_COLLATERAL = [
    "file-ul.vidaahub.com", "evt-na.vidaahub.com", "ter-jrnl-na.vidaahub.com",
    "exc-jrnl-na.vidaahub.com", "policy-jrnl-na.vidaahub.com",
    "dvcstatus-dataretrv.vidaahub.com", "rsc-ads.vidaahub.com",
    "recommend-ui.vidaahub.com", "home-ui.vidaahub.com", "img.vidaahub.com",
    "msg.vidaahub.com",
]
OTA_CHAIN = "ALVIDAA_OTA"
OTA_STATE = "/var/local/alvidaa/ota_freeze.state"
OTA_STATE_SH = "/var/local/alvidaa/ota_freeze.state.sh"
OTA_HOSTS_FILE = "/tmp/hosts"
BB = "/var/local/tvtools/busybox"


def _tv_ota(cmd, timeout=60):
    return tv(cmd, timeout=timeout)


def _ota_resolve(host):
    """Return the real IPv4 addresses for host as seen by the TV resolver."""
    out = _tv_ota("%s nslookup %s 2>/dev/null" % (BB, host))
    ips = []
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("Address ") or line.startswith("Address:"):
            ip = line.split(":", 1)[-1].strip()
            if ip and ":" not in ip and ip != "0.0.0.0":
                ips.append(ip)
    return sorted(set(ips))


def _ota_pin_present():
    out = _tv_ota("%s grep -h '^0\\.0\\.0\\.0 ' %s 2>/dev/null | %s grep -E 'ota-tv|upgrade-cus' | grep -c ."
                  % (BB, OTA_HOSTS_FILE, BB))
    return int(out.strip() or 0)


def _ota_chain_state():
    out = _tv_ota("iptables -L %s -n 2>/dev/null | grep -c REJECT; "
                  "iptables -L OUTPUT -n 2>/dev/null | grep -c '%s'" % (OTA_CHAIN, OTA_CHAIN))
    lines = [x.strip() for x in out.splitlines() if x.strip()]
    rules = int(lines[0]) if lines else 0
    jump = int(lines[1]) if len(lines) > 1 else 0
    return rules, jump


def _ota_state_exists():
    return _tv_ota("[ -f %s ] && echo yes || echo no" % OTA_STATE).strip() == "yes"


def _ota_nc(target):
    """True if a TCP:443 connect from the TV to target SUCCEEDS."""
    out = _tv_ota("%s nc -w 5 -z %s 443 >/dev/null 2>&1 && echo OK || echo FAIL" % (BB, target))
    return "OK" in out


def _ota_state_files(state, ips, collateral):
    """Write the JSON state and the shell sidecar tvfw re-applies at boot."""
    import datetime
    now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    js = json.dumps({
        "frozen_at": now, "hosts": OTA_HOSTS, "ips": ips,
        "collateral": collateral,
        "chain": OTA_CHAIN, "layers": ["iptables-chain", "hosts-pin"],
    })
    sh = ("OTA_HOSTS='%s'\nOTA_IPS='%s'\n" % (" ".join(OTA_HOSTS), " ".join(ips)))
    _tv_ota("echo '%s' > %s" % (js.replace("'", "'\\''"), OTA_STATE))
    _tv_ota("echo '%s' > %s" % (sh.replace("'", "'\\''"), OTA_STATE_SH))


def _ota_collateral(ips):
    """Return {ip: [other vidaahub hosts sharing that IP]} for the freeze set."""
    if not ips:
        return {}
    shared = {}
    for host in OTA_COLLATERAL:
        for ip in _ota_resolve(host):
            if ip in ips:
                shared.setdefault(ip, []).append(host)
    return shared


def _ota_tvfw_applied():
    """Deferral-window readout (ds41 condition 2) from tvfw's own marker."""
    out = _tv_ota("cat /var/local/tvfw.applied_at_boot 2>/dev/null; echo /; "
                  "cat /var/local/tvfw.applied 2>/dev/null")
    parts = [p.strip() for p in out.split("/", 1) if p.strip()]
    if len(parts) < 2 or not parts[0].replace(".", "").isdigit():
        return None
    import time as _t
    applied_T = float(parts[0])
    try:
        age = max(0, _t.time() - float(parts[1]))  # marker is an epoch
        return "applied at T+%ds (%.0fs ago)" % (applied_T, age)
    except ValueError:
        return "applied at T+%ds" % applied_T


def cmd_ota(args):
    action = args[0] if args else "status"

    if action == "off":
        if _ota_state_exists():
            print("already frozen (state file present) — nothing to do")
            return cmd_ota(["status"])
        print("resolving %s from the TV resolver..." % ", ".join(OTA_HOSTS))
        ips = []
        for h in OTA_HOSTS:
            found = _ota_resolve(h)
            print("  %-42s -> %s" % (h, ", ".join(found) or "UNRESOLVED"))
            ips.extend(found)
        ips = sorted(set(ips))
        if not ips:
            print("ERROR: cannot freeze — kernel layer needs at least one resolved IP")
            return 1
        # Kernel layer: dedicated chain (isolation = safe unfreeze).
        _tv_ota("iptables -N %s 2>/dev/null; true" % OTA_CHAIN)
        for ip in ips:
            _tv_ota("iptables -C %s -d %s -j REJECT 2>/dev/null || iptables -A %s -d %s -j REJECT"
                    % (OTA_CHAIN, ip, OTA_CHAIN, ip))
        _tv_ota("iptables -C OUTPUT -j %s 2>/dev/null || iptables -I OUTPUT 1 -j %s"
                % (OTA_CHAIN, OTA_CHAIN))
        # Resolver layer: 0.0.0.0 pins in /tmp/hosts (dedup-safe).
        for h in OTA_HOSTS:
            _tv_ota("%s grep -q '^0\\.0\\.0\\.0 %s$' %s 2>/dev/null || echo '0.0.0.0 %s' >> %s"
                    % (BB, h, OTA_HOSTS_FILE, h, OTA_HOSTS_FILE))
        # Collateral disclosure (ds41 condition 1): a per-IP REJECT blocks
        # every vidaahub host sharing the frozen IPs — state it, never silent.
        collateral = _ota_collateral(ips)
        if collateral:
            print("  collateral   : per-IP freeze also blocks (shared CDN IPs):")
            for ip, hosts in sorted(collateral.items()):
                print("    %-15s %s" % (ip, ", ".join(hosts)))
        else:
            print("  collateral   : no other vidaahub host shares the frozen IPs right now")
        _ota_state_files(None, ips, collateral)
        print("verifying freeze (both layers must fail to connect)...")
        rules, jump = _ota_chain_state()
        pin = _ota_pin_present()
        real_ok = any(_ota_nc(ip) for ip in ips)
        name_ok = _ota_nc(OTA_HOSTS[0])
        print("  kernel layer : chain %d REJECT rules, jump %s" % (rules, "armed" if jump else "MISSING"))
        print("  resolver     : %d pin line(s) in %s" % (pin, OTA_HOSTS_FILE))
        print("  live probe   : connect by IP %s | connect by name %s"
              % ("OPEN (BAD)" if real_ok else "blocked", "OPEN (BAD)" if name_ok else "blocked"))
        if rules and jump and pin and not real_ok and not name_ok:
            print("FROZEN (verified) — OTA firmware updates are blocked at both layers")
            return 0
        print("ERROR: freeze incomplete — see per-layer lines above; do NOT trust this state")
        return 1

    if action == "on":
        print("removing exactly what 'off' added (chain + jump + pins + state)...")
        _tv_ota("iptables -D OUTPUT -j %s 2>/dev/null; true" % OTA_CHAIN)
        _tv_ota("iptables -F %s 2>/dev/null; iptables -X %s 2>/dev/null; true" % (OTA_CHAIN, OTA_CHAIN))
        _tv_ota("%s grep -v -E '^(0\\.0\\.0\\.0 (ota-tv\\.vidaahub\\.com|upgrade-cus\\.prod-eu-c\\.az\\.vidaahub\\.com))' %s > %s.new 2>/dev/null; "
                "mv %s.new %s" % (BB, OTA_HOSTS_FILE, OTA_HOSTS_FILE, OTA_HOSTS_FILE, OTA_HOSTS_FILE))
        _tv_ota("rm -f %s %s" % (OTA_STATE, OTA_STATE_SH))
        print("verifying unfreeze (resolution and connect must BOTH succeed)...")
        rules, jump = _ota_chain_state()
        pin = _ota_pin_present()
        ips_now = _ota_resolve(OTA_HOSTS[0])
        real_ok = any(_ota_nc(ip) for ip in ips_now)
        name_ok = _ota_nc(OTA_HOSTS[0])
        print("  kernel layer : chain rules %d (want 0), jump %s (want removed)" % (rules, jump))
        print("  resolver     : %d pin line(s) (want 0) | live resolve -> %s"
              % (pin, ", ".join(ips_now) or "UNRESOLVED"))
        print("  live probe   : connect by IP %s | connect by name %s"
              % ("OK" if real_ok else "BLOCKED", "OK" if name_ok else "BLOCKED"))
        if not rules and not jump and not pin and ips_now and real_ok and name_ok:
            print("UNFROZEN (verified) — OTA firmware updates flow again")
            return 0
        print("ERROR: PARTIAL UNFREEZE — a layer did not come back. This is the "
              "dangerous state; fix before trusting OTA. (Per-layer lines above.)")
        return 1

    if action == "status":
        state = _ota_state_exists()
        rules, jump = _ota_chain_state()
        pin = _ota_pin_present()
        resolved = _ota_resolve(OTA_HOSTS[0])
        real_ok = any(_ota_nc(ip) for ip in resolved)
        name_ok = _ota_nc(OTA_HOSTS[0])
        killswitch = _tv_ota("[ -f /var/local/hook.off ] && echo present || echo absent").strip()
        tvfw_block = _tv_ota("%s grep -c 'ota_freeze.state.sh' /var/local/tvfw 2>/dev/null" % BB).strip()
        frozen_at = ""
        if state:
            frozen_at = _tv_ota("%s grep -o '\"frozen_at\": *\"[^\"]*\"' %s 2>/dev/null" % (BB, OTA_STATE)).strip()
        applied = _ota_tvfw_applied()
        print("  state file     : %s %s" % ("present" if state else "absent", frozen_at))
        print("  kernel layer   : chain %d REJECT rules, jump %s" % (rules, "armed" if jump else "absent"))
        print("  resolver layer : %d pin line(s) | live resolve -> %s"
              % (pin, ", ".join(resolved) or "UNRESOLVED"))
        print("  live probe     : connect by IP %s | connect by name %s"
              % ("OPEN" if real_ok else "blocked", "OPEN" if name_ok else "blocked"))
        print("  tvfw           : %s" % (applied or "not applied this boot (marker missing)"))
        print("  reboot survival: tvfw re-apply block %s | kill-switch %s"
              % ("present" if tvfw_block and int(tvfw_block or 0) > 0 else "MISSING", killswitch))
        if state and resolved:
            collateral = _ota_collateral(resolved)
            if collateral:
                print("  collateral     : freeze IPs also serve (shared CDN IPs):")
                for ip, hosts in sorted(collateral.items()):
                    print("    %-15s %s" % (ip, ", ".join(hosts)))
            else:
                print("  collateral     : no other vidaahub host shares the freeze IPs right now")
        if rules and jump and pin and not real_ok and not name_ok:
            verdict = "FROZEN (verified)"
        elif not rules and not jump and not pin and real_ok and name_ok:
            verdict = "UNFROZEN (verified)"
        else:
            verdict = "PARTIAL/UNKNOWN — layers disagree, investigate before UI work"
        print("VERDICT: %s" % verdict)
        if state and killswitch == "present":
            print("WARNING: /var/local/hook.off is present — the next reboot disarms "
                  "the freeze (reversibility law). Remove the kill-switch or re-freeze after recovery.")
        return 0

    print("usage: alvidaa ota off|on|status")
    return 2


def _md5_tv(path):
    out = tv("/var/local/tvtools/busybox md5sum '%s' 2>/dev/null | /var/local/tvtools/busybox cut -d' ' -f1" % path)
    return out.strip()


def cmd_push(args):
    if len(args) < 2:
        print("usage: alvidaa push <local-file> <tv-absolute-path>")
        return 2
    local, remote = args[0], args[1]
    if not os.path.isfile(local):
        print("no such file: %s" % local)
        return 2
    if not remote.startswith("/"):
        print("remote path must be absolute (e.g. /var/local/alvidaa/…)")
        return 2
    import hashlib, io, tarfile, base64
    lm = hashlib.md5(open(local, "rb").read()).hexdigest()
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as t:
        t.add(local, arcname=os.path.basename(local))
    # Stream the tar over SSH stdin — argv dies at ~10KB (dropbear command
    # channel), the stdin pipe is the lane every deploy script in this repo
    # already uses.
    base = os.path.basename(local)
    mv_cmd = "" if remote == "/tmp/" + base else "mv '/tmp/%s' '%s' && " % (base, remote)
    out = subprocess.run(
        [TV_WRAPPER,
         "cat > /tmp/.alvidaa-push.tar && "
         "/var/local/tvtools/busybox tar xf /tmp/.alvidaa-push.tar -C /tmp/ && "
         "%srm -f /tmp/.alvidaa-push.tar && "
         "/var/local/tvtools/busybox sync && echo INSTALL-OK" % mv_cmd],
        input=buf.getvalue(), capture_output=True, timeout=90)
    stdout = out.stdout.decode(errors="replace")
    stderr = out.stderr.decode(errors="replace")
    if "INSTALL-OK" not in stdout:
        print("push failed: %s" % (stdout.strip()[:200] or stderr.strip()[:200] or "empty"))
        return 1
    rm = _md5_tv(remote)
    ok = rm == lm
    print("push %s -> %s:%s  md5 %s  %s" % (
        local, TV, remote, lm[:12] + "…", "VERIFIED" if ok else "MISMATCH (local %s)" % lm[:12] + "…"))
    return 0 if ok else 1


def cmd_pull(args):
    if len(args) < 2:
        print("usage: alvidaa pull <tv-absolute-path> <local-file>")
        return 2
    remote, local = args[0], args[1]
    if not remote.startswith("/"):
        print("remote path must be absolute")
        return 2
    rm = _md5_tv(remote)
    if not rm:
        print("no such file on TV (or unreadable): %s" % remote)
        return 2
    out = tv("/var/local/tvtools/busybox base64 '%s'" % remote, timeout=60)
    import base64, hashlib
    data = base64.b64decode("".join(out.split()))
    with open(local, "wb") as f:
        f.write(data)
    lm = hashlib.md5(data).hexdigest()
    ok = lm == rm
    print("pull %s:%s -> %s  md5 %s  %s" % (
        TV, remote, local, rm[:12] + "…", "VERIFIED" if ok else "MISMATCH (local %s)" % lm[:12] + "…"))
    return 0 if ok else 1


# ------------------------------------------------------------- backup/restore
# Snapshot the TV's mutable state (issue #16) and put named pieces back.
# The mutable set: /var/local/alvidaa (bridge config, launcher, native-home
# state, the once-only stock backups, freeze state), the hook at
# /var/local/otaTest.sh, the firewall policy /var/local/tvfw and the
# kill-switch marker /var/local/hook.off — whose EXISTENCE is state (present
# means the next reboot disarms the hook; reversibility law).
#
# Safety shape, per the brief:
#   - backup is read-only against the TV (tar/md5sum/find reads only) and
#     refuses to include anything on the never-touch list
#     (tools/launcher-host/never-touch.json) — a match aborts the whole run,
#     never a warning;
#   - restore is explicit and per-path, never a blind untar: --only names
#     what goes back, the target must sit in the writable lane (/var/local),
#     a switch in progress (switch.log without switch.done) refuses, and
#     never-touch applies to writes too;
#   - key material is excluded from the archive and NAMED in the manifest —
#     keys and tokens never leave server/keys/ discipline (AGENTS.md), so a
#     restored dropbear host key would be new key material, not a restored one;
#   - md5 on the TV (no sha256sum there), sha256 on the host, per-file md5 in
#     the manifest so the archive is auditable without extracting.
MUTABLE_PATHS = [
    "/var/local/alvidaa",
    "/var/local/otaTest.sh",
    "/var/local/tvfw",
    "/var/local/hook.off",
]
# Known key material: always excluded, always named in the manifest.
KEY_PATHS = ["/etc/dropbear"]
# Basenames that count as key/token material if they ever appear inside the
# mutable set (defensive: none belong there, and one that does must not ride
# the archive silently).
KEY_NAME_RE = re.compile(
    r"(^|/)(id_(rsa|dsa|ecdsa|ed25519)|authorized_keys|.*_host_key|.*\.key|.*\.pem|.*\.token)$")
NEVER_TOUCH_JSON = os.path.join(HERE, "launcher-host", "never-touch.json")
RESTORE_WRITABLE_ROOTS = ["/var/local"]
# <state>/switch.done semantics: runSwitch removes done and log at kick and
# writes done at the end, so log-present + done-absent is the mid-flight
# signature (a fresh TV has neither; a finished switch has both).
SWITCH_STATE_DIRS = ["/var/local/alvidaa/native-home", "/var/local/alvidaa"]
RESTORE_STAGE = "/tmp/.alvidaa-restore"
BB = "/var/local/tvtools/busybox"  # (same path as the ota/privacy sections)

_NT_DOC = None


def _nt_normalize(p):
    """TV-absolute, lexically normalized — mirrors never-touch.cjs normalize():
    collapse a doubled leading slash (posix normpath would keep '//OAD' and it
    would slip past a prefix rule), then normalize so dot-dot cannot walk out
    of a prefix."""
    p = str(p or "")
    if p.startswith("/"):
        p = re.sub(r"^/{2,}", "/", p)
    return posixpath.normpath(p)


def _glob_to_re(pattern):
    """'*' matches any run of characters except '/'; everything else literal;
    anchored — mirrors never-touch.cjs globToRegExp."""
    # split('*') yields the segments BETWEEN asterisks, never the asterisk
    # itself, so the join is what emits the wildcard. The previous form tested
    # each segment for equality with "*", which can never be true — every glob
    # compiled to its literal self with the asterisks stripped, so
    # '/dev/mmcblk*' became '^/dev/mmcblk$' and the raw-emmc rule was dead in
    # this guard while never-touch.cjs refused the same path (found 2026-11-13
    # by cross-checking the two consumers of the same rules file).
    source = "[^/]*".join(re.escape(part) for part in pattern.split("*"))
    return re.compile("^" + source + "$")


def _never_touch_hit(path):
    """The first matching never-touch rule for a normalized path, or None.
    Same rules file, same semantics as never-touch.cjs check()."""
    global _NT_DOC
    if _NT_DOC is None:
        with open(NEVER_TOUCH_JSON, "r", encoding="utf-8") as f:
            _NT_DOC = json.load(f)
    p = _nt_normalize(path)
    for rule in _NT_DOC.get("rules", []):
        m, t = rule.get("match", ""), rule.get("type")
        if t == "exact":
            hit = p == m
        elif t == "prefix":
            base = m.rstrip("/")
            hit = p == base or p.startswith(base + "/")
        elif t == "glob":
            hit = _glob_to_re(m).match(p) is not None
        else:
            hit = False
        if hit:
            return rule
    return None


def _tv_bytes(cmd, timeout=180, data=None):
    """Binary lane through the server/tv wrapper — tar streams are not text
    and the tv() text lane would mangle them. `data` rides stdin (the pipe is
    the lane cmd_push uses; argv dies at ~10KB on dropbear). The seam the
    tests replace."""
    out = subprocess.run([TV_WRAPPER, cmd], capture_output=True, timeout=timeout,
                         input=data)
    return out.stdout


def _exists(path):
    return tv("[ -e '%s' ] && echo yes || echo no" % path).strip() == "yes"


def _is_dir(path):
    return tv("[ -d '%s' ] && echo yes || echo no" % path).strip() == "yes"


def _size_tv(path):
    out = tv("%s wc -c < '%s' 2>/dev/null" % (BB, path)).strip()
    return int(out) if out.isdigit() else 0


def _walk(path):
    """Every file under path (path itself if it is a file); [] when absent."""
    if not _exists(path):
        return []
    if not _is_dir(path):
        return [path]
    return [line.strip() for line in
            tv("%s find '%s' -type f 2>/dev/null" % (BB, path)).splitlines()
            if line.strip()]


def _tar_on_tv():
    out = tv("%s tar --help 2>&1 | head -n 1" % BB)
    return "applet not found" not in out


def _is_file(path):
    return tv("[ -f '%s' ] && echo yes || echo no" % path).strip() == "yes"


def _switch_in_progress():
    """True while any known switch is mid-flight: its log exists without a
    done verdict (runSwitch removes both at kick, writes done at the end).
    File semantics — the markers are files, not directories."""
    for state in SWITCH_STATE_DIRS:
        log = _is_file(state + "/switch.log")
        done = _is_file(state + "/switch.done")
        if log and not done:
            return state
    return None


def _collect_backup_set():
    """(files, excluded) for the mutable set. Any never-touch match aborts the
    whole backup — a refusal, never a warning (never-touch.json discipline)."""
    files, excluded = [], []
    for root in MUTABLE_PATHS + KEY_PATHS:
        hit = _never_touch_hit(root)
        if hit:
            print("ERROR: refusing backup — %s is on the never-touch list [%s]: %s"
                  % (_nt_normalize(root), hit["id"], hit["reason"]))
            return None, None
    for root in MUTABLE_PATHS:
        for path in _walk(root):
            hit = _never_touch_hit(path)
            if hit:
                print("ERROR: refusing backup — %s is on the never-touch list [%s]: %s"
                      % (_nt_normalize(path), hit["id"], hit["reason"]))
                return None, None
            if KEY_NAME_RE.search(_nt_normalize(path)):
                excluded.append({"path": _nt_normalize(path),
                                 "reason": "key/token material never leaves the TV "
                                           "(server/keys/ discipline)"})
                continue
            files.append(_nt_normalize(path))
    return files, excluded


def _backup_dir(out_dir):
    stamp = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    directory = out_dir or os.path.join(HERE, "..", "firmware", "backup")
    directory = os.path.abspath(directory)
    os.makedirs(directory, exist_ok=True)
    return directory, "alvidaa-backup-%s-%s.tar" % (TV, stamp)


def _tar_members_tv(paths):
    """The TV-side tar stream for the top-level paths, or None when the TV has
    no tar applet (the fallback pulls files individually and tars on the host)."""
    if not _tar_on_tv():
        return None
    spec = " ".join("'%s'" % p for p in paths)
    return _tv_bytes("%s tar cf - %s 2>/dev/null" % (BB, spec), timeout=600)


def _pull_one(path):
    """One file over the base64 lane (cmd_pull's transport), verified against
    the TV-side md5. Returns bytes, or None on any mismatch/absence."""
    want = _md5_tv(path)
    if not want:
        return None
    data = base64.b64decode("".join(tv("%s base64 '%s'" % (BB, path), timeout=120).split()))
    return data if hashlib.md5(data).hexdigest() == want else None


def cmd_backup(args):
    out_dir = None
    rest = []
    i = 0
    while i < len(args):
        if args[i] == "--out":
            i += 1
            if i >= len(args):
                print("usage: alvidaa backup [--out <dir>]")
                return 2
            out_dir = args[i]
        else:
            rest.append(args[i])
        i += 1
    if rest:
        print("usage: alvidaa backup [--out <dir>]")
        return 2

    files, excluded = _collect_backup_set()
    if files is None:
        return 1
    entries = []
    for path in files:
        entries.append({"path": path, "size": _size_tv(path), "md5": _md5_tv(path)})

    directory, name = _backup_dir(out_dir)
    archive_path = os.path.join(directory, name)
    stream = _tar_members_tv([p for p in MUTABLE_PATHS if _exists(p)])
    if stream is not None:
        with open(archive_path, "wb") as f:
            f.write(stream)
        tar_on_tv = True
    else:
        # No tar applet on the TV: pull files individually and tar on the host
        # with the same member names a TV-side tar would produce (leading '/'
        # stripped), so restore cannot tell the two apart.
        with tarfile.open(archive_path, "w") as t:
            for entry in entries:
                data = _pull_one(entry["path"])
                if data is None:
                    print("ERROR: could not pull %s (md5 mismatch or unreadable) "
                          "— archive incomplete, not written" % entry["path"])
                    return 1
                info = tarfile.TarInfo(entry["path"].lstrip("/"))
                info.size = len(data)
                t.addfile(info, io.BytesIO(data))
        tar_on_tv = False

    with open(archive_path, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    manifest = {
        "schema": 1,
        "created": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tv_host": TV,
        "archive": name,
        "archive_sha256": digest,
        "archive_size": os.path.getsize(archive_path),
        "tar_on_tv": tar_on_tv,
        "entries": entries,
        "excluded": [{"path": key, "reason": "key material never leaves the TV "
                      "(server/keys/ discipline)"} for key in KEY_PATHS] + excluded,
    }
    with open(archive_path + ".manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print("backup %d file(s) -> %s (%d bytes, sha256 %s)  tar-on-tv: %s"
          % (len(entries), archive_path, manifest["archive_size"], digest[:12] + "…", tar_on_tv))
    for e in entries:
        print("  %-58s %8d  md5 %s" % (e["path"], e["size"], e["md5"]))
    for x in manifest["excluded"]:
        print("  EXCLUDED %-50s %s" % (x["path"], x["reason"]))
    print("manifest: %s.manifest.json" % archive_path)
    return 0


def _restore_argparse(args):
    directory, only = None, None
    rest = []
    i = 0
    while i < len(args):
        if args[i] == "--only":
            i += 1
            if i >= len(args):
                return None, None, None
            only = args[i]
        else:
            rest.append(args[i])
        i += 1
    if len(rest) != 1:
        return None, None, None
    return rest[0], only, rest


def cmd_restore(args):
    directory, only, _ = _restore_argparse(args)
    if directory is None:
        print("usage: alvidaa restore <dir> --only <path>")
        return 2
    manifest_path = os.path.join(directory, "manifest.json")
    candidates = [manifest_path] if os.path.isfile(manifest_path) else sorted(
        os.path.join(directory, f) for f in os.listdir(directory)
        if f.endswith(".manifest.json")) if os.path.isdir(directory) else []
    if not candidates:
        print("no manifest in %s (expected <archive>.manifest.json)" % directory)
        return 2
    with open(candidates[0], "r", encoding="utf-8") as f:
        manifest = json.load(f)
    archive_path = os.path.join(directory, manifest.get("archive", ""))
    if not os.path.isfile(archive_path):
        print("archive missing: %s" % archive_path)
        return 2
    with open(archive_path, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    if digest != manifest.get("archive_sha256"):
        print("ERROR: archive sha256 mismatch (manifest %s, actual %s) — refusing; "
              "the archive is not the one the manifest audited"
              % (manifest.get("archive_sha256", "?")[:12] + "…", digest[:12] + "…"))
        return 1

    entries = {e["path"]: e for e in manifest.get("entries", [])}
    if not only:
        print("restore is explicit and per-path — never a blind untar. "
              "Name one with --only; the archive holds:")
        for path in sorted(entries):
            print("  %s" % path)
        return 2

    # The safety refusals fire on the REQUEST, before archive membership is
    # even consulted: a read-only or never-touch target is refused whether or
    # not the archive happens to hold it.
    want = _nt_normalize(only)
    hit = _never_touch_hit(want)
    if hit:
        print("ERROR: refusing restore — %s is on the never-touch list [%s]: %s"
              % (want, hit["id"], hit["reason"]))
        return 1
    if not any(want == r or want.startswith(r.rstrip("/") + "/")
               for r in RESTORE_WRITABLE_ROOTS):
        print("ERROR: refusing restore — %s is outside the writable lane (%s): "
              "read-only partition, or never ours (never-touch.json)"
              % (want, ", ".join(RESTORE_WRITABLE_ROOTS)))
        return 1
    in_progress = _switch_in_progress()
    if in_progress:
        print("ERROR: refusing restore — a switch is in progress (%s/switch.log "
              "without switch.done); put the named file back after it finishes" % in_progress)
        return 1
    targets = sorted(p for p in entries
                     if p == want or p.startswith(want.rstrip("/") + "/"))
    if not targets:
        print("ERROR: %s is not in this archive (nothing to restore)" % want)
        return 2

    # Extract the named members host-side and verify each against the manifest
    # BEFORE anything is written to the TV.
    payload = {}
    with tarfile.open(archive_path, "r") as t:
        for member in t.getmembers():
            if not member.isfile():
                continue
            member_path = "/" + member.name.lstrip("/")
            if member_path not in dict.fromkeys(targets):
                continue
            data = t.extractfile(member).read()
            if hashlib.md5(data).hexdigest() != entries[member_path]["md5"]:
                print("ERROR: md5 mismatch for %s (archive vs manifest) — refusing; "
                      "nothing was written" % member_path)
                return 1
            payload[member_path] = data
    missing = [p for p in targets if p not in payload]
    if missing:
        print("ERROR: archive does not contain %s — refusing" % ", ".join(missing))
        return 1

    # Stage and stream: one tar of the relative payload over the stdin lane
    # (the pipe is the lane cmd_push uses), then named mv per file. Only
    # these writes touch the TV.
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as t:
        for path, data in payload.items():
            info = tarfile.TarInfo(path.lstrip("/"))
            info.size = len(data)
            t.addfile(info, io.BytesIO(data))
    out = _tv_bytes(
        "%s mkdir -p %s && cat > %s/restore.tar && "
        "%s tar xf %s/restore.tar -C %s/ && %s rm -f %s/restore.tar && echo STAGE-OK"
        % (BB, RESTORE_STAGE, RESTORE_STAGE, BB, RESTORE_STAGE, RESTORE_STAGE, BB, RESTORE_STAGE),
        timeout=300, data=buf.getvalue())
    if b"STAGE-OK" not in out:
        print("restore failed at staging: %s"
              % (out.decode(errors="replace").strip()[:200] or "empty"))
        return 1

    failures = 0
    for path in sorted(payload):
        rel = path.lstrip("/")
        parent = posixpath.dirname(path)
        out = tv("%s mkdir -p '%s' && mv '%s/%s' '%s' && %s md5sum '%s' 2>/dev/null | %s cut -d' ' -f1"
                 % (BB, parent, RESTORE_STAGE, rel, path, BB, path, BB), timeout=60)
        got = out.strip()
        ok = got == entries[path]["md5"]
        failures += 0 if ok else 1
        print("restore %s  md5 %s  %s" % (
            path, entries[path]["md5"][:12] + "…", "VERIFIED" if ok else "MISMATCH (tv %s)" % got[:12] + "…"))
    tv("%s rm -rf %s" % (BB, RESTORE_STAGE))
    if failures:
        print("ERROR: %d of %d file(s) failed verification — see above" % (failures, len(payload)))
        return 1
    print("restored %d file(s) from %s (md5 verified on the TV)" % (len(payload), manifest.get("archive")))
    return 0


# ---------------------------------------------------------------- privacy
# Kill-list / telemetry visibility (issue #15), READ-ONLY: nothing here
# touches firewall state. The whole point of reporting the layers
# separately is findings 09: one layer is not enough, and "0 rules" can
# mean either "the resolver is doing the work" (correct) or "the apply
# loop silently failed" (the 2026-11-05 boot bug) — a bare count cannot
# tell them apart, so every layer reports WHICH case it is.
#
# Layers, per the kill-list design (firmware/tvfw + ENDPOINTS.md):
#   resolver  — AdGuard NXDOMAIN-pins telemetry hosts (the durable kill;
#               survives kernel flushes and CDN rotation)
#   kernel    — tvfw Tier 0 (DoH) + Tier 1 (telemetry hosts) REJECTs in
#               OUTPUT, re-applied at boot by the hook
#   doh       — the Tier 0 bootstrap block specifically (dns.google),
#               the most quotable number in the project
#   wiretap   — LOG-target kernel capture (armed window only; the log
#               file is historical evidence, NOT live data, once the
#               LOG rules are gone)
PRIVACY_TIER1 = [
    "evt-na.vidaahub.com", "ter-jrnl-na.vidaahub.com",
    "exc-jrnl-na.vidaahub.com", "policy-jrnl-na.vidaahub.com",
    "dvcstatus-dataretrv.vidaahub.com", "file-ul.vidaahub.com",
    "rsc-ads.vidaahub.com",
]
PRIVACY_DOH_IPS = {"8.8.8.8": "dns.google", "8.8.4.4": "dns.google"}
# IP labels from the Oct 30 – Nov 2 wiretap window (findings 09); CDN
# rotation means a historical IP can drift to a different host — labels
# are attributed, never asserted.
PRIVACY_IP_LABELS = {
    "20.170.76.123": "ter-jrnl-na (journal collector, per findings 09)",
    "20.52.196.175": "dvcstatus-dataretrv (per findings 09)",
    "131.189.128.123": "file-ul/account (per findings 09)",
    "131.189.69.51": "account, prod-eu-c (per findings 09)",
}
WIRETAP_LOG = "/var/local/wiretap.log"
BB = "/var/local/tvtools/busybox"  # (same path as the ota section)


def _ipt_rules(chain):
    """Parsed `iptables -L <chain> -n -v -x`: [(pkts, bytes, target, proto, dest, extra)].
    None = chain does not exist; [] = chain exists and is empty. Both states
    matter (findings 09): an empty OUTPUT after a boot with an applied
    marker is the silent-kill signature, not an OK state."""
    out = tv("/usr/local/bin/iptables -L %s -n -v -x 2>&1" % chain)
    if "No chain/target/match" in out or not out.strip():
        return None
    rules = []
    for line in out.splitlines():
        p = line.split()
        if len(p) < 9 or not p[0].isdigit():
            continue  # header/blank
        rules.append((int(p[0]), int(p[1]), p[2], p[3], p[8], " ".join(p[9:])))
    return rules


_RESOLVE_CACHE = {}


def _privacy_resolve(host):
    """Resolver-layer probe as THE TV sees it: ('pinned'|'resolved'|'unresolved', ips).
    busybox nslookup answers 0.0.0.0 / :: for AdGuard-blocked hosts
    (findings 09) — that IS the blocking signal, never filtered away here."""
    if host in _RESOLVE_CACHE:
        return _RESOLVE_CACHE[host]
    out = tv("%s nslookup %s 2>&1" % (BB, host))
    ips = []
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("Address"):
            ip = line.split(":", 1)[-1].strip()
            # the 'Server: … :53' echo line also starts with Address — skip it
            if ip and not ip.endswith(":53") and ip not in ("0.0.0.0", "::") and ":" not in ip:
                ips.append(ip)
            elif ip in ("0.0.0.0", "::"):
                ips.append(ip)
    real = [ip for ip in ips if ip not in ("0.0.0.0", "::")]
    result = ("resolved", real) if real else (("pinned", ips) if ips else ("unresolved", []))
    _RESOLVE_CACHE[host] = result
    return result


def _wiretap_summary():
    """(armed, historical_counts) — armed = LOG rules live in the kernel AND
    the dmesg ring actually carries wiretap lines; the log file alone proves
    nothing (its mtime keeps moving while its content is stale)."""
    log_rules = 0
    for chain in ("OUTPUT", "INPUT", "FIREWALL_OUT_EULAON", "FIREWALL_OUT_EULAOFF"):
        rules = _ipt_rules(chain)
        if rules:
            log_rules += sum(1 for r in rules if r[2] == "LOG")
    ring = tv("%s dmesg 2>/dev/null | %s grep -c 'TVOUT\\|TVDNS'" % (BB, BB)).strip()
    ring = int(ring) if ring.isdigit() else 0
    lines = tv("%s grep -h -E 'TVOUT|TVDNS' %s 2>/dev/null" % (BB, WIRETAP_LOG), timeout=40)
    hist = {}
    srcs = set()
    for line in lines.splitlines():
        fields = dict(f.split("=", 1) for f in line.split() if "=" in f)
        dst, dpt = fields.get("DST"), fields.get("DPT", "?")
        src = fields.get("SRC")
        if src:
            srcs.add(src)
        if dst:
            hist.setdefault((dst, dpt), 0)
            hist[(dst, dpt)] += 1
    armed = log_rules > 0 and ring > 0
    return armed, ring, hist, srcs, len(lines.splitlines())


def _label(ip):
    if ip in PRIVACY_DOH_IPS:
        return PRIVACY_DOH_IPS[ip]
    if ip in PRIVACY_IP_LABELS:
        return PRIVACY_IP_LABELS[ip]
    # reverse-map from the CURRENT resolver view of the Tier-1 hosts;
    # CDN rotation makes this best-effort, so say so. The resolve cache
    # keeps this at 7 lookups per run, not per IP.
    for h in PRIVACY_TIER1:
        state, ips = _privacy_resolve(h)
        if state == "resolved" and ip in ips:
            return "%s (current resolution; rotation may drift)" % h
    return ""


def _tvfw_marker():
    out = tv("cat /var/local/tvfw.applied_at_boot 2>/dev/null; echo /; "
             "cat /var/local/tvfw.applied 2>/dev/null; echo /; cat /proc/uptime")
    parts = out.split("/")
    if len(parts) < 3:
        return "no marker — tvfw did not complete this boot"
    at_boot = parts[0].strip().split()[0] if parts[0].strip() else ""
    epoch = parts[1].strip().split()[0] if parts[1].strip() else ""
    if not at_boot.isdigit():
        return "no marker — tvfw did not complete this boot"
    # The marker epoch is written with the TV clock, which starts in 2000
    # before NTP — a 9xx-range epoch is 'clock not set', not 'ancient'.
    note = ""
    if not epoch:
        note = " (epoch unreadable)"
    else:
        try:
            if float(epoch) < 1_500_000_000:
                note = " (marker clock unset — pre-NTP write)"
        except ValueError:
            note = " (epoch unreadable)"
    return "tvfw applied at T+%ss this boot%s" % (at_boot, note)


def cmd_privacy(args):
    action = args[0] if args else "status"

    # ---- shared collection (each piece degrades independently) ----
    out_rules = _ipt_rules("OUTPUT")
    resolver = {}
    if action in ("status", "hits"):
        for h in PRIVACY_TIER1:
            resolver[h] = _privacy_resolve(h)
    try:
        armed, ring, hist, srcs, n_lines = _wiretap_summary()
    except Exception:
        armed, ring, hist, srcs, n_lines = False, 0, {}, set(), 0

    if action == "status":
        print("== layer 1: resolver (AdGuard @ the TV's DNS) ==")
        pinned = sum(1 for s, _ in resolver.values() if s == "pinned")
        live = [h for h, (s, _) in resolver.items() if s == "resolved"]
        down = any(s == "unresolved" for s, _ in resolver.values()) and pinned == 0
        for h, (s, ips) in resolver.items():
            print("  %-38s %-11s %s" % (h, s, ", ".join(ips) if ips else ""))
        if live:
            print("  VERDICT: NOT blocking %s — resolver layer has a hole" % ", ".join(live))
        elif pinned:
            print("  VERDICT: blocking (resolver is doing the work — %d/%d hosts pinned)" % (pinned, len(resolver)))
        elif down:
            print("  VERDICT: no answer from the resolver — DNS path itself is down, NOT 'blocked'")
        print("== layer 2: kernel REJECTs (tvfw, OUTPUT) ==")
        print("  %s" % _tvfw_marker())
        if out_rules is None:
            print("  OUTPUT chain unreadable — iptables unavailable")
        elif not out_rules:
            print("  OUTPUT is EMPTY: no Tier-0 (DoH) and no Tier-1 (telemetry) rules.")
            print("  This is the silent-kill state from findings 09 — the kernel")
            print("  backstop is NOT working this boot; the resolver layer is")
            print("  the only active block. Re-source /var/local/tvfw or reboot")
            print("  and re-check (nothing here changes firewall state).")
        else:
            t0 = [r for r in out_rules if r[4] in PRIVACY_DOH_IPS]
            t1 = [r for r in out_rules if r[2] == "REJECT" and r[4] not in PRIVACY_DOH_IPS]
            logs = [r for r in out_rules if r[2] == "LOG"]
            print("  Tier-0 DoH rules: %d | Tier-1 telemetry rules: %d | LOG (wiretap): %d"
                  % (len(t0), len(t1), len(logs)))
            print("  VERDICT: kernel backstop armed")
        ota_rules = _ipt_rules("ALVIDAA_OTA")
        print("== layer 3: DoH bootstrap block (Tier 0) ==")
        if out_rules is None:
            print("  UNAVAILABLE — OUTPUT chain unreadable")
        elif not any(r[4] in PRIVACY_DOH_IPS for r in out_rules):
            print("  dns.google REJECT rules: ABSENT — vidaahub DoH evasion is")
            print("  unimpeded at the kernel; only the resolver layer answers.")
        else:
            for r in out_rules:
                if r[4] in PRIVACY_DOH_IPS:
                    print("  %-8s %-45s pkts %d" % (r[4], PRIVACY_DOH_IPS[r[4]], r[0]))
        print("== layer 4: boot-time rejects / freeze ==")
        ks = tv("[ -f /var/local/hook.off ] && echo present || echo absent").strip()
        pins = tv("%s grep -c '^0\\.0\\.0\\.0 ' /tmp/hosts 2>/dev/null" % BB).strip()
        print("  /tmp/hosts 0.0.0.0 pins: %s | ALVIDAA_OTA chain: %s | kill-switch: %s"
              % (pins or "0", "%d rules" % len(ota_rules) if ota_rules else "absent", ks))
        print("  (freeze detail: alvidaa ota status)")
        print("== wiretap ==")
        if armed:
            print("  ARMED — kernel LOG rules live, dmesg ring carrying TVOUT/TVDNS (%d lines)" % ring)
        else:
            print("  NOT armed — no live LOG rules in the kernel (dmesg ring: %d wiretap lines)." % ring)
            print("  wiretap.log is HISTORICAL evidence only (%d lines); do not quote it as current." % n_lines)
        return 0

    if action == "hits":
        print("== kernel counters (since boot) ==")
        if not out_rules:
            print("  UNAVAILABLE — OUTPUT has no rules this boot (kernel layer not armed).")
            print("  Zero here would be a lie of a different kind: nothing is being counted.")
        else:
            rows = [(r[0], r[4], r[5]) for r in out_rules if r[0] > 0 and r[2] == "REJECT"]
            if not rows:
                print("  REJECT rules present, all counters at 0 — nothing has hit the")
                print("  kernel layer since boot (resolver layer may be absorbing it).")
            for pkts, ip, extra in sorted(rows, reverse=True):
                lbl = _label(ip)
                print("  %-16s %7d pkts  %-12s %s" % (ip, pkts, extra[:12], lbl))
        print("== wiretap log (historical armed windows — NOT since-boot) ==")
        if not hist:
            print("  no TVOUT/TVDNS lines readable" + ("" if armed else " (wiretap not armed)"))
        else:
            era = ", ".join(sorted(srcs)) or "?"
            print("  %d lines from SRC %s — attribute to the armed window, not today" % (n_lines, era))
            for (dst, dpt), n in sorted(hist.items(), key=lambda kv: -kv[1])[:15]:
                lbl = _label(dst)
                print("  %-16s %-4s %6d hits  %s" % (dst, dpt, n, lbl))
            if len(hist) > 15:
                print("  … %d more destinations" % (len(hist) - 15))
        return 0

    if action == "doh":
        print("== DoH / hardcoded-resolver evasion (dns.google) ==")
        doh_rules = [r for r in (out_rules or []) if r[4] in PRIVACY_DOH_IPS and r[2] == "REJECT"]
        if doh_rules:
            total = sum(r[0] for r in doh_rules)
            print("  kernel, since boot : %d attempts REJECTed (Tier-0 rules armed)" % total)
            for r in doh_rules:
                print("    %-8s pkts %d (%s)" % (r[4], r[0], PRIVACY_DOH_IPS[r[4]]))
        else:
            print("  kernel, since boot : UNAVAILABLE — Tier-0 rules not in OUTPUT this boot.")
            print("  The evasion is NOT being counted (and not blocked) at the kernel;")
            print("  only the resolver layer stands. This is not zero attempts — it is")
            print("  no counter. Re-arm tvfw before the next measurement window.")
        if n_lines:
            # Two transports carry the same evasion (findings 09 recorded the
            # :53 count as 'DoH bootstrap'): :443 dns-query (DoH proper) and
            # :53 plain DNS aimed straight at Google, bypassing the LAN resolver.
            doh443 = sum(n for (dst, dpt), n in hist.items()
                         if dst in PRIVACY_DOH_IPS and dpt == "443")
            doh53 = sum(n for (dst, dpt), n in hist.items()
                        if dst in PRIVACY_DOH_IPS and dpt == "53")
            print("  wiretap, historical: %d to tcp/udp :443 (DoH proper), %d to :53 (hardcoded"
                  % (doh443, doh53))
            print("                       plain resolver) — armed-window log, %d lines, era %s"
                  % (n_lines, ", ".join(sorted(srcs)) or "?"))
            print("                       (Tier-0 blocks :443 only — :53 to the hardcoded")
            print("                        resolver is a separate leak if it recurs)")
        state, ips = _privacy_resolve("ter-jrnl-na.vidaahub.com")
        print("  resolver now       : ter-jrnl-na -> %s (%s)"
              % (", ".join(ips) or "no answer", state))
        return 0

    print("usage: alvidaa privacy status|hits|doh")
    return 2



# --- key injection (issue #12) ------------------------------------------------
#
# Transport order: the vendor MQTT ui_service action `sendkey` is PREFERRED —
# it is in the documented action surface (findings 01) — but no session-safe
# route to it exists from the host today: neither the bridge (/api/* in
# bridge/http.go) nor the server (/api/* in vidaa_server.py) exposes a key
# action, and opening a second MQTT session would kick the paired client off
# the broker (AGENTS.md rule). mqtt_route() returns None with that reason and
# the DEVICE lane carries the key: EV_KEY events written to the remote's
# /dev/input node over the root SSH lane (server/tv), the exact path the doom
# lane measured (DOOM.md: BT remote on /dev/input/event3; the MStar IR
# receiver event1 is silent). When a session-safe MQTT route appears,
# mqtt_route() grows a real route and the transport order lights up with no
# call-site change — and the output still says which transport was used,
# because a silent fallback hides a broken MQTT path.
#
# Codes: NOTHING here is verified to reach the launcher. The doom lane measured
# these codes as *readable* from the BT remote on event3, which is a different
# claim from "writing them here moves the UI" — and on 2026-11-13 that second
# claim was measured false for DOWN, RIGHT, ENTER and HOME: zero frame change
# over a 12-second sample each (findings 13 §9). Writing to /dev/input/eventN
# does not inject input at all; the kernel discards it. A /dev/uinput virtual
# keyboard registers and is then ignored by the vendor's key handling.
#
# The flag below therefore means "code measured readable from the remote", not
# "key injection works". Keep it: it is still the right code to send if a lane
# that the vendor listens to ever exists. HOME stays in the table by contract —
# it is the owner's escape — but it is not proven to work through this lane.
KEYS = {
    "up": (103, True), "down": (108, True),
    "left": (105, True), "right": (106, True),
    "ok": (352, True),                                  # measured: not Enter
    "back": (158, False), "home": (102, False), "esc": (1, False),
    "enter": (28, False),
    "volumeup": (115, False), "volumedown": (114, False),
    "power": (116, False),
}
KEY_COUNT_CAP = 5
DEFAULT_DEVICE = "/dev/input/event3"                    # BT remote (DOOM.md)
DEFAULT_DELAY_MS = 150
EV_KEY = 1


def mqtt_route():
    """The session-safe MQTT sendkey route, or (None, reason). The reason is
    printed by cmd_key when the device lane is used — a silent fallback hides
    a broken MQTT path."""
    return None, ("the vendor sendkey action has no session-safe route from "
                  "the host (no bridge or server endpoint expresses it, and a "
                  "second MQTT session would kick the paired client off the "
                  "broker)")


def key_event_bytes(code, value):
    """One 16-byte little-endian input_event as armv7 lays it out: timeval
    (4+4, zeroed — the kernel stamps evdev writes), type EV_KEY, u16 code,
    s32 value. Zero timeval keeps the bytes deterministic for the tests."""
    return struct.pack("<LLHHi", 0, 0, EV_KEY, code, value)


def key_tap_cmd(code, device):
    """Press + release for one key tap, as two printf '%b' writes — %b
    interprets the escapes in the ARGUMENT, so a 0x25 ('%') byte cannot be
    eaten as a conversion spec the way it would inside a format string."""
    esc = lambda b: "".join("\\x%02x" % c for c in b)
    return ("printf '%%b' '%s' > %s ; printf '%%b' '%s' > %s"
            % (esc(key_event_bytes(code, 1)), device,
               esc(key_event_bytes(code, 0)), device))


def key_command(name, count, delay_ms, device):
    """The whole SSH command for a key sequence: tap, delay, tap..."""
    code = KEYS[name][0]
    parts = [key_tap_cmd(code, device)]
    for _ in range(count - 1):
        parts.append("sleep %.2f" % (delay_ms / 1000.0))
        parts.append(key_tap_cmd(code, device))
    return " ; ".join(parts)


def cmd_key(args):
    if not args or args[0].startswith("--"):
        print("usage: alvidaa.py key <NAME> [--count N] [--delay MS] [--device /dev/input/eventN]")
        print("keys: %s" % ", ".join(sorted(KEYS)))
        return 2
    name, count, delay_ms, device = args[0], 1, DEFAULT_DELAY_MS, DEFAULT_DEVICE
    i = 1
    while i < len(args):
        if args[i] == "--count":
            i += 1
            count = int(args[i])
        elif args[i] == "--delay":
            i += 1
            delay_ms = int(args[i])
        elif args[i] == "--device":
            i += 1
            device = args[i]
        else:
            print("unknown flag: %s" % args[i])
            return 2
        i += 1
    if name not in KEYS:
        print("unknown key: %s" % name)
        print("known keys: %s" % ", ".join(sorted(KEYS)))
        return 2
    if count > KEY_COUNT_CAP:
        print("--count is capped at %d: a key tap, not a hold" % KEY_COUNT_CAP)
        return 2
    count = max(1, count)
    code, verified = KEYS[name]
    route, reason = mqtt_route()
    if route is not None:
        route(name, count, delay_ms)
        print("transport: mqtt (sendkey via the existing session)")
        return 0
    print("transport: device (%s) — MQTT sendkey preferred but unavailable: %s"
          % (device, reason))
    print("key: %s (code %d, %s) x%d" % (name, code,
          "code measured readable from the remote; NOT verified to move the UI"
          if verified
          else "GUESS: standard Linux HID, never measured on this remote",
          count))
    print(tv(key_command(name, count, delay_ms, device), timeout=25))
    print("done — if nothing happened, the remote may sit on another event "
          "node: check /proc/bus/input/devices, or pass --device")
    return 0


# --------------------------------------------------------------------- power
# Standby / reboot / status (issue #11). Reboot is how a boot-persistence
# change is proven; standby lets a script wait for the TV instead of a human
# polling the screen. Findings 12 §4: the /etc/profile reboot route can hang
# forever, so the direct busybox `reboot -f` is the lane. The kill-switch
# check lives in the same command: a reboot with a broken hook is how a TV
# ends up in a loop.
#
# Wake-from-standby over the network is NOT measured on the reference unit.
# standby probes TCP 2222 after the action and reports what it sees —
# reachable or unreachable — never assumed. There is no network-visible
# panel read on this hardware, so status says so instead of inventing one;
# uptime and the port probes are the signals a script can wait on.
def _tcp_open(port, timeout=4):
    s = socket.socket()
    s.settimeout(timeout)
    try:
        s.connect((TV, port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def _uptime_tv():
    out = tv("cat /proc/uptime 2>/dev/null").strip().split()
    try:
        return float(out[0])
    except (IndexError, ValueError):
        return None


def _hook_safe_for_reboot():
    """(safe, reason) — a reboot is safe when the hook cannot loop the TV:
    the kill-switch disarms the hook at next boot, or the hook has been
    verified (tvfw applied this boot, or the bridge reports the watchdog
    alive). hook.off absent + never verified = refuse."""
    if _exists("/var/local/hook.off"):
        return True, "kill-switch /var/local/hook.off is present — the hook is disarmed at next boot"
    marker = tv("cat /var/local/tvfw.applied_at_boot 2>/dev/null").strip()
    # the marker's first token is a float (T+seconds, e.g. "12.34") — the ota
    # reader floats() it for the same reason; isdigit() would reject it
    if marker:
        try:
            applied = float(marker.split()[0])
            return True, "tvfw applied this boot (T+%.2fs) — the hook ran" % applied
        except ValueError:
            pass
    try:
        hook = (fetch("/api/debug").get("hook") or {})
        if hook.get("watchdogAlive") and not hook.get("killSwitch"):
            return True, "hook verified alive via the bridge (watchdog alive, kill-switch absent)"
    except Exception:
        pass
    return False, ("/var/local/hook.off is absent and the hook has never been verified "
                   "(no tvfw marker this boot, bridge hook state unreadable)")


def cmd_power(args):
    action = args[0] if args else "status"

    if action == "status":
        uptime = _uptime_tv()
        if uptime is None:
            print("uptime      : UNREADABLE — /proc/uptime missing or the lane is down")
        else:
            print("uptime      : %.0f s (%.1f h)" % (uptime, uptime / 3600.0))
        print("ssh 2222    : %s" % ("open" if _tcp_open(2222) else "closed"))
        print("bridge 8770 : %s" % ("open" if _tcp_open(8770) else "closed"))
        print("panel state : unmeasured — no network-visible panel read exists on")
        print("              this hardware; uptime and the ports above are the")
        print("              signals a script can wait on for 'the TV came back'")
        print("wake note   : wake-from-standby over the network is UNMEASURED on")
        print("              the reference unit — do not script against it")
        return 0

    if action == "standby":
        # The MQTT power action where available — through the bridge's own
        # session (one MQTT server per TV; never a second one).
        status, body = fetch_raw("/api/power?state=standby")
        text = body.decode(errors="replace") if isinstance(body, bytes) else str(body)
        try:
            result = json.loads(text)
        except Exception:
            result = None
        if not (isinstance(result, dict) and result.get("ok")):
            print("standby refused: no MQTT power action on this bridge (%s %s)"
                  % (status, text.strip()[:60]))
            print("  the bridge routes carry no /api/power (checked); a second MQTT")
            print("  session would kick the paired client — one session per TV.")
            print("  the device lane would inject the power keycode, which on this")
            print("  remote is a GUESS (116, key-injection's table) and wake-from-")
            print("  standby is unmeasured — refused rather than guessed. When the")
            print("  bridge grows /api/power, this command uses it, no call-site change.")
            return 1
        print("standby sent via the bridge MQTT session (%s)" % status)
        # Wake probe: measure, never assume.
        reachable = _tcp_open(2222, timeout=3) or _tcp_open(2222, timeout=3)
        if reachable:
            print("wake probe  : TV still reachable on 2222 after standby — network")
            print("              wake is POSSIBLE (probe; unverified for scripting)")
        else:
            print("wake probe  : TV dropped off the network after standby —")
            print("              wake-from-standby is NOT reachable over the network;")
            print("              physical power is required to bring it back")
        return 0

    if action == "reboot":
        yes = "--yes" in args
        safe, reason = _hook_safe_for_reboot()
        if not safe:
            print("ERROR: refusing reboot — %s" % reason)
            print("  a reboot with a broken hook can loop the TV. Safe path: disarm")
            print("  the hook first (create /var/local/hook.off), then reboot.")
            return 1
        if not yes:
            print("refusing: reboot needs --yes — it drops the SSH lane and restarts the TV")
            print("usage: alvidaa power reboot --yes")
            return 2
        print("reboot issued (%s reboot -f; findings 12 §4: the /etc/profile route hangs)" % BB)
        try:
            tv("%s reboot -f" % BB, timeout=15)
        except (subprocess.TimeoutExpired, OSError):
            pass  # the connection dropping mid-command is the reboot working
        print("verify with 'alvidaa power status': uptime resets, ssh 2222 reopens")
        return 0

    print("usage: alvidaa power standby|reboot|status")
    return 2


COMMANDS = {
    "sys": cmd_sys,
    "logs": cmd_logs,
    "net": cmd_net,
    "doctor": cmd_doctor,
    "open": cmd_open,
    "apps": cmd_apps,
    "sources": cmd_sources,
    "key": cmd_key,
    "power": cmd_power,
    "ota": cmd_ota,
    "privacy": cmd_privacy,
    "push": cmd_push,
    "pull": cmd_pull,
    "backup": cmd_backup,
    "restore": cmd_restore,
}


def main(argv):
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__.strip())
        print("\nsubcommands: %s" % ", ".join(sorted(COMMANDS)))
        return 0
    fn = COMMANDS.get(argv[0])
    if fn is None:
        print("unknown command: %s" % argv[0])
        return 2
    try:
        return fn(argv[1:]) or 0
    except urllib.error.URLError as e:
        print("bridge unreachable: %s" % e)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
