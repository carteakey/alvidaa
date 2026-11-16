#!/usr/bin/env python3
"""Build a minimal, binary-free installer IPK for VIDAA (MTK9618 family).

The package carries no executables: its `postinst` is a plain shell script that
runs as uid 0 through the vendor package manager, so it can create directories
(the fetcher cannot) and plant the PFM boot lane.

IPK layout: ar(debian-binary, control.tar.gz, data.tar.gz) -- built in pure
Python so no `ar`, `tar` or cross toolchain is needed.

Usage:
    python tools/tv_ipk.py out.ipk [--arch mtk9618] [--postinst PATH]
"""
import argparse
import io
import os
import tarfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_POSTINST = os.path.join(HERE, "alvidaa_ipk", "postinst.sh")

CONTROL = """Package: re.installer
Version: 1.0.0
Architecture: {arch}
AppId: re.installer
AppName: re.installer
Section: ns
Priority: optional
Maintainer: alvidaa
Description: alvidaa root helper (shell-only)
Format: 1
Persistent: false
PackageType: Entry
Userid: 0:0
Installed-Size: 64
"""


def add_bytes(tar, name, data, mode=0o644):
    ti = tarfile.TarInfo(name)
    ti.size = len(data)
    ti.mode = mode
    ti.mtime = 0
    tar.addfile(ti, io.BytesIO(data))


def ar_write(path, members):
    """GNU/BSD ar container, which is what opkg reads."""
    with open(path, "wb") as fh:
        fh.write(b"!<arch>\n")
        for name, data in members:
            hdr = (name + "/")[:16].ljust(16).encode()
            hdr += str(int(time.time())).ljust(12).encode()
            hdr += b"0".ljust(6)
            hdr += b"0".ljust(6)
            hdr += b"100644".ljust(8)
            hdr += str(len(data)).ljust(10).encode()
            hdr += b"`\n"
            fh.write(hdr)
            fh.write(data)
            if len(data) % 2:
                fh.write(b"\n")


def build(out_path, arch, postinst_path):
    with open(postinst_path, "rb") as fh:
        postinst = fh.read()

    ctrl = io.BytesIO()
    with tarfile.open(fileobj=ctrl, mode="w:gz") as t:
        add_bytes(t, "./control", CONTROL.format(arch=arch).encode())
        add_bytes(t, "./postinst", postinst, 0o755)

    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w:gz") as t:
        add_bytes(t, "./APPS/.alvidaa/ipk_marker.txt",
                  b"alvidaa installer marker\n")

    ar_write(out_path, [
        ("debian-binary", b"2.0\n"),
        ("control.tar.gz", ctrl.getvalue()),
        ("data.tar.gz", data.getvalue()),
    ])
    return os.path.getsize(out_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--arch", default="mtk9618")
    ap.add_argument("--postinst", default=DEFAULT_POSTINST)
    a = ap.parse_args()
    size = build(a.out, a.arch, a.postinst)
    print(f"wrote {a.out} {size} bytes (arch {a.arch}, postinst {a.postinst})")


if __name__ == "__main__":
    main()
