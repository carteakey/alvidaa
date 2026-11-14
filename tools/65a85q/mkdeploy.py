"""Generate a TV batch that installs the given kit files verbatim.

Usage: python tools/65a85q/mkdeploy.py boot.sh svc.sh > ../batches/deploy_fw.sh
(every file is written from the local copy, so the TV and the repo cannot
drift; write the output with python, not PowerShell redirection, or it lands
UTF-16 and tvsh cannot read it)
"""
import sys

HEADER = """export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
D=/var/local/alvidaa
mkdir -p "$D"
echo "=== deploy ==="
"""

FOOTER = """
chmod 755 "$D"/*.sh
chmod 644 "$D/alive.sh" "$D/rshell.js" 2>/dev/null
echo "--- syntax ---"
for f in "$D"/svc.sh "$D"/boot.sh; do
    sh -n "$f" && echo "ok $f" || echo "SYNTAX FAIL $f"
done
echo "=== DONE ==="
exit
"""


def main() -> None:
    out = [HEADER]
    for name in sys.argv[1:]:
        path = "tools/65a85q/" + name
        with open(path, encoding="utf-8", newline="\n") as fh:
            body = fh.read()
        assert "BATCH_EOF" not in body, path
        out.append('echo "=== %s ==="\n' % name)
        out.append('cat > "$D/%s" <<\'BATCH_EOF\'\n' % name)
        out.append(body if body.endswith("\n") else body + "\n")
        out.append("BATCH_EOF\n")
    out.append(FOOTER)
    sys.stdout.write("".join(out))


if __name__ == "__main__":
    main()
