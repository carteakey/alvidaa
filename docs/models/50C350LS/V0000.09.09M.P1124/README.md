# 50C350LS (Toshiba) - V0000.09.09M.P1124

**Model:** 50C350LS (Toshiba OEM, `brand=tos`)
**Firmware:** V0000.09.09M.P1124
**SoC:** MediaTek MTK9602
**Region:** SA/Brazil (`region=8`)
**VIDAA OS:** U09.09
**Browser:** Chromium 111 "odin"
**`transport_protocol`:** 3290
**Contributed by:** gh:lobobg8-hub (own unit)

> **What this guide includes and leaves out.** This page records what was observed on a single owned unit: which capabilities were reachable, what the evidence shows, and what remains unverified. It does not include the operational payload, the exact command sequence, or a copy-paste recipe. The route family is already documented in the public `09.09O` / `09.09D` guides; this page maps the deltas observed on this build and leaves the operator to adapt the method to their own unit.

## Root - superwatch FaaS family (verified 2026-11-11)

Same method family as the `09.09O` (55A7KAU) and `09.09D` (55E7QTUK) superwatch chains. Two deltas were measured on this build:

1. **Pairing requires `brand=tos`.** The alvidaa `pair.py` hardcodes `his` in the client identity and is refused with `rc=135` on this unit. `pyvidaa`, which discovers the brand via UPnP, pairs successfully. This is a controller-identity issue, not a transport or certificate issue.
2. **The fetcher is a service, not a function.** On this build the fetcher lives under `CHA/services/fetcher/index.js`, not under `CHA/functions/fetch/sw2.js`. The function-bridge shim documented in the `09.09O` guide is absent here and has to be placed through the file bridge before the superwatch route works.

The superwatch install command observed on this generation is `53`, matching the `09.09O` family rather than the `09.60` family (which uses `82`).

## Evidence

What was observed on this unit:

- `test.ipk` written to `/tmp/ipk_proof.txt` returns `EACCES`, not `ENOENT`. The file exists but is not readable as uid 314 - i.e. it was created by a privileged process with restrictive permissions.
- `proof.ipk` written to `/APPS/ipk_proof.txt` with an explicit `chmod 644` inside the post-install script succeeds: the file is created and readable as uid 314. A `chmod 644` on a file owned by root is only possible from root or from the owner.
- `proof2.ipk`, built to capture a literal `uid=0` line, fails to print the id line because the firmware has no `id` binary in `/bin`, `/usr/bin`, or `busybox`. The post-install script itself runs (the write and the chmod still succeed), but the firmware does not ship the tool needed to print the identity.

**Evidence grade:** indirect. The privileged execution is proven by the file ownership and permission transitions, not by a literal `uid=0` line. This is a limitation of the firmware image, not of the observation.

## What does NOT exist on this firmware

- `/etc/rc.local` (the `09.01O` boot-hook route)
- `/var/local/otaTest.sh` (the `50A51HUV` hook)
- `jsservice.system` (the `09.01O` JS service package)
- `/bin/id`, `/usr/bin/id`, `/bin/busybox` (so `id`-based post-install proof is not available on this build)
- a native `functions/fetch/sw2.js` (the shim must be placed through the file bridge on this build)

## Limits

- **Persistence across reboot was not tested.** The observation is a session-level root execution. No serviceList entry, no boot hook and no re-arm mechanism was installed or verified on this unit.
- **Privileged-execution proof is indirect** (file ownership + `chmod` semantics), because the firmware does not ship the identity tools needed for a literal proof.
- **The `sw2.js` shim must be placed before the superwatch route is usable** on this build; it is not present in the factory image.
- **`ipk-update -n` returns code 408 for non-system packages** after a successful post-install. The post-install runs first; the 408 does not invalidate the root execution.
- **No SSH, Dropbear or firewall rule was deployed or verified** on this unit. The next-step (`dropbear` / boot persistence) would be a separate study.

## Reversibility

Every write was placed on a writable partition (`/APPS`); nothing was written to the verified-boot rootfs. The steps to return the unit to its prior state are the standard ones for the method family: remove the placed shim, remove the test packages from `/APPS/`, remove the proof files from `/APPS/`, and reboot (which clears `/tmp/` and any volatile firewall state). No read-only partition was modified during the study.

## Disclosure

Findings and evidence only. No command sequence, no payload, no copy-paste recipe. The route family is already public in the `09.09O` / `09.09D` guides; this page maps the deltas observed on this build so the next owner of this model knows what to expect and what not to assume.
