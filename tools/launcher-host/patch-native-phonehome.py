#!/usr/bin/env python3
"""Remove only the fingerprinted legacy phonehome block; preserve all other IPK bytes."""
import argparse
import hashlib
import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("feed_patch", HERE / "patch-native-feed-bootstrap.py")
assert SPEC is not None and SPEC.loader is not None
BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)


def transform(content):
    marker = b'echo "--- step: phone home ---"'
    end = b'\n} > "$D/installer_log.txt"'
    if content.count(marker) != 1:
        raise ValueError("Unknown phonehome bootstrap")
    start = content.index(marker)
    finish = content.index(end, start)
    if hashlib.sha256(content[start:finish]).hexdigest() != "72259468b9c057bb3f11b36f7ef3c6ac35725e857aea1ab09999f9bbbc4f52be":
        raise ValueError("Unknown phonehome fragment")
    return content[:start] + marker + b'\n  # ALVIDAA_PHONEHOME_RETIRED_V1: root SSH is the recovery lane.' + content[finish:]


def patch(data):
    return BASE.BASE.patch(data, transform)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("original", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if not args.output.resolve().is_relative_to(HERE.parents[1] / "firmware"):
        parser.error("Private bootstrap output must stay under firmware/")
    result = patch(args.original.read_bytes())
    with args.output.open("xb") as stream:
        args.output.chmod(0o600)
        stream.write(result)
    print("Only the fingerprinted phonehome startup block was retired")
