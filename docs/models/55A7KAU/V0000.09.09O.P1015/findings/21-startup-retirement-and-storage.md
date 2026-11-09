# Startup retirement, preserved storage and artwork publication

This record extracts general native-launcher maintenance and evidence only. No
personal-service integrations, credentials, private archives or screenshots are
included.

## Legacy reverse-shell startup retired

The older phone-home installer section started an unauthenticated reverse-shell
retry loop. `patch-native-phonehome.py` and `retire-native-phonehome.cjs` accept only
the fingerprinted revision and inactive script. They preserve the IPK root payload,
other control files, SSH setup, feed hook and surrounding bootstrap code.

The operation used the owned Home lock and fresh Home/bootstrap guards. No owned
loop or reverse connection was active; no broad process kill or SSH-directory
cleanup was used. The full previous feed-bootstrap journal moved intact into
`native-home/retired-phonehome/old-boot`. Its safe replacement records a
phone-home-free baseline, so ordinary feed teardown does not re-enable the loop.
Independent recovery code and the original inactive script remain in that journal.

An explicit retirement `restore` restores the previous startup bytes but starts no
process. **It would re-enable insecure startup at a later boot** and is not normal
launcher rollback. Unknown script revisions and concurrent edits are refused.
See the [operating guide](../../../../../tools/launcher-host/NATIVE-STARTUP-RETIREMENT.md).

Four synthetic tests cover payload preservation/safe teardown, exact restoration,
interrupted journal migration and refusal of stale or unrecognized inputs. Actual
private package candidates were validated before guarded application on this TV.
Fresh key-only SSH afterward confirmed the recovery lane remained available:

- phase `retired`; historical journal and safe baseline retained;
- obsolete script absent; no owned reverse-shell process/connection;
- Home and preferences unchanged;
- free private space 92,438,528 bytes, above the unchanged 64 MiB reserve.

The retired startup was not cold-boot-tested in that operation. Earlier successful
boot tests in [finding 19](19-release-controller-trial.md) must not be treated as
post-retirement boot acceptance.

## Preservation-first storage preparation

Two unused staging objects were privately backed up and verified before removal:

- A 26,005,354-byte runtime `stage.tar.gz`. Inspection of 207 live/recovery script
  and JSON files found no consumer beyond a historical ownership inventory, which
  was retained. A restoration record retains hash, size, original root ownership
  and 0600 mode. Free space afterward was 94,126,080 bytes.
- A private runtime `assets/` staging tree: 1,728 verified files totaling 44,739,003
  bytes. Inspection of 261 runtime/recovery files found no direct references.
  Original paths, ownership, modes and modification times were privately recorded.
  Public assets and their hard links remained untouched. Free space afterward was
  129,835,008 bytes.

Both removals used the Home lock, unchanged Home/bootstrap guards and open-file
checks. Mode-0600 workstation backups and on-TV restoration records were retained.
All recovery journals, app data, current artwork and preferences remained intact;
the reserve was never lowered. These are historical maintenance results, not a
promise of current free space or a blanket cleanup recipe. No automatic staging
cleanup is added to the release coordinator.

Diagnostic traps found during inspection: the vendor Node build lacks `Intl`, so
`buildProgram()` stays host-side. A diagnostic inventory over 64 KiB was truncated
by immediate `process.exit()`; waiting for the stdout write callback completed it
before any removal. Brief SSH/control-port `EHOSTUNREACH` resolved after ordinary
SSDP rediscovery without wake/restart/power commands; the cause remains unknown.

## Generic stale-artwork publication fix

The media cache can retain old files/mappings after a recommendation-list change.
Publishing the whole cache unnecessarily exposes stale references and orphan
resources. The worker now publishes only backdrop/logo mappings used by the
current recommendation pool and media transitively reachable through those
mappings. Native app icon aliases and their derived resources remain published.

This affects publication only: it does not mutate the recommendation cache, delete
files, change retention policy, filter recommendations or add account logic.
Malformed/empty recommendation lists publish no old artwork mappings. Three
standalone tests cover current/stale resources, malformed caches, native icons,
cycles and missing descriptors. The extraction is tested on this PR branch; it
has not been independently installed as a new combined PR-only release on the TV.

On the isolated public branch, all **150 launcher tests** passed with zero skips,
including the four retirement tests and three publication tests. Three packaging
tests, the repository check script and `git diff --check` also passed. No new TV
operation was performed to prepare this public PR update.
