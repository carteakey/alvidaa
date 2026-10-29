#!/usr/bin/env python3
"""vidaa-home control server: serves the TV page, bridges it to the TV.

One MQTT/TLS connection to the TV (RemoteNow, port 36669) + one HTTP server
(port 8765) that serves launcher/ and upgrades GET /ws to WebSocket. The page
is stateless: everything it renders is pushed over the WS as JSON.

Auth: tokens.json from pairing (pair.py) — dynamic username + access token,
refreshed automatically from the refresh token. Falls back to the legacy
static login on old firmware when no tokens exist.

Also runs the home watcher (config.watcher): relaunches the launcher whenever
the TV lands on VIDAA's own home screen — the closest VIDAA gets to a default
launcher, since VIDAA has no default-launcher setting.

Usage: venv/bin/python server/vidaa_server.py [tv-ip] [port]
Config: server/config.json (hidden apps, renames, watcher toggle)
"""
import base64
import hashlib
import json
import os
import queue
import socket
import ssl
import struct
import sys
import threading
import time
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import paho.mqtt.client as mqtt

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "launcher")
KEYS = os.path.join(HERE, "keys")
TOKENS_FILE = os.path.join(KEYS, "tokens.json")
CONFIG_FILE = os.path.join(HERE, "config.json")
HOST = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("HISENSE_HOST", "192.168.0.12")
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8765
MQTT_PORT = 36669
LEGACY_DEVICE = "VIDAALAUNCHER$normal"

def cert_paths():
    modern = (os.path.join(KEYS, "vidaa_cert.pem"), os.path.join(KEYS, "vidaa_key.pem"))
    if all(os.path.isfile(p) for p in modern):
        return modern
    return (os.path.join(KEYS, "rcm_certchain_pem.cer"), os.path.join(KEYS, "rcm_pem_privkey.pkcs8"))

def load_tokens():
    try:
        with open(TOKENS_FILE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None

def save_tokens(t):
    with open(TOKENS_FILE, "w") as f:
        json.dump(t, f, indent=2)
    os.chmod(TOKENS_FILE, 0o600)

def load_config():
    cfg = {"hidden": [], "rename": {}, "watcher": {"enabled": True, "app": "Home", "interval": 3, "cooldown": 6}}
    try:
        with open(CONFIG_FILE) as f:
            user = json.load(f)
        if isinstance(user.get("hidden"), list):
            cfg["hidden"] = user["hidden"]
        if isinstance(user.get("rename"), dict):
            cfg["rename"] = user["rename"]
        if isinstance(user.get("watcher"), dict):
            cfg["watcher"].update(user["watcher"])
    except (OSError, ValueError):
        pass
    return cfg

def tls_context():
    cert, key = cert_paths()
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    ctx.load_cert_chain(certfile=cert, keyfile=key)
    return ctx

def refresh_tokens():
    """Synchronous token refresh using the stored refresh token. Returns new dict or None."""
    t = load_tokens()
    if not t or not t.get("refreshtoken"):
        return None
    out = {}
    done = threading.Event()

    def on_connect(client, userdata, flags, reason_code, properties=None):
        rc = int(getattr(reason_code, "value", reason_code))
        if rc != 0:
            done.set()
            return
        client.subscribe([
            (f"/remoteapp/mobile/{t['_client_id']}/platform_service/data/tokenissuance", 0),
            (f"/remoteapp/mobile/{t['_client_id']}/platform_service/data/gettoken", 0),
        ])
        client.publish(f"/remoteapp/tv/platform_service/{t['_client_id']}/data/gettoken",
                       json.dumps({"refreshtoken": t["refreshtoken"]}))

    def on_message(client, userdata, msg):
        try:
            data = json.loads(msg.payload.decode())
        except Exception:
            return
        if isinstance(data, dict) and data.get("accesstoken"):
            out.update(data)
            done.set()

    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=t["_client_id"],
                    clean_session=True, protocol=mqtt.MQTTv311)
    c.username_pw_set(username=t["_username"], password=t["refreshtoken"])
    c.tls_set_context(tls_context())
    c.on_connect = on_connect
    c.on_message = on_message
    try:
        c.connect(HOST, MQTT_PORT, 30)
        c.loop_start()
        done.wait(10)
    except Exception:
        pass
    finally:
        try:
            c.loop_stop()
            c.disconnect()
        except Exception:
            pass
    if out.get("accesstoken"):
        out["_profile"] = t["_profile"]
        out["_username"] = t["_username"]
        out["_client_id"] = t["_client_id"]
        save_tokens(out)
        print("token refreshed", flush=True)
        return out
    return None

# ---------------------------------------------------------------- MQTT bridge

class TVBridge:
    """One shared MQTT connection; publishes actions, records state pushes."""

    def __init__(self, host):
        self.host = host
        self.q = queue.Queue()
        self.listeners = []
        self.connected = threading.Event()
        self.state = None
        self.apps = None
        self.sources = None
        self.session = load_tokens()
        if self.session:
            self.device = self.session["_client_id"]
            username, password = self.session["_username"], self.session.get("accesstoken", "")
        else:
            self.device = LEGACY_DEVICE
            username, password = "hisenseservice", "multimqttservice"
        self.username = username
        self.c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                             client_id=self.device, clean_session=True, protocol=mqtt.MQTTv311)
        self.c.username_pw_set(username=username, password=password)
        self.c.tls_set_context(tls_context())
        self.c.on_connect = self._on_connect
        self.c.on_message = self._on_message
        self.last_launch = 0.0

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        rc = int(getattr(reason_code, "value", reason_code))
        if rc != 0:
            print(f"MQTT rejected (rc={rc}) — token expired? restart to refresh", flush=True)
            return
        # exact topics only — this firmware denies wildcard subscriptions
        base = f"/remoteapp/mobile/{self.device}/"
        client.subscribe([
            (base + "ui_service/data/state", 0),
            (base + "ui_service/data/gettvstate", 0),
            (base + "ui_service/data/sourcelist", 0),
            (base + "ui_service/data/applist", 0),
            (base + "ui_service/data/launchapp", 0),
            (base + "platform_service/data/tokenissuance", 0),
            (base + "platform_service/data/gettoken", 0),
            ("/remoteapp/mobile/broadcast/ui_service/state", 0),
        ])
        self.connected.set()

    def _on_message(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode("utf-8")) if msg.payload else None
        except (ValueError, UnicodeDecodeError):
            payload = msg.payload
        self.q.put((msg.topic.rsplit("/", 1)[-1], payload))
        if isinstance(payload, dict):
            topic = msg.topic.rsplit("/", 1)[-1]
            if topic == "state" and "statetype" in payload:
                self.state = payload
                self._emit({"t": "tvstate", "state": payload.get("statetype")})

    def _emit(self, event):
        for fn in list(self.listeners):
            try:
                fn(event)
            except Exception:
                pass

    def connect(self, timeout=10):
        self.c.connect(self.host, MQTT_PORT)
        self.c.loop_start()
        if not self.connected.wait(timeout):
            # try one token refresh before giving up
            if self.session and refresh_tokens():
                self.session = load_tokens()
                self.c.username_pw_set(username=self.session["_username"],
                                       password=self.session["accesstoken"])
                self.c.connect(self.host, MQTT_PORT)
                if self.connected.wait(timeout):
                    return
            raise TimeoutError(f"MQTT connect to {self.host} failed")
        with open(os.path.join(HERE, ".host"), "w") as f:
            f.write(self.host)

    def disconnect(self):
        try:
            self.c.disconnect()
        finally:
            self.c.loop_stop()

    def call(self, service, action, payload=None):
        if isinstance(payload, dict):
            payload = json.dumps(payload)
        self.c.publish(f"/remoteapp/tv/{service}/{self.device}/actions/{action}", payload or "").wait_for_publish()

    def ask(self, service, action, payload=None, want=list, timeout=6.0):
        self.q.queue.clear()
        self.call(service, action, payload)
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                _, p = self.q.get(timeout=max(0.1, deadline - time.time()))
            except queue.Empty:
                break
            if isinstance(p, want):
                return p
        raise TimeoutError(f"no answer for {service}/{action}")

    def apps_list(self):
        if self.apps is None:
            self.apps = self.ask("ui_service", "applist")
        return self.apps

    def sources_list(self):
        self.sources = self.ask("ui_service", "sourcelist")
        return self.sources

    def visible_apps(self):
        """applist with config.json filtering applied."""
        cfg = load_config()
        hidden = {h.strip().lower() for h in cfg.get("hidden", [])}
        renames = {k.lower(): v for k, v in cfg.get("rename", {}).items()}
        out = []
        for a in self.apps_list():
            name = a.get("name", "")
            if not name or name.strip().lower() in hidden:
                continue
            out.append({"name": renames.get(name.strip().lower(), name)})
        return out

    def launch(self, name):
        want = name.strip().lower()
        app = next((a for a in self.apps_list() if a.get("name", "").lower() == want), None)
        if app is None:
            app = next((a for a in self.apps_list() if want in a.get("name", "").lower()), None)
        if app is None:
            return {"ok": False, "error": f"app not found: {name}"}
        self.call("ui_service", "launchapp", {k: app[k] for k in ("appId", "name", "url", "urlType", "storeType") if k in app})
        return {"ok": True, "launched": app.get("name")}

    def source(self, sid):
        for s in self.sources_list():
            if str(s.get("sourceid")) == str(sid) or (s.get("sourcename") or "").lower() == str(sid).lower():
                self.call("ui_service", "changesource", s)
                return {"ok": True, "switched": s.get("displayname") or s.get("sourcename")}
        return {"ok": False, "error": f"source not found: {sid}"}

    def snapshot(self):
        out = {"t": "hello", "state": (self.state or {}).get("statetype")}
        try:
            out["apps"] = self.visible_apps()
        except Exception as e:
            out["apps"], out["apps_error"] = None, str(e)
        try:
            out["sources"] = [{"id": s.get("sourceid"),
                               "name": s.get("displayname") or s.get("sourcename"),
                               "signal": s.get("is_signal") == "1" or s.get("has_signal") == "1"}
                              for s in self.sources_list()]
        except Exception as e:
            out["sources"], out["sources_error"] = None, str(e)
        return out

    # ---- home watcher: the de-facto default launcher

    def watcher_loop(self):
        while True:
            try:
                cfg = load_config().get("watcher", {})
                if cfg.get("enabled", True) and self.connected.is_set():
                    st = (self.state or {}).get("statetype")
                    if st == "remote_launcher" and time.time() - self.last_launch > cfg.get("cooldown", 6):
                        self.last_launch = time.time()
                        r = self.launch(cfg.get("app", "Home"))
                        print(f"watcher: VIDAA home detected -> {r}", flush=True)
                time.sleep(cfg.get("interval", 3))
            except Exception as e:
                print(f"watcher: {e.__class__.__name__}: {e}", flush=True)
                time.sleep(5)

# ------------------------------------------------------------------ WebSocket

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

class WS:
    def __init__(self, rfile, wfile):
        self.rfile, self.wfile = rfile, wfile
        self.open = True

    @staticmethod
    def accept_key(key):
        return base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()

    def recv_text(self):
        hdr = self.rfile.read(2)
        if len(hdr) < 2:
            self.open = False
            return None
        opcode, length = hdr[0] & 0x0F, hdr[1] & 0x7F
        if length == 126:
            length = struct.unpack(">H", self.rfile.read(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", self.rfile.read(8))[0]
        mask = self.rfile.read(4) if hdr[1] & 0x80 else b"\x00\x00\x00\x00"
        data = self.rfile.read(length)
        if hdr[1] & 0x80:
            data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        if opcode == 8:
            self.open = False
            return None
        return data.decode("utf-8", "replace")

    def send_text(self, text):
        data = text.encode()
        n = len(data)
        header = bytes([0x81])
        if n < 126:
            header += bytes([n])
        elif n < 65536:
            header += bytes([126]) + struct.pack(">H", n)
        else:
            header += bytes([127]) + struct.pack(">Q", n)
        self.wfile.write(header + data)
        self.wfile.flush()

# ---------------------------------------------------------------- HTTP server

class Handler(SimpleHTTPRequestHandler):
    bridge = None
    protocol_version = "HTTP/1.1"

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}

        if u.path == "/ws":
            key = self.headers.get("Sec-WebSocket-Key")
            if not key or "websocket" not in (self.headers.get("Upgrade") or "").lower():
                self.send_error(400, "websocket upgrade required")
                return
            self.send_response(101, "Switching Protocols")
            self.send_header("Upgrade", "websocket")
            self.send_header("Connection", "Upgrade")
            self.send_header("Sec-WebSocket-Accept", WS.accept_key(key))
            self.end_headers()
            self.connection.settimeout(0.5)
            ws = WS(self.rfile, self.wfile)
            ws.send_text(json.dumps(self.bridge.snapshot()))
            def push(event):
                try:
                    ws.send_text(json.dumps(event))
                except Exception:
                    try: self.bridge.listeners.remove(push)
                    except ValueError: pass
            self.bridge.listeners.append(push)
            while ws.open:
                try:
                    text = ws.recv_text()
                except socket.timeout:
                    continue
                except Exception:
                    break
                if text is None:
                    break
                try:
                    m = json.loads(text)
                except ValueError:
                    continue
                if m.get("t") == "launch":
                    ws.send_text(json.dumps(self.bridge.launch(m.get("name", ""))))
                elif m.get("t") == "source":
                    ws.send_text(json.dumps(self.bridge.source(m.get("id", ""))))
            try:
                self.bridge.listeners.remove(push)
            except ValueError:
                pass
            self.close_connection = True  # socket timeout killed keep-alive
            return

        if u.path == "/api/state":
            return self._json({"ok": True, "state": (self.bridge.state or {}).get("statetype")})
        if u.path == "/api/launch":
            return self._json(self.bridge.launch(q.get("name", "")))
        if u.path == "/api/source":
            return self._json(self.bridge.source(q.get("id", "")))
        return super().do_GET()

def main():
    bridge = TVBridge(HOST)
    try:
        bridge.connect()
        print(f"connected to TV at {HOST}:{MQTT_PORT} "
              f"({'token auth' if bridge.session else 'legacy auth'})", flush=True)
    except Exception as e:
        print(f"TV not reachable ({e}); serving page in offline mode", flush=True)
    Handler.bridge = bridge
    threading.Thread(target=bridge.watcher_loop, daemon=True).start()
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"launcher at http://<this-host>:{PORT}/  (WS at /ws) — watcher running", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        bridge.disconnect()

if __name__ == "__main__":
    main()
