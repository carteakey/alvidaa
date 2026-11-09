# Dropbear binaries go here

`scripts/install.sh` and `scripts/make_installer.py` expect **your own** static ARM32 dropbear build here:

- `bin/dropbear-root`
- `bin/dropbearkey`
- `bin/dnsmasq` (static ARM32, built by `scripts/build_dnsmasq.sh`; consumed by the 55E7QTUK dns stage in `make_min_installer.py`)

Build them per `docs/models/100U7Q/V0000.09.60I.Q0813/README.md` (Build section). The upstream is Dropbear SSH 2022.83, GPLv2; the build patches are documented in that guide and in `tools/fw`. dnsmasq upstream is 2.91 (GPLv2/GPL3 dual), built off-the-shelf with `COPTS="-DNO_DHCP -DNO_TFTP"`.

No prebuilt binaries are shipped in this repository.
