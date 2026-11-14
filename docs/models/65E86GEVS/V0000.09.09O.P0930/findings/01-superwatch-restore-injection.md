# Finding 01 — superwatch command 55 (`RunIpkRestoreCommand`): unquoted shell composition, group-616 socket

Device: 65E86GEVS / V0000.09.09O.P0930 (MTK9618, U09.09). Live-verified 2026-10-24.

## The socket

- `/var/run/superwatch_socket` — `root:superwatch` **0660**, chowned to gid
  **616** by `superwatch_server` on startup.
- `/etc/group`: `superwatch:x:616:television`. `phoenix` runs as **uid 314**
  with supplementary group **616**, so its children pass DAC and the server's
  per-command `SO_PEERCRED` check — which accepts uid 314 because it *is* the
  TV's own package manager.
- Frame: `uint32le length`, then `"<sessionId>:<commandId>:<args>"` (same wire
  format as the 55E7QTUK record, where install/uninstall are ids 53/54).

## The command

**Command 55 = `RunIpkRestoreCommand`.** Args: `<pkgName>;<channel>`.

The server builds a shell command from the message and executes it **as root
via `system()`/`popen()` with the pkg name inserted unquoted and unvalidated**.
A name containing `$( ... )` is therefore evaluated by `/bin/sh` in the root
context before the command's intended script runs.

## What was measured

| Claim | Evidence |
| --- | --- |
| uid 314 can connect and write the UDS | connect + write succeed |
| two frames with a crafted pkg name mint a setuid shell | `/dev/shm` copy mode `-rwsr-xr-x root root` (tmpfs, no `nosuid`) |
| root proven | `/proc/self/status` `Uid: 314 0 0 0`; `/etc/shadow` readable; `/data` lists and is writable |
| SELinux not a barrier | permissive (`enforce=0`) on this build |

One deliberate difference worth stating: the other documented superwatch chains
exploit the **install** ids, where root falls out of the *postinst-as-root*
package policy. This one is the **restore** command, and root falls out of a
composition bug in the daemon itself — the same class their
[MT9618 security review](../../../55S7NEVS/V0000.09.60X.Q0609/findings/50-security-review.md)
lists as "authenticate the superwatch message channel" (item 3 of the fixes).

## The defect, stated for a report

`superwatch_server` concatenates a caller-supplied package name into the
argument list of `system()`/`popen()` without quoting or validating it. Any
process able to reach the socket and pass the per-command uid check — which
includes the TV's own JS service layer at uid 314, and therefore any code that
can run there — gets root. Two independent weaknesses combine:

1. **Unquoted shell composition** in the root daemon (no memory-safety bug; no
   exploit needed).
2. **Group-616 IPC** reachable by the service user through its supplementary
   group, which turns "the TV's own app can ask for a backup" into "the TV's
   own app can be root".

## Cleanup / teardown

All artefacts were removed on 2026-10-24 (see the guide README): setuid copy
and probe files from `/dev/shm`, `/OAD` experiment files, the writable-service
module restored to stock md5 `f1dd2229e3983c76c4e06e4be79b1b8b`, phoenix
reloaded, reverse shell stopped. The vendor bug remains on the device.

## Withheld

The exact two-frame command strings, the `tvroot.js` helper, and the
writable-service boot-hook file — working payloads per
[DISCLOSURE.md](../../../../DISCLOSURE.md).
