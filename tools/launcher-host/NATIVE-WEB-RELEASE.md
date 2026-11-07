# Private Free My TV web release

This builds the pinned web UI plus compatibility adapters for the **55A7KAU
V0000.09.09O.P1015**. It is not a generic VIDAA installer or a claim of completed
parity. See the [acceptance gates](../../docs/launcher/FREE-MY-TV-WEB-PARITY.md)
and [on-TV lifecycle evidence](../../docs/models/55A7KAU/V0000.09.09O.P1015/findings/17-native-feed-lifecycle.md).

## Reproduce the artifact

Run from the repository root. Use the original, private stock launcher backup,
not the currently modified launcher. Asset generation requires the packages in
`requirements-web-assets.txt` and `rsvg-convert`; do not overwrite existing assets.

```sh
python3 tools/launcher-host/build-native-web-assets.py firmware/my-native-web-assets
(cd tools/launcher-host/native-image && \
  GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0 \
  go build -trimpath -ldflags='-s -w' -o ../../../firmware/native-image-armv7 .)
python3 tools/launcher-host/package-native-web.py \
  firmware/55a7kau-09.09o/native-analysis/launcher-app.js \
  firmware/my-native-web-assets firmware/native-image-armv7 \
  firmware/native-web-release.tar.gz
```

The packager verifies upstream/asset hashes and the original firmware hash,
rejects non-ARM helpers and existing outputs, and writes a mode-0600 deterministic
archive. It contains vendor-derived code and **must not be published**.

Archive layout:

- `runtime/`: root-owned private runtime, helper, compiled candidate and licenses;
  directories 0700, files 0600, executable helper 0755.
- `assets/<asset-id>/`: root-owned public Cobalt assets, directories 0755 and
  files 0644. The candidate embeds this content-addressed asset ID.
- `RELEASE.json`: every payload's size and SHA-256, upstream revision and candidate
  hash. No credential files, environment snapshots or device state are included.

The real build was reproduced twice with identical archive bytes and all members
verified. Separate fixture tests require neither firmware nor real credentials:

```sh
python3 tools/launcher-host/test_native_web_package.py
```

## Deployment boundaries

The archive is a reproducible artifact, **not yet a one-command transactional
installer**. Do not extract it blindly over active TV paths. Keep the existing
[Home controller](NATIVE-LAUNCHER.md), original backups and working recovery
candidate. Verify the manifest before staging, retain originals, stop only the
owned feed worker before replacing its runtime, and use the hash-guarded Home
controller for candidate changes. Never replace origin storage or vendor
read-only partitions. Check free space and existing `/var/local` state first.

The current trial uses:

- Private runtime: `/var/local/alvidaa/native-web-v3/`.
- Public assets/media: `/APPS/channelA/hisenseUI/var/local/free-my-tv/`.
- Public file IPC: `/APPS/free-my-tv/`, owned by the existing Phoenix UID/GID 314.
- Private TMDB token: `/var/local/alvidaa/server/keys/free-my-tv.json`, root-owned
  mode 0600. It is separately provisioned, never part of an archive or URL.

The native `storeAppIcon` path is a vendor symlink. Preserve it; the image worker
resolves it and confines reads to the canonical icon directory.

## Feed lifecycle and boot recovery

Run these only through root SSH, with the vendor Node runtime and its libraries:

```sh
LD_LIBRARY_PATH=/lib:/usr/local/lib:/basic/lib \
  /opt/pkgs/tv.vidaa.app.phoenix/bin/phoenix \
  /var/local/alvidaa/native-web-v3/native-web-service.cjs status
```

Replace `status` with `start` or `stop` as needed. Duplicate starts retain one
kernel-locked worker. Stop verifies process ownership. Restoring a non-web Home
also makes the worker exit; cached media and preferences remain intact.

The boot fragment is added only to the existing retired-bridge root installer:

```sh
python3 tools/launcher-host/patch-native-feed-bootstrap.py \
  firmware/private-installer.original.ipk firmware/private-installer.feed.ipk
```

After staging that private IPK and the checked runtime, the root-local
`native-web-boot.cjs apply <candidate-ipk> <current-installer-sha256>` validates
that only its owned fragment changed and journals the original before replacing
`/APPS/installer.ipk`. `native-web-boot.cjs restore` restores its exact original
bytes and metadata, refusing concurrent edits. The first backup is retained
across reinstallations. These operations were exercised on the TV without
rebooting or running the complete root installer.

The original root payload, SSH setup, blocklist and older phone-home section are
unchanged. No new listener or MQTT session is introduced. The boot entry is
configured and manually tested; cold-boot and standby acceptance remain pending.
