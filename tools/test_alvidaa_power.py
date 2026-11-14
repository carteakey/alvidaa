"""Fixture-transport tests for `alvidaa power standby|reboot|status` (issue #11); no TV.

Same discipline as test_alvidaa_backup.py: the fixture implements the exact
command forms alvidaa.py issues and raises loudly on anything else, so a new
remote command must be taught here before it can pass. Runs on any host.
"""
import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("alvidaa", Path(__file__).with_name("alvidaa.py"))
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("cannot load alvidaa.py")
ALVIDAA = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ALVIDAA)

BB = "/var/local/tvtools/busybox"


class FakeTV:
    """The TV as the power command sees it: /proc/uptime, the hook markers,
    the kill-switch, the bridge's power route (present or not), and the TCP
    probes' answer."""

    def __init__(self):
        self.uptime_text = "1234.56 2345.67"
        self.hook_off_present = False
        self.tvfw_marker = ""          # e.g. "12.34"; "" = no marker this boot
        self.bridge_debug = None       # dict, or None -> fetch raises
        self.power_route = False       # does the bridge answer /api/power?
        self.reachable = True          # what the TCP probes report
        self.rebooted = 0              # reboot commands actually issued

    # ---- the text lane (alvidaa.tv) ----------------------------------------

    def text(self, cmd, timeout=None):
        if cmd.startswith("cat /proc/uptime"):
            return self.uptime_text
        if cmd.startswith("[ -e '/var/local/hook.off' ]"):
            return "yes" if self.hook_off_present else "no"
        if cmd.startswith("cat /var/local/tvfw.applied_at_boot"):
            return self.tvfw_marker
        if cmd == BB + " reboot -f":
            self.rebooted += 1
            return ""  # the channel dying mid-command is the reboot working
        raise AssertionError("fixture does not implement: %s" % cmd)

    # ---- the bridge lanes ---------------------------------------------------

    def fetch_raw(self, path):
        if path.startswith("/api/power"):
            if self.power_route:
                return "200", b'{"ok":true,"via":"mqtt"}'
            return "404", b"404 page not found\n"
        raise AssertionError("fixture does not implement fetch_raw: %s" % path)

    def fetch(self, path):
        if path == "/api/debug":
            if self.bridge_debug is None:
                raise OSError("bridge down")
            return self.bridge_debug
        raise AssertionError("fixture does not implement fetch: %s" % path)

    # ---- the probe lane ------------------------------------------------------

    def tcp_open(self, port, timeout=None):
        return self.reachable

    # ---- wiring --------------------------------------------------------------

    def install(self):
        return [patch.object(ALVIDAA, "tv", self.text),
                patch.object(ALVIDAA, "fetch_raw", self.fetch_raw),
                patch.object(ALVIDAA, "fetch", self.fetch),
                patch.object(ALVIDAA, "_tcp_open", self.tcp_open),
                patch.object(ALVIDAA, "_exists", self._exists)]

    def _exists(self, path):
        # _hook_safe_for_reboot calls the module's _exists, which rides tv();
        # route it through the same fixture so the seams stay single.
        return self.text("[ -e '%s' ] && echo yes || echo no" % path).strip() == "yes"


class PowerTestCase(unittest.TestCase):
    def run_power(self, fake, argv):
        for p in fake.install():
            p.start()
            self.addCleanup(p.stop)
        captures = []
        original = print
        try:
            code = ALVIDAA.cmd_power(argv)
        finally:
            pass
        return code, self._out

    def setUp(self):
        self._out = []
        real_print = print

        def capture(*a, **k):
            self._out.append(" ".join(str(x) for x in a))
        self._print_patch = patch("builtins.print", capture)
        self._print_patch.start()
        self.addCleanup(self._print_patch.stop)

    def output(self):
        return "\n".join(self._out)


class StatusTests(PowerTestCase):
    def test_status_parses_uptime_and_reports_the_probes(self):
        fake = FakeTV()
        for p in fake.install():
            p.start()
            self.addCleanup(p.stop)
        code = ALVIDAA.cmd_power(["status"])
        self.assertEqual(code, 0)
        out = self.output()
        self.assertIn("uptime      : 1235 s (0.3 h)", out)  # 1234.56 rounds to 1235
        self.assertIn("ssh 2222    : open", out)
        self.assertIn("bridge 8770 : open", out)
        self.assertIn("panel state : unmeasured", out, "no panel read is stated, not invented")
        self.assertIn("UNMEASURED", out, "wake-from-standby is never assumed")

    def test_status_reports_closed_probes_and_unreadable_uptime(self):
        fake = FakeTV()
        fake.reachable = False
        fake.uptime_text = ""
        for p in fake.install():
            p.start()
            self.addCleanup(p.stop)
        code = ALVIDAA.cmd_power(["status"])
        self.assertEqual(code, 0)
        out = self.output()
        self.assertIn("UNREADABLE", out, "a dead lane is a result, not a crash")
        self.assertIn("ssh 2222    : closed", out)
        self.assertIn("bridge 8770 : closed", out)


class RebootTests(PowerTestCase):
    def test_reboot_refuses_without_yes(self):
        fake = FakeTV()
        fake.tvfw_marker = "12.34"  # hook verified, so --yes is the only gate
        for p in fake.install():
            p.start()
            self.addCleanup(p.stop)
        code = ALVIDAA.cmd_power(["reboot"])
        self.assertEqual(code, 2)
        self.assertEqual(fake.rebooted, 0, "no reboot without the opt-in")
        self.assertIn("needs --yes", self.output())

    def test_reboot_refuses_when_the_kill_switch_check_fails(self):
        fake = FakeTV()
        # no hook.off, no marker, bridge hook dead: never verified
        fake.bridge_debug = {"hook": {"watchdogAlive": False, "killSwitch": False}}
        for p in fake.install():
            p.start()
            self.addCleanup(p.stop)
        code = ALVIDAA.cmd_power(["reboot", "--yes"])
        self.assertEqual(code, 1)
        self.assertEqual(fake.rebooted, 0, "the hook check gates even --yes")
        self.assertIn("refusing reboot", self.output())
        self.assertIn("never been verified", self.output())
        self.assertIn("hook.off", self.output(), "the safe path is named")

    def test_reboot_proceeds_when_the_hook_is_verified_by_the_marker(self):
        fake = FakeTV()
        fake.tvfw_marker = "12.34"
        for p in fake.install():
            p.start()
            self.addCleanup(p.stop)
        code = ALVIDAA.cmd_power(["reboot", "--yes"])
        self.assertEqual(code, 0)
        self.assertEqual(fake.rebooted, 1)
        self.assertIn("reboot issued", self.output())

    def test_reboot_proceeds_with_the_kill_switch_present(self):
        fake = FakeTV()
        fake.hook_off_present = True  # hook disarmed at next boot: no loop risk
        for p in fake.install():
            p.start()
            self.addCleanup(p.stop)
        code = ALVIDAA.cmd_power(["reboot", "--yes"])
        self.assertEqual(code, 0)
        self.assertEqual(fake.rebooted, 1)

    def test_reboot_refusal_names_the_safe_path(self):
        fake = FakeTV()
        fake.bridge_debug = None  # bridge down, no marker: unverifiable
        for p in fake.install():
            p.start()
            self.addCleanup(p.stop)
        code = ALVIDAA.cmd_power(["reboot", "--yes"])
        self.assertEqual(code, 1)
        self.assertIn("disarm", self.output())


class StandbyTests(PowerTestCase):
    def test_standby_uses_the_mqtt_action_when_the_bridge_has_it(self):
        fake = FakeTV()
        fake.power_route = True
        for p in fake.install():
            p.start()
            self.addCleanup(p.stop)
        code = ALVIDAA.cmd_power(["standby"])
        self.assertEqual(code, 0)
        out = self.output()
        self.assertIn("via the bridge MQTT session", out, "the MQTT action, through the existing session")
        self.assertIn("wake probe", out, "the wake is measured, never assumed")

    def test_standby_reports_an_unreachable_wake_as_unreachable(self):
        fake = FakeTV()
        fake.power_route = True
        fake.reachable = False
        for p in fake.install():
            p.start()
            self.addCleanup(p.stop)
        code = ALVIDAA.cmd_power(["standby"])
        self.assertEqual(code, 0, "the standby succeeded; the wake measurement is informational")
        out = self.output()
        self.assertIn("NOT reachable over the network", out)
        self.assertIn("physical power", out)

    def test_standby_refuses_when_the_bridge_has_no_power_route(self):
        fake = FakeTV()
        fake.power_route = False
        for p in fake.install():
            p.start()
            self.addCleanup(p.stop)
        code = ALVIDAA.cmd_power(["standby"])
        self.assertEqual(code, 1)
        out = self.output()
        self.assertIn("refused: no MQTT power action", out)
        self.assertIn("one session per TV", out, "the reason is printed, never silent")
        self.assertIn("GUESS (116", out, "the unmeasured keycode is named as the reason")

    def test_standby_wake_probe_still_reports_when_reachable(self):
        fake = FakeTV()
        fake.power_route = True
        fake.reachable = True
        for p in fake.install():
            p.start()
            self.addCleanup(p.stop)
        code = ALVIDAA.cmd_power(["standby"])
        self.assertEqual(code, 0)
        self.assertIn("POSSIBLE", self.output())
        self.assertNotIn("NOT reachable", self.output())
