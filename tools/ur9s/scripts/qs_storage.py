#!/usr/bin/env python3
"""qs_storage.py — read/write the SystemUI starboard (cobalt) localStorage.

The Quick Menu layout (and all SystemUI / home-app state) is persisted in one
"SAV1" file: a 4-byte magic, then a single protobuf field-2 length-delimited
record holding an origin string (field 1) and a repeated KV message
(field 2: { string key = 1; string value = 2 }).

This tool edits that file **without re-serializing the fields you do not
touch** — every untouched field is preserved byte-for-byte, so a 137-pair file
stays identical except for the keys you change. (The engine rewrites the whole
file on every write, so edit it only while SystemUI is stopped.)

Commands
  parse   <file> [--all]          dump pairs (default: keys containing "setting.")
  report  <file>                  Quick Menu summary: lists, counts, integrity
  factory <in> <out>              strip qsEditList + qsBakList  ->  factory reset
  drop    <in> <out> <key>...     strip the named keys
  set     <in> <out> <k>=<v>...   set keys to literal string values
  add     <in> <out> <key> <id>.. append ids to a JSON-array key (deduped)

The Quick Menu factory reset is `factory`: removing the two saved-list keys
makes getQsEditList() return null on the next load, so the menu falls back to
the embedded factory preset. See findings 03 (Quick Menu) for the full picture.
"""
import sys
import json

MAGIC = b"SAV1"
QS_EDIT = "setting.qsEditList"
QS_BAK = "setting.qsBakList"
QS_CLEAR = "setting.qsClearFlag"


# --- minimal protobuf reader/writer (varint + length-delimited) -------------

def rd_varint(b, i):
    v = 0
    sh = 0
    while True:
        x = b[i]
        i += 1
        v |= (x & 0x7F) << sh
        if not x & 0x80:
            return v, i
        sh += 7


def enc_varint(n):
    out = b""
    while True:
        b7 = n & 0x7F
        n >>= 7
        out += bytes([(b7 | 0x80) if n else b7])
        if not n:
            break
    return out


def rd_fields(b, i, end):
    """Yield (field, wire, raw, payload). raw = full tag+len+payload bytes;
    payload = the length-delimited content for wire 2, else None."""
    while i < end:
        start = i
        tag, i = rd_varint(b, i)
        f, w = tag >> 3, tag & 7
        payload = None
        if w == 0:
            _, i = rd_varint(b, i)
        elif w == 2:
            ln, i = rd_varint(b, i)
            payload = b[i:i + ln]
            i += ln
        elif w == 5:
            i += 4
        elif w == 1:
            i += 8
        else:
            raise ValueError(f"bad wire {w} at {start}")
        yield f, w, b[start:i], payload


def kv_key(kvb):
    for f, w, _raw, payload in rd_fields(kvb, 0, len(kvb)):
        if f == 1 and w == 2:
            return payload.decode("utf-8", "replace")
    return None


def kv_value(kvb):
    for f, w, _raw, payload in rd_fields(kvb, 0, len(kvb)):
        if f == 2 and w == 2:
            return payload.decode("utf-8", "replace")
    return None


def kv_make(key, value):
    """Build the field-2 raw bytes for one KV {key, value} record entry."""
    body = b"\x0a" + enc_varint(len(key.encode())) + key.encode()
    body += b"\x12" + enc_varint(len(value.encode())) + value.encode()
    return b"\x12" + enc_varint(len(body)) + body


# --- file load / save (single top-level record) -----------------------------

def load(path):
    """Return a list of field dicts: {f, w, raw, payload, key}.
    key is set only for field-2 KV entries."""
    data = open(path, "rb").read()
    if data[:4] != MAGIC:
        raise ValueError("bad magic (not SAV1)")
    top = list(rd_fields(data, 4, len(data)))
    nonrec = [t for t in top if not (t[0] == 2 and t[1] == 2)]
    if nonrec:
        raise ValueError("unexpected top-level non-record field")
    recs = [t[2] for t in top if t[0] == 2 and t[1] == 2]
    if len(recs) != 1:
        raise ValueError(f"expected exactly 1 record, got {len(recs)}")
    rec = recs[0]
    ln, body_i = rd_varint(rec, 1)  # skip the 0x12 tag
    body = rec[body_i:]
    if len(body) != ln:
        raise ValueError("record length mismatch")
    fields = []
    for f, w, raw, payload in rd_fields(body, 0, len(body)):
        key = kv_key(payload) if (f == 2 and w == 2) else None
        fields.append({"f": f, "w": w, "raw": raw, "payload": payload, "key": key})
    return fields


def save(path, fields):
    body = b"".join(fd["raw"] for fd in fields)
    data = MAGIC + b"\x12" + enc_varint(len(body)) + body
    with open(path, "wb") as fh:
        fh.write(data)
    return len(data)


def kvs(fields):
    """Return [(key, value)] for the field-2 KV entries, in order."""
    out = []
    for fd in fields:
        if fd["f"] == 2 and fd["w"] == 2:
            out.append((fd["key"], kv_value(fd["payload"])))
    return out


# --- commands ----------------------------------------------------------------

def _load_or_die(path):
    try:
        return load(path)
    except (OSError, ValueError) as e:
        sys.exit(f"error: {path}: {e}")


def _write_or_die(path, fields):
    try:
        return save(path, fields)
    except OSError as e:
        sys.exit(f"error: {path}: {e}")


def cmd_parse(args):
    path = args[0]
    show_all = "--all" in args
    pairs = kvs(_load_or_die(path))
    for k, v in pairs:
        if show_all or (k and "setting." in k):
            print(f"{k} = {v}")
    print(f"# {len(pairs)} pairs total", file=sys.stderr)


def _json_ids(d, key):
    raw = d.get(key)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def cmd_report(args):
    path = args[0]
    universe = None
    if "--universe" in args:
        ui = args.index("--universe")
        try:
            universe = set(json.loads(open(args[ui + 1]).read()))
        except (OSError, json.JSONDecodeError, IndexError) as e:
            sys.exit(f"error: --universe: {e}")
    d = dict(kvs(_load_or_die(path)))
    edit = _json_ids(d, QS_EDIT)
    bak = _json_ids(d, QS_BAK)
    print(f"pairs        : {len(d)}")
    print(f"qsClearFlag  : {d.get(QS_CLEAR)}")
    for label, lst in (("qsEditList", edit), ("qsBakList", bak)):
        if lst is None:
            print(f"{label:<12}: (absent -> factory preset)")
            continue
        dupes = sorted({x for x in lst if lst.count(x) > 1})
        print(f"{label:<12}: {len(lst)} items")
        for x in lst:
            print(f"    {x}")
        if dupes:
            print(f"    !! duplicates: {', '.join(dupes)}")
    if edit is not None and bak is not None:
        overlap = sorted(set(edit) & set(bak))
        if overlap:
            print(f"!! overlap (in BOTH rows): {', '.join(overlap)}")
        if universe is not None:
            missing = sorted(universe - (set(edit) | set(bak)))
            if missing:
                print("!! in universe but in NEITHER list (possible loss):")
                for x in missing:
                    print(f"    {x}")
            else:
                print("universe     : every universe id is in at least one row")


def cmd_factory(args):
    src, dst = args[0], args[1]
    fields = _load_or_die(src)
    kept = [fd for fd in fields
            if not (fd["f"] == 2 and fd["w"] == 2 and fd["key"] in (QS_EDIT, QS_BAK))]
    n = _write_or_die(dst, kept)
    print(f"factory: dropped {len(fields) - len(kept)} list key(s); "
          f"{len(fields)} -> {len(kept)} fields; {n} bytes -> {dst}")


def cmd_drop(args):
    src, dst = args[0], args[1]
    keys = set(args[2:])
    if not keys:
        sys.exit("error: drop needs at least one key")
    fields = _load_or_die(src)
    kept = [fd for fd in fields
            if not (fd["f"] == 2 and fd["w"] == 2 and fd["key"] in keys)]
    n = _write_or_die(dst, kept)
    present = {fd["key"] for fd in fields if fd["key"]}
    print(f"drop: removed {len(fields) - len(kept)} field(s) for {sorted(keys)}; "
          f"{n} bytes -> {dst}")
    if keys - present:
        print(f"note: key(s) not present (no-op): {sorted(keys - present)}")


def cmd_set(args):
    src, dst = args[0], args[1]
    sets = {}
    for kv in args[2:]:
        if "=" not in kv:
            sys.exit(f"error: expected key=value, got {kv!r}")
        k, v = kv.split("=", 1)
        sets[k] = v
    fields = [fd for fd in _load_or_die(src)
              if not (fd["f"] == 2 and fd["w"] == 2 and fd["key"] in sets)]
    for k, v in sets.items():
        fields.append({"f": 2, "w": 2, "raw": kv_make(k, v), "payload": None, "key": k})
    n = _write_or_die(dst, fields)
    print(f"set: wrote {sorted(sets)}; {n} bytes -> {dst}")


def cmd_add(args):
    src, dst = args[0], args[1]
    key, add_ids = args[2], args[3:]
    if not add_ids:
        sys.exit("error: add needs at least one id")
    fields = _load_or_die(src)
    target = next((fd for fd in fields
                   if fd["f"] == 2 and fd["w"] == 2 and fd["key"] == key), None)
    cur = [] if target is None else json.loads(kv_value(target["payload"]))
    for i in add_ids:
        if i not in cur:
            cur.append(i)
    raw_val = json.dumps(cur, separators=(",", ":"))
    if target is None:
        fields.append({"f": 2, "w": 2, "raw": kv_make(key, raw_val), "payload": None, "key": key})
    else:
        target["raw"] = kv_make(key, raw_val)
    n = _write_or_die(dst, fields)
    print(f"add: {key} now {len(cur)} items; {n} bytes -> {dst}")


def main(argv):
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print(__doc__.strip())
        return 0
    cmd, args = argv[1], argv[2:]
    table = {"parse": cmd_parse, "report": cmd_report, "factory": cmd_factory,
             "drop": cmd_drop, "set": cmd_set, "add": cmd_add}
    if cmd not in table:
        sys.exit(f"error: unknown command {cmd!r} (see --help)")
    table[cmd](args)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))