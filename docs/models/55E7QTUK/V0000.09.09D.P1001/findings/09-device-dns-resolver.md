# 09 — Device DNS resolver (dnsmasq, lane W) + the boot re-arm failure states (2026-11-09)

Owner-scoped ad/telemetry blocking moves from per-IP `REJECT`s to a
domain-level resolver: **dnsmasq 2.91 (static armv7)** shipped by the
`re.installer` postinst, answering NXDOMAIN for the
`ADSFW_HOSTS`-derived families over loopback. Deployed and verified
pre-reboot on this unit; the same-day caveat — **the boot re-arm lanes
did not re-fire after the forced reboot**, so the resolver (and
everything root-scoped) currently needs a manual re-arm; every failure
state, evidence and probe is recorded below. Untracked-era artifacts:
`tools/u7q/scripts/build_dnsmasq.sh` (zig crossbuild),
`tools/u7q/bin/dnsmasq` (gitignored, built locally), the dns stage in
`tools/u7q/scripts/make_min_installer.py` v1.0.4,
`launcher/phase3-arm14.html` (deploy page), `launcher/phase3-diag-e7q.html`
(diagnostics), `launcher/hookswap-e7qtuk.html` (hook v2 swap).

## Phase-0 probe (pre-deploy, root read via the dropbear lane)

- `/etc/resolv.conf` is a **symlink to `/var/local/etc/resolv.conf`**
  (rw p49) — resolver file is directly writable (`cp -f` follows the
  link); busybox has no `readlink` applet.
- `iptables` at `/usr/local/bin/iptables`; `nat OUTPUT` policy ACCEPT,
  empty; **owner match module present** (probe rule insert/delete OK).
- `busybox mount -o bind` supported ([r]bind); `pidof` present.
- Package baseline: `re.installer 1.0.0` (mtk9603).

## The dns stage (v1.0.4, backgrounded, boot-timed `sleep 25`)

Lane order **W → A → B**, decided at runtime, never both mounted:

1. **Capture** the vendor upstream first — `resolv.conf.orig` in
   `/APPS/.re_sshd` — guarded by `grep nameserver 127.0.0.1` so our own
   lane is never captured back as upstream.
2. **Lane W**: `cp -f $D/resolv.conf.w /etc/resolv.conf` (the symlink
   target on rw flash) → `nameserver 127.0.0.1`.
3. **Lane A**: busybox `mount -o bind` of a one-line file over
   `/etc/resolv.conf` (no underlying write), with a stale-bind umount
   rinse first.
4. **Lane B**: nat `REDIRECT --to-ports 5353` (udp+tcp, `-C`-guarded) +
   `-m owner --uid-owner 314 -j RETURN` exempting the resolver's own
   upstream queries (loop-free); verified before use via a
   filter-table insert/delete of the same match.
5. dnsmasq runs `--no-daemon &` — **this static build rejects
   `--daemon` at option parse** ("bad command line options"; v1.0.3
   ran the stage with `--daemon` and the safe-degrade path restored the
   vendor lane within ~30 s of boot — the degrade design already
   proved itself in production).
6. **Verify** (`nslookup` via 127.0.0.1): benign
   `vidaa-base-auth-eu.vidaahub.com` must resolve through upstream;
   blocked `rsc-ads.vidaahub.com` must come back NXDOMAIN. On failure
   after 4 tries the stage **restores the vendor resolver** (flush
   REDIRECTs / umount / restore file) and logs `DNS DEGRADE`.
7. `dnsblock.conf` is generated at IPK-build time from `ADSFW_HOSTS`
   (`address=/domain/` per family) — single source of truth, no second
   host list; `--local-service` keeps answers off-LAN.

## Deploy + measured result (pre-reboot, verified 2026-11-09 ~13:5x–14:1x)

- Delivery over the root-SSH pipe (`cat ipk | ssh … 'cat > file'`, md5
  verified) + **`opkg install` needs `LD_LIBRARY_PATH=/usr/local/lib`**
  (vendored opkg needs `libarchive.so.13`, absent from a dropbear PATH),
  and the package's `Architecture` must be **mtk9603** (the builder's
  default mtk9655 gets rejected: "incompatible architecture").
- Upgrade chain 1.0.0 → 1.0.1 → 1.0.2 → 1.0.3 → 1.0.4 all confirmed
  ("Upgrading… Configuring…"); each configure re-ran the postinst.
- Measured steady state before the reboot: `resolv.conf` = loopback;
  `nslookup rsc-ads…127.0.0.1` → **NXDOMAIN**; benign resolve works;
  15 OUTPUT REJECTs (3 freeze + 12 adsfw) present; NO nat rules
  (lane W, no iptables needed); dnsmasq pid + dnsmasq.log present.
- **bump-order lesson**: the dns artifacts must be `mv`'d into
  `$D` **before** the stages' gates evaluate — v1.0.1/1.0.2's stage
  order ran "dns missing" on first configure (the mv step came later in
  the script); v1.0.3 reordered (mv → stages).
- The `--arch mtk9603` flag (and lib path) belong in the docs. The
  phase3-arm14 page lane is the intended deploy vehicle but was inert
  today — see failure states.

## Failure states discovered the same day (all evidence via root reads
or the browser page lane)

1. **`busybox reboot -f` is NOT a working reboot recipe on 09.09D:**
   the kernel reset took the whole session down and the TV came back
   with the **network stack dark** (8008 closed on every address;
   ICMP/MQTT fine on later cycles). The findings-12 recipe (`reboot -f`)
   belongs to the 09.01 reference build — 55E7QTUK's verified recovery
   is the owner mains cycle (as findings/08 recorded), and a clean
   remote reboot command remains unverified on this branch.
2. **The serviceList autostart lane went silent.**
   `/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/re_sshd` package +
   `serviceList.json` entry (autoStart) are intact (root-era reads),
   and the module **loads** (`/tmp/re_sshd_boot.log` "module loaded",
   seen at 14:11 after a configure), but `boot_marker.txt` — written
   only by `start()` — is **ENOENT through every boot today**. The
   module's next line after the marker-append is
   `require(globalThis.PHOENIX_LIB + '/baseService.js')`; on this
   09.09D build that appears unresolved at service require time, so
   the module class never exports and phoenix never starts it. The
   55A7KAU blueprint comment (`09.09O: services resolve the SDK
   through the phoenix globals`) is honored in the file, but the
   09.09D branch behaves as if the global is absent in this context.
   Open item: verify `PHOENIX_LIB` presence via a page-lane read of a
   stub module log, then patch `index.js` accordingly (a require-free
   export is the low-risk version).
3. **superwatch 53/54 replies `34:0 / 35:0` (accepted) but the install
   does not execute.** The page lane sent uninstall (54) + install (53)
   of `/APPS/installer.ipk` (content verified delivered, md5-checksum
   over the ssh lane) through `alvarm2` at 14:32 and 14:34 — both
   replies framed `result 0` — yet `installer_log.txt` stays at
   14:09 and no dropbear ever appears. The vendor opkg machinery
   invoked through the superwatch/socket path is failing silently
   (my direct `opkg` runs succeed; the difference sits in the
   environment the vendor path spawns with). Open item.
4. **The otaTest hook lane's exec is still blocked.** The v1 hook
   (findings/04, pre-root era) sits on disk at `/var/local/otaTest.sh`,
   its own log (`/var/local/otaTest.log`) ENOENT forever, its ports
   (2222/8770) closed and its DoH freeze never re-inserted after
   boots — `/etc/rc.d/rc.local`'s `sh /var/local/otaTest.sh &` stanza
   is not reaching execution on this build (04's SELinux-exec block
   appears to persist post-root for the rc.local context; the boot
   lane that worked on the reference model does not on this one).
5. **Current state**: `installer_log.txt` = 14:09 (the last
   successful configure); `resolv.conf` back to vendor nameservers
   (the DHCP rewrite at boot undoes lane W — the stage is designed to
   re-fight it on every boot, but only runs with root); firewall and
   adsfw REJECTs gone; dropbear down. Ads rendering and the OTA lane
   are open until a re-arm run happens.

## The v2 hook (in place, unverified)

`/var/local/otaTest.sh` was replaced via the browser write lane by the
**thin re-arm wrapper** (v1 archived verbatim to
`/var/local/otaTest.v1.bak` — rollback `cp .bak` over the file): it
waits on `hook.off`, then re-runs the packaged postinst
(`/APPS/pkgs/opkgmeta/info/re.installer.postinst`) so every boot gets
freeze + adsfw + dns + dropbear in one shot without a second dropbear
stack. First boot after this is in place did NOT produce
`/APPS/.re_sshd/boot_hook.log` — same exec-block family as (4). The
wrapper stays in place for a future root-context fix; kill-switch is
`touch /var/local/hook.off`.

## Recovery playbook (owner, next session)

1. Boot until the network is up (owner mains cycle).
2. The moment `ssh -p 8008 root@<tv-ip>` answers, re-arm in one line:
   `export LD_LIBRARY_PATH=/usr/local/lib:$LD_LIBRARY_PATH; opkg install /APPS/installer_e.ipk` — the configure re-runs the postinst and
   restores freeze + adsfw + the resolver (idempotent).
3. Then re-verify `resolv.conf` loopback + NXDOMAIN + rules as in the
   deploy section. Killing the resolver stays one command:
   `/APPS/.re_sshd/dnsmasq-stop.sh`.
