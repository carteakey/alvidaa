# Dropbear binaries go here

`scripts/install.sh` and `scripts/make_installer.py` expect the patched
static ARMv7 Dropbear build here:

- `bin/dropbear-root`
- `bin/dropbearkey`

Build them with [`../scripts/build_dropbear_a7k.sh`](../scripts/build_dropbear_a7k.sh)
(key-only U7Q recipe; documented in the model guide and findings §6).
Upstream is Dropbear SSH 2022.83, GPLv2.

No prebuilt binaries are committed in this repository (`bin/` is gitignored).
