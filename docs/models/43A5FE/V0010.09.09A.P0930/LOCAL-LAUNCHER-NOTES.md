# Community report: local launcher checks (43A5FE)

**Device:** Hisense 43A5FE, firmware `V0010.09.09A.P0930`.
**Evidence:** Community reported; observed on one owner's unit and not independently reproduced by project maintainers.

## Deployment observations

- A successful package transfer did not establish that the local service had started. A small boot log and the local endpoint gave more useful post-reboot checks.
- Reading a multi-megabyte staged package through the browser file bridge was followed by the file service becoming unresponsive on this unit. Small text probes remained usable. Keep diagnostic reads small.
- The boot shell had `md5sum` but no `cut`. A startup script that assumed `cut` exited before launching the service. Check required utilities on the target firmware.
- After a factory reset, the local WebSDK app registration had to be recreated. The new launcher tile appeared in the app list after a full reboot.
- A host bridge and an on-device bridge using the same paired MQTT client identity repeatedly displaced one another. Test with one controller session at a time.
- The on-device bridge opened multiple native TV apps from a local web launcher and returned to it after Exit/Return. A cold boot still initially showed stock VIDAA Home. This is a local web launcher result, not a native Home replacement.

## Scope and reversal

These are troubleshooting observations, not an installation procedure or payload. They contain no app list, unit identifiers, network addresses or credentials. The model guide's factory-reset option remains the documented reversal path.
