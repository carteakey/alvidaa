# alvidaa findings — who runs what — the privilege map (recon §10.4, 10.7–10.8)

> Split from the original FINDINGS.md lab notebook. Canonical record; the blog and STORY.md draw from these.

### 10.4 Who runs what (privilege map)

- **Verified boot is active**: rootfs is dm-verity squashfs (ro), cmdline carries
  `androidboot.vbmeta.device_state=locked`, `verifiedbootstate=green`, and ro
  partitions are mounted via MTK `mtk_mount` with a vbmeta reference partition.
  System partitions are off-limits — the lane is rw mounts only.
- **rw + exec-flagged**: `/APPS` (p41), `/data` (p27), `/var/local` (p39),
  `/var/tvservice` (p35), `/OAD` (p42, OTA staging — and `/OAD` sits on
  `login.sh`'s PATH), plus tmpfs (`/dev/shm`, `/var/run`, `/var/log`).
  rw + `noexec`: `/cache`, `/certificate`. Everything else ro.
- Accounts of interest (`/etc/passwd`): `root` shell = `/usr/local/scripts/rootlogin.sh`
  (root-only readable); **`cli` is UID 0**, shell = `/etc/cli_login.sh` (also
  root-only) — the classic Hisense debug shell, gate contents unknown;
  `television` (uid 300, the UI) shell = `/usr/local/scripts/login.sh`;
  an `sshd` account exists (uid 999) — server presence unconfirmed;
  phoenix = `UhisPhoenix` uid 314, **no capabilities, no seccomp**, PPid 306.
- **The UART console is live**: `inittab` respawns `getty -L ttyS0 115200` —
  a USB-TTL adapter on the service port reaches a real login prompt gated only by
  the (unreadable) login scripts.
- Boot chain: `rcS` → `mount -a` → `rcS.utopia.linux` (mounts, insmods, then
  `/usr/local/scripts/start-hisense.sh`, `setenforce 0`, sources
  `/config/daemon_profile` and `/application/network`) → `rcS.ko.linux`;
  `otaflag=170` in cmdline switches the tail to `rcS.OTA`/`rc.ota` — the `/OAD` lane.

### 10.5 Raw API probing

- The shim's request is reproducible directly from any page: XHR to
  `localhost:9009` with the captured shape (v4 `report.wire` has it verbatim).
  Fuzzing api names against that shape cleanly separates supported from
  unsupported (`"Not supported api"`).
- `phoenix.server.js` — the backend's own source, on our writable `/APPS` — is
  readable via `../APPS/pkgs/tv.vidaa.jsservice.basic/CHA/phoenix.server.js`;
  it contains the complete action table (v5 dump pending).

### 10.6 Lane assessment

1. **Persistent code exec as uid 314**: phoenix runs JS from our writable `/APPS`.
   If the package isn't re-extracted at boot, augmenting `phoenix.server.js` =
   arbitrary code exec at every service restart. Pending: the v5 dump + verifying
   `/APPS` package persistence across reboots.
2. **Root**: needs a root-run service that consumes attacker-controlled files from
   a rw mount (map pending from `start-hisense.sh`), the `/OAD`/OTA lane
   (`otaflag=170` → `rcS.OTA`/`rc.ota`), a kernel route on the MTK box, or the
   UART gate (physical; scripts are root-only readable).
3. Everything alvidaa does today minus MQTT: uid-314 read/write already covers
   app install and config without the RemoteNow channel.

### 10.7 v5 results: the backend source, the boot map, and the root trigger

- **The raw API needs no auth**: `POST http://localhost:9009/service/hiutils` with
  `{"api":"fileRead","args":{...}}` works with **no identifier header at all** from
  any page. The OPTIONS handler answers `Access-Control-Allow-Origin: *` — any page
  the TV browser ever opens can use the full file bridge. (One more reason the
  TV browser should never see the open web.)
- phoenix.server.js is just a framework (Router + `ServiceManager` + WS on 9888
  with `./cert/cert.{key,pem}`); the real action table lives in service packages
  loaded by `ServiceManager.init()` from paths set by env vars (`BASIC_JS_LIB`,
  `PHOENIX_LIB`). Those env vars are readable via `/proc/self/environ` — fileRead
  runs *as* phoenix, so it can read its own process env (v6).
- No dir-listing or exec-class api exists in the guessed-name space (17 names,
  all `"Not supported api"`); the authoritative table is in the service JS, not
  the guessed list.
- **The boot map** (`start-hisense.sh`, run as root): mounts the rw partitions,
  then `/usr/local/bin/deploy` (MW-deploy), `deploy_oem_data.sh` (OEM-deploy),
  `start-security.sh`, `start-network.sh`, `superwatch` (the supervisor that
  respawns phoenix — explains the crash recovery), `secure_exec`-wrapped
  `masman`/`systemserver`/`tvmain`/`startgui.sh`, and three background watchers:
  `check_usb_key.sh`, `checkEmergentOTA.sh`, and the IPK trigger:
  ```sh
  if [ -e "/APPS/pkgs/NewUpdatedIPK.txt" ]; then
      /usr/local/scripts/set_ipk_path.sh || true
      rm -f "/APPS/pkgs/NewUpdatedIPK.txt"
  fi
  ```
  `/APPS` is the partition the bridge can write. If `set_ipk_path.sh` executes or
  sources anything from `/APPS/pkgs`, that is **root code exec at next boot,
  no hardware** (v6 reads it). Also: `/var/tvservice/reset_working` (rw for us)
  triggers a root factory-reset flow — do not create that file casually.
- `chmod 777 /var/local` at boot; `/dev/ttyS0` is `chown root:808` — the UART
  login prompt is group-accessible, still gated by the login scripts.

### 10.8 v6 results: the root-side consumers of our writable mounts

- **`set_ipk_path.sh` is a symlink flipper, not an installer**: it reads
  `/APPS/pkgs/NewUpdatedIPK.txt` (writable by us) and, as root, for each listed
  existing dir creates `<dir>/current → <basename>` (the A/B `CHA`/`CHB` scheme).
  No script exec — but any boot-time consumer that resolves a package through
  `current` can be repointed at a directory we control. `SSL_CERT_FILE` already
  resolves via `current`; whether JS-service pkgs load via `current` or fixed
  `CHA/` is what `start-kilby.sh` will answer (v7).
- **`deploy_oem_data.sh` is a root-run arbitrary file deployer**: it copies
  everything under `/var/local/oem/…` — and `start-hisense.sh` does
  `chmod 777 /var/local`, i.e. the bridge can write it directly — into
  `/hidata/factory`, `/hidata/model`, `/var/local/dataModule/current`,
  `/vendor/tvconfig/config` (remounted rw by the script itself!) and
  `/serialdata/common/{logos,EPOS}`, then runs `security-dac-oem.sh`. The guarded
  import path (`import_oem_data.sh`: encrypted `OEM*.zip` via `dectool`, MD5,
  white-name ini) only applies to USB import — irrelevant, since the bridge
  writes the staging dir directly. Open question: what *executes* from those
  destinations; `oem_files_white_name.ini` enumerates the legitimate ones (v7).
- **The UART console gate is a readable script**: `check_usb_key.sh` sources
  `/usr/local/scripts/key_check.sh` and calls `check_key_to_open_console`
  (v7 reads it — if the gate is a flag file on rw storage, the console opens
  without hardware).
- **`checkEmergentOTA.sh`** only fires `rescueOTA` when the UI fails to flag
  ready within 60s — emergency lane, not primary.
- phoenix env (`/proc/self/environ`, readable by the bridge since it runs as
  phoenix): `ROOT_SYSTEM_JS=/APPS/pkgs/tv.vidaa.jsservice.system/CHA/` (the
  second JS service pkg — where the real fileRead implementation lives),
  `PHOENIX_BIN_PKG=/opt/pkgs/tv.vidaa.app.phoenix/`,
  `SSL_CERT_FILE=/APPS/pkgs/tv.vidaa.phony.keystore/current/common/cacerts.pem`
  (a `current` consumer), WSS certs at
  `/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/cert/cert.{key,pem}` (readable text),
  `PWD` = the CHA dir, and `start-security.sh` is root-only (EACCES).
