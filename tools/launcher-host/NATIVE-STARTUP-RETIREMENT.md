# Retire the legacy reverse-shell startup safely

The native launcher does not need the older installer phone-home section: it starts
an unauthenticated reverse-shell retry loop, not merely a notification. The
retirement tools remove only one fingerprinted revision while retaining root SSH,
the feed boot hook, payload bytes and every historical recovery backup.

This is a separate, root-local maintenance operation, **not** an automatic part of
launcher installation or a generic cleaner for other models. Unknown startup or
script bytes are refused. See the [tested device evidence](../../docs/models/55A7KAU/V0000.09.09O.P1015/findings/21-startup-retirement-and-storage.md).

## Preconditions

- Owner's TV only. Do not modify read-only partitions or OTA staging.
- Independently verify root SSH after boot before retiring the old recovery lane.
- Inspect the current Home, bootstrap and `native-home/web-feed-boot` journal.
  Capture fresh hashes and preserve the exact private installer bytes.
- No owned phone-home process or reverse connection may be active. The controller
  refuses one; it does not broadly kill processes or clean the SSH directory.
- Retain the 64 MiB reserve and enough space for all transaction backups.
- Keep package inputs/outputs under gitignored `firmware/`; never publish them.

## Prepare and apply

On the workstation, make two transformed candidates: one from the current feed
installer and one from its recorded pre-feed baseline. Do **not** invent a baseline
or patch only the live installer, which would leave normal teardown resurrecting
the unsafe section.

```sh
python3 tools/launcher-host/patch-native-phonehome.py \
  firmware/current-feed.ipk firmware/current-feed-without-phonehome.ipk
python3 tools/launcher-host/patch-native-phonehome.py \
  firmware/recorded-feed-baseline.ipk firmware/baseline-without-phonehome.ipk
```

Stage the two private candidates and the retirement controller with its `CONTROL`
dependencies in a private root-owned directory. Inspect/verify those bytes first.
On the TV, using the vendor Node runtime:

```sh
export LD_LIBRARY_PATH=/lib:/usr/local/lib:/basic/lib
NODE=/opt/pkgs/tv.vidaa.app.phoenix/bin/phoenix
"$NODE" '<private-stage>/retire-native-phonehome.cjs' apply \
  '<private-stage>/current-feed-without-phonehome.ipk' \
  '<private-stage>/baseline-without-phonehome.ipk' \
  '<reviewed-current-home-sha256>' '<reviewed-current-installer-sha256>'
```

The controller holds the Home lock, verifies exact current ownership and package
transforms, and moves the old feed journal intact into
`/var/local/alvidaa/native-home/retired-phonehome/old-boot`. The new active feed
journal has a phone-home-free baseline. The known inactive script is backed up
before removal. Root payload, SSH, other control records and surrounding bootstrap
code stay unchanged.

After apply, verify a fresh key-only SSH connection, unchanged Home/preferences,
the `retired` journal, safe feed baseline, absent obsolete script/process and
remaining reserve. Source inspection plus current SSH access is **not** a new
cold-boot acceptance test.

## Recovery

Retain the entire retirement journal. An interrupted migration is marked
`needs-recovery`; use its independent controller rather than deleting journals.

```sh
"$NODE" /var/local/alvidaa/native-home/retired-phonehome/control/retire-native-phonehome.cjs restore
```

**This exceptional restore puts back the insecure startup bytes.** It launches no
process immediately, but could re-enable the reverse shell on a later boot. It
also requires the recorded Home to remain unchanged and refuses concurrent edits.
Normal launcher/feed rollback or teardown uses the new safe baseline and does
not undo retirement. Never use exceptional restore merely to remove the launcher.
