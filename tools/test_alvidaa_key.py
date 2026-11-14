#!/usr/bin/env python3
"""Tests for alvidaa.py key injection (issue #12) — fixture transport, no TV.

The fixture replaces two module functions: alvidaa.tv (captures the command
the device lane would run over server/tv) and alvidaa.mqtt_route (the
transport-order switch). Everything else is the real module code.
"""
import contextlib
import importlib.util
import io
import re
import struct
import unittest
from pathlib import Path

# The house loader (test_native_web_package.py): load alvidaa.py by path so
# the tests run from any cwd and never depend on tools/ being on sys.path.
_SPEC = importlib.util.spec_from_file_location("alvidaa", Path(__file__).with_name("alvidaa.py"))
alvidaa = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(alvidaa)


def parse_events(cmd):
    """Pull every 16-byte input_event back out of the emitted shell command,
    decoding the printf '%b' arguments the same way the TV's printf would."""
    events = []
    for arg in re.findall(r"printf '%b' '([^']+)'", cmd):
        raw = bytes(int(t, 16) for t in re.findall(r"\\x([0-9a-f]{2})", arg))
        events.append(struct.unpack("<LLHHi", raw))
    return events



def run_key(args):
    """Run cmd_key with stdout captured: the module prints its verdict, the
    tests assert on it. Returns (exit_code, captured_text)."""
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = alvidaa.cmd_key(list(args))
    return code, buf.getvalue()


class KeyTable(unittest.TestCase):
    def test_verified_keys_carry_their_measured_codes(self):
        # Measured on the reference unit by the doom lane (DOOM.md: BT remote
        # on /dev/input/event3). ok=352 is a dedicated keycode, not Enter.
        for name, code in [("up", 103), ("down", 108), ("left", 105),
                           ("right", 106), ("ok", 352)]:
            self.assertEqual(alvidaa.KEYS[name], (code, True), name)

    def test_home_and_back_are_marked_guesses(self):
        # The doom map logged BACK/HOME as unmapped: never measured here.
        self.assertEqual(alvidaa.KEYS["home"], (102, False))
        self.assertEqual(alvidaa.KEYS["back"], (158, False))

    def test_unknown_key_refused_with_the_known_list(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = alvidaa.cmd_key(["channel-up"])
        self.assertEqual(code, 2)
        text = buf.getvalue()
        self.assertIn("unknown key: channel-up", text)
        self.assertIn("ok", text)
        self.assertIn("home", text)


class TransportOrder(unittest.TestCase):
    def setUp(self):
        self.sent, self.routes = [], []

    def capture_tv(self, cmd, timeout=25):
        self.sent.append(cmd)
        return ""

    def test_mqtt_route_is_preferred_and_the_device_lane_never_runs(self):
        alvidaa.mqtt_route = lambda: (lambda *a: None, None)
        alvidaa.tv = self.capture_tv
        code, text = run_key(["ok"])
        self.assertEqual(code, 0)
        self.assertEqual(self.sent, [], "no device write when MQTT carries the key")
        self.assertIn("transport: mqtt", text)

    def test_device_lane_is_the_fallback_and_names_the_reason(self):
        reason = "no session-safe route"
        alvidaa.mqtt_route = lambda: (None, reason)
        alvidaa.tv = self.capture_tv
        code, text = run_key(["ok"])
        self.assertEqual(code, 0)
        self.assertEqual(len(self.sent), 1, "one SSH command for one tap")
        self.assertIn("transport: device", text)
        self.assertIn(reason, text,
                        "the fallback says why MQTT was unavailable")

    def test_event_bytes_round_trip_as_armv7_input_events(self):
        alvidaa.mqtt_route = lambda: (None, "reason")
        alvidaa.tv = self.capture_tv
        run_key(["ok"])
        events = parse_events(self.sent[0])
        self.assertEqual(events, [(0, 0, 1, 352, 1), (0, 0, 1, 352, 0)],
                         "press then release, timeval zeroed, EV_KEY, code 352")

    def test_home_always_maps_and_rides_the_device_lane(self):
        alvidaa.mqtt_route = lambda: (None, "reason")
        alvidaa.tv = self.capture_tv
        code, text = run_key(["home"])
        self.assertEqual(code, 0)
        self.assertIn((0, 0, 1, 102, 1), parse_events(self.sent[0]),
                      "KEY_HOME guess (102) — but always mapped, always sent")


class CountAndDelay(unittest.TestCase):
    def setUp(self):
        self.sent = []
        alvidaa.mqtt_route = lambda: (None, "reason")
        alvidaa.tv = lambda cmd, timeout=25: self.sent.append(cmd) or ""

    def test_count_is_capped_at_a_small_number(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = alvidaa.cmd_key(["up", "--count", "9"])
        self.assertEqual(code, 2)
        self.assertEqual(self.sent, [], "a refused count writes nothing")
        self.assertIn("capped", buf.getvalue())

    def test_count_below_one_clamps_to_a_single_press(self):
        run_key(["up", "--count", "0"])
        self.assertEqual(len(parse_events(self.sent[0])), 2, "one tap = press+release")

    def test_count_three_sends_three_taps_with_delays_between(self):
        run_key(["up", "--count", "3", "--delay", "250"])
        cmd = self.sent[0]
        events = parse_events(cmd)
        self.assertEqual(events, [(0, 0, 1, 103, 1), (0, 0, 1, 103, 0)] * 3,
                         "three taps of KEY_UP")
        self.assertEqual(cmd.count("sleep 0.25"), 2, "delay between taps, not after the last")

    def test_delay_default_is_the_module_constant(self):
        run_key(["up", "--count", "2"])
        self.assertIn("sleep %.2f" % (alvidaa.DEFAULT_DELAY_MS / 1000.0), self.sent[0])


class Usage(unittest.TestCase):
    def setUp(self):
        self.sent = []
        alvidaa.tv = lambda cmd, timeout=25: self.sent.append(cmd) or ""

    def test_no_key_prints_usage_and_the_key_list(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = alvidaa.cmd_key([])
        self.assertEqual(code, 2)
        text = buf.getvalue()
        self.assertIn("usage:", text)
        self.assertIn("keys:", text)
        self.assertEqual(self.sent, [])

    def test_unknown_flag_is_a_usage_error(self):
        self.assertEqual(alvidaa.cmd_key(["ok", "--hold"]), 2)
        self.assertEqual(self.sent, [], "a refused flag writes nothing")

    def test_device_flag_reaches_the_command(self):
        alvidaa.mqtt_route = lambda: (None, "reason")
        run_key(["ok", "--device", "/dev/input/event7"])
        self.assertIn("/dev/input/event7", self.sent[0])


if __name__ == "__main__":
    unittest.main()
