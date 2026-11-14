"""Fixture-transport tests for `alvidaa backup | restore` (issue #16); no TV.

The fixture implements the exact busybox command forms alvidaa.py issues —
the fake-tv.cjs lesson: tight forms and a fixture that raises loudly on
anything it does not recognise, so a new remote command must be taught here
before it can pass. Runs on any host: no /proc, no dropbear, no TV.
"""
import base64
import hashlib
import importlib.util
import io
import json
import os
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("alvidaa", Path(__file__).with_name("alvidaa.py"))
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("cannot load alvidaa.py")
ALVIDAA = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ALVIDAA)

BB = "/var/local/tvtools/busybox"


def md5(data):
    return hashlib.md5(data).hexdigest()


class FakeTV:
    """The TV's busybox, as alvidaa.py sees it: a file table plus the handful
    of command forms the backup/restore lanes issue. Unknown commands raise —
    a silent fixture hides exactly the bugs it exists to catch."""

    def __init__(self):
        self.files = {}
        self.written = {}      # target path -> bytes (restore's named writes)
        self.tar_on_tv = True
        self.log_without_done = False
        self.staged_tar = None
        self._staged = {}

    def add(self, path, data):
        self.files[path] = data if isinstance(data, bytes) else data.encode()

    def has_tar(self):
        return "applet not found" not in self.text("%s tar --help 2>&1 | head -n 1" % BB)

    # ---- the text lane (alvidaa.tv) ----------------------------------------

    def text(self, cmd, timeout=None):
        forms = [
            (self._exists_form, "[ -e "),
            (self._file_form, "[ -f "),
            (self._dir_form, "[ -d "),
            (self._find_form, BB + " find '"),
            (self._wc_form, BB + " wc -c < '"),
            (self._md5_form, BB + " md5sum '"),
            (self._base64_form, BB + " base64 '"),
            (self._tarhelp_form, BB + " tar --help"),
            (self._mv_form, BB + " mkdir -p '"),
            (self._rm_form, BB + " rm -rf "),
        ]
        for handler, prefix in forms:
            if cmd.startswith(prefix):
                return handler(cmd)
        raise AssertionError("fixture does not implement: %s" % cmd)

    def _arg(self, cmd, marker):
        # the single-quoted argument following the marker; markers may or may
        # not include the opening quote, so handle both
        head = cmd.split(marker, 1)[1]
        if head.startswith("'"):
            head = head[1:]
        return head.split("'", 1)[0]

    def _exists_form(self, cmd):
        # [ -e ] is true for directories too
        path = self._arg(cmd, "[ -e ")
        if path in self.files:
            return "yes"
        return "yes" if any(p.startswith(path.rstrip("/") + "/") for p in self.files) else "no"

    def _file_form(self, cmd):
        # [ -f ] is true for regular files only; a mid-flight switch hides
        # its done verdict (log without done is the in-progress signature)
        path = self._arg(cmd, "[ -f ")
        if self.log_without_done and path.endswith("/switch.done"):
            return "no"
        return "yes" if path in self.files else "no"

    def _dir_form(self, cmd):
        path = self._arg(cmd, "[ -d ")
        return "yes" if any(p.startswith(path.rstrip("/") + "/") for p in self.files) else "no"

    def _find_form(self, cmd):
        root = self._arg(cmd, "find '")
        return "\n".join(sorted(p for p in self.files if p.startswith(root.rstrip("/") + "/")))

    def _wc_form(self, cmd):
        path = self._arg(cmd, "wc -c < '")
        return str(len(self.files[path])) if path in self.files else ""

    def _md5_form(self, cmd):
        path = self._arg(cmd, "md5sum '")
        if path not in self.files:
            return ""
        return md5(self.files[path])

    def _base64_form(self, cmd):
        path = self._arg(cmd, "base64 '")
        if path not in self.files:
            return ""
        return base64.b64encode(self.files[path]).decode()

    def _tarhelp_form(self, cmd):
        return "tar: applet not found" if not self.tar_on_tv else "Usage: tar [cfhvX]..."

    def _mv_form(self, cmd):
        # "<BB> mkdir -p '<parent>' && mv '<stage>/<rel>' '<target>' && <BB> md5sum '<target>' ..."
        if " && mv '" not in cmd:
            return ""  # bare mkdir -p
        stage_part, rest = cmd.split(" && mv '", 1)
        staged, target = rest.split("' '", 1)
        target = target.split("' &&", 1)[0]
        # staged is "<RESTORE_STAGE>/<rel>"; the fixture resolves it against
        # the tar captured in the binary lane.
        data = self._staged.get(staged)
        if data is None:
            raise AssertionError("mv of unstaged path: %s" % staged)
        self.written[target] = data
        self.files[target] = data
        return md5(data)

    def _rm_form(self, cmd):
        self._staged = {}
        return ""

    # ---- the binary lane (alvidaa._tv_bytes) --------------------------------

    def binary(self, cmd, data=None, timeout=None):
        if cmd.startswith(BB + " tar cf - "):
            roots = [part.split("'")[1] for part in cmd.split(" '")[1:]]
            buf = io.BytesIO()
            with tarfile.open(fileobj=buf, mode="w") as t:
                for path in sorted(self.files):
                    if any(path == r or path.startswith(r.rstrip("/") + "/") for r in roots):
                        info = tarfile.TarInfo(path.lstrip("/"))
                        info.size = len(self.files[path])
                        t.addfile(info, io.BytesIO(self.files[path]))
            return buf.getvalue()
        if "cat > %s/restore.tar" % ALVIDAA.RESTORE_STAGE in cmd:
            self.staged_tar = data
            self._staged = {}
            with tarfile.open(fileobj=io.BytesIO(data)) as t:
                for member in t.getmembers():
                    self._staged["/" + ALVIDAA.RESTORE_STAGE.lstrip("/") + "/" + member.name] = \
                        t.extractfile(member).read()
            return b"STAGE-OK"
        raise AssertionError("fixture does not implement binary command: %s" % cmd)


def install(fake):
    """Point both transport seams at the fixture."""
    return [patch.object(ALVIDAA, "tv", fake.text),
            patch.object(ALVIDAA, "_tv_bytes", fake.binary)]


class ReferenceTV(FakeTV):
    """The reference TV's mutable set, as the ledger knows it."""

    def __init__(self):
        super().__init__()
        self.add("/var/local/alvidaa/config.json", '{"watcher":{"enabled":false}}')
        self.add("/var/local/alvidaa/native-home/backup/app.js.stock", b"/* pinned stock */" * 512)
        self.add("/var/local/alvidaa/native-home/candidate-native-home.js", b"/* candidate */" * 256)
        self.add("/var/local/alvidaa/ota_freeze.state", '{"frozen_at":"2026-11-12T00:00:00Z"}')
        self.add("/var/local/otaTest.sh", "#!/bin/sh\nexec /var/local/tvfw\n")
        self.add("/var/local/tvfw", "#!/bin/sh\niptables -A OUTPUT -j REJECT\n")
        self.add("/var/local/hook.off", "")
        self.add("/var/local/alvidaa/native-home/switch.done", "OK mode=install new=4243")
        self.add("/var/local/alvidaa/native-home/switch.log", "=== switch-home mode=install ===")


class BackupRestoreTestCase(unittest.TestCase):
    def run_backup(self, fake, out_dir, extra=None):
        with patch.multiple(ALVIDAA, tv=fake.text, _tv_bytes=fake.binary):
            code = ALVIDAA.cmd_backup(["--out", out_dir] + (extra or []))
        manifest_file = [f for f in os.listdir(out_dir) if f.endswith(".manifest.json")][0]
        with open(os.path.join(out_dir, manifest_file), "r", encoding="utf-8") as f:
            manifest = json.load(f)
        return code, manifest, os.path.join(out_dir, manifest["archive"])

    def run_restore(self, fake, directory, only):
        with patch.multiple(ALVIDAA, tv=fake.text, _tv_bytes=fake.binary):
            return ALVIDAA.cmd_restore([directory, "--only", only])

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.out = os.path.join(self._tmp.name, "out")
        os.makedirs(self.out)

    def fresh_tv(self):
        fake = ReferenceTV()
        for p in install(fake):
            p.start()
            self.addCleanup(p.stop)
        return fake


class BackupTests(BackupRestoreTestCase):
    def test_manifest_contents_for_the_reference_tv(self):
        fake = self.fresh_tv()
        code, manifest, archive = self.run_backup(fake, self.out)
        self.assertEqual(code, 0)
        paths = {e["path"] for e in manifest["entries"]}
        for expected in ["/var/local/alvidaa/config.json",
                         "/var/local/alvidaa/native-home/backup/app.js.stock",
                         "/var/local/alvidaa/ota_freeze.state",
                         "/var/local/otaTest.sh", "/var/local/tvfw",
                         "/var/local/hook.off"]:
            self.assertIn(expected, paths, expected)
        for entry in manifest["entries"]:
            self.assertEqual(entry["md5"], md5(fake.files[entry["path"]]))
            self.assertEqual(entry["size"], len(fake.files[entry["path"]]))
        # the archive is auditable: sha256 on the host, tar streamed from the TV
        with open(archive, "rb") as f:
            self.assertEqual(hashlib.sha256(f.read()).hexdigest(), manifest["archive_sha256"])
        self.assertTrue(manifest["tar_on_tv"])
        # keys are named as excluded, never riding the entries
        self.assertIn("/etc/dropbear", [x["path"] for x in manifest["excluded"]])
        self.assertNotIn("/etc/dropbear", paths)

    def test_a_never_touch_path_is_refused_and_nothing_is_written(self):
        fake = self.fresh_tv()
        fake.add("/OAD/pkgs/download/pkg.ipk", b"ota staging")
        with patch.object(ALVIDAA, "MUTABLE_PATHS",
                          ["/var/local/alvidaa", "/OAD/pkgs", "/var/local/otaTest.sh"]):
            with patch.multiple(ALVIDAA, tv=fake.text, _tv_bytes=fake.binary):
                code = ALVIDAA.cmd_backup(["--out", self.out])
        self.assertEqual(code, 1)
        self.assertEqual(os.listdir(self.out), [], "a refused backup writes nothing")

    def test_key_material_inside_the_set_is_excluded_and_named(self):
        fake = self.fresh_tv()
        fake.add("/var/local/alvidaa/bridge.token", b"sekrit-token")
        code, manifest, archive = self.run_backup(fake, self.out)
        self.assertEqual(code, 0)
        self.assertNotIn("/var/local/alvidaa/bridge.token",
                         [e["path"] for e in manifest["entries"]])
        excluded = {x["path"]: x["reason"] for x in manifest["excluded"]}
        self.assertIn("/var/local/alvidaa/bridge.token", excluded)
        self.assertIn("key", excluded["/var/local/alvidaa/bridge.token"])

    def test_without_tar_on_the_tv_files_are_pulled_and_tared_on_the_host(self):
        fake = self.fresh_tv()
        fake.tar_on_tv = False
        code, manifest, archive = self.run_backup(fake, self.out)
        self.assertEqual(code, 0)
        self.assertFalse(manifest["tar_on_tv"])
        with tarfile.open(archive) as t:
            member_paths = {"/" + m.name for m in t.getmembers()}
            self.assertEqual(member_paths, {e["path"] for e in manifest["entries"]})
            for entry in manifest["entries"]:
                data = t.extractfile(entry["path"].lstrip("/")).read()
                self.assertEqual(md5(data), entry["md5"])


class RestoreTests(BackupRestoreTestCase):
    def prepare(self):
        fake = self.fresh_tv()
        code, manifest, archive = self.run_backup(fake, self.out)
        self.assertEqual(code, 0)
        for p in install(fake):
            p.start()
            self.addCleanup(p.stop)
        return fake, manifest, archive

    def test_restore_without_only_refuses_and_lists_the_archive(self):
        fake, manifest, _ = self.prepare()
        with patch.multiple(ALVIDAA, tv=fake.text, _tv_bytes=fake.binary):
            code = ALVIDAA.cmd_restore([self.out])
        self.assertEqual(code, 2)

    def test_restore_only_writes_exactly_that_path_and_verifies_md5(self):
        fake, manifest, _ = self.prepare()
        code = self.run_restore(fake, self.out, "/var/local/alvidaa/config.json")
        self.assertEqual(code, 0)
        self.assertEqual(list(fake.written), ["/var/local/alvidaa/config.json"],
                         "restore is per-path: exactly the named write, nothing else")
        self.assertEqual(fake.written["/var/local/alvidaa/config.json"],
                         b'{"watcher":{"enabled":false}}')

    def test_restore_only_a_directory_restores_every_entry_under_it(self):
        fake, manifest, _ = self.prepare()
        code = self.run_restore(fake, self.out, "/var/local/alvidaa/native-home")
        self.assertEqual(code, 0)
        self.assertEqual(set(fake.written),
                         {"/var/local/alvidaa/native-home/backup/app.js.stock",
                          "/var/local/alvidaa/native-home/candidate-native-home.js",
                          "/var/local/alvidaa/native-home/switch.done",
                          "/var/local/alvidaa/native-home/switch.log"})

    def test_restore_refuses_a_read_only_target(self):
        fake, manifest, _ = self.prepare()
        code = self.run_restore(fake, self.out, "/APPS/channelA/hisenseUI/index.html")
        self.assertEqual(code, 1)
        self.assertEqual(fake.written, {}, "nothing written outside the writable lane")

    def test_restore_refuses_a_never_touch_target(self):
        fake, manifest, _ = self.prepare()
        code = self.run_restore(fake, self.out, "/var/local/alvidaa/config.json.bak-nativetest")
        self.assertEqual(code, 1)
        self.assertEqual(fake.written, {})

    def test_restore_refuses_mid_switch(self):
        fake, manifest, _ = self.prepare()
        fake.log_without_done = True
        code = self.run_restore(fake, self.out, "/var/local/alvidaa/config.json")
        self.assertEqual(code, 1)
        self.assertEqual(fake.written, {}, "nothing written while a switch is in flight")

    def test_restore_refuses_a_tampered_archive_before_any_write(self):
        fake, manifest, archive = self.prepare()
        with open(archive, "ab") as f:
            f.write(b"tampered")
        code = self.run_restore(fake, self.out, "/var/local/alvidaa/config.json")
        self.assertEqual(code, 1)
        self.assertEqual(fake.written, {})

    def test_restore_refuses_when_archive_md5_disagrees_with_the_manifest(self):
        fake, manifest, archive = self.prepare()
        manifest["entries"][0]["md5"] = "0" * 32
        with open(os.path.join(self.out,
                               [f for f in os.listdir(self.out) if f.endswith(".manifest.json")][0]),
                  "w", encoding="utf-8") as f:
            json.dump(manifest, f)
        code = self.run_restore(fake, self.out, manifest["entries"][0]["path"])
        self.assertEqual(code, 1)
        self.assertEqual(fake.written, {}, "md5 mismatch refuses before any write")


class NeverTouchParityTest(unittest.TestCase):
    """The Python guard and never-touch.cjs read the SAME rules file, so a rule
    that fires in one and not the other is a hole in a write lane. The glob
    rules are where the two implementations can drift: split('*') yields the
    segments between asterisks, never the asterisk, so the wildcard has to be
    emitted by the join."""

    def test_glob_rule_matches_a_device_path(self):
        hit = ALVIDAA._never_touch_hit("/dev/mmcblk0p20")
        self.assertIsNotNone(hit, "the raw-emmc glob must catch a device node")
        self.assertEqual(hit["id"], "raw-emmc")

    def test_glob_matches_the_bare_prefix_too(self):
        # '*' is zero-or-more, so the bare prefix matches — verified against
        # never-touch.cjs, which returns raw-emmc for the same path. Parity, not
        # preference: the two guards must agree on every path, including the
        # ones where the answer is unintuitive.
        hit = ALVIDAA._never_touch_hit("/dev/mmcblk")
        self.assertIsNotNone(hit)
        self.assertEqual(hit["id"], "raw-emmc")

    def test_glob_does_not_cross_a_slash(self):
        self.assertIsNone(ALVIDAA._never_touch_hit("/dev/mmcblk0p20/child"),
                          "'*' stops at '/', same as never-touch.cjs")

    def test_an_ordinary_path_is_not_a_hit(self):
        self.assertIsNone(ALVIDAA._never_touch_hit("/var/local/alvidaa/config.json"))


if __name__ == "__main__":
    unittest.main()
