# phone-capture — one tap on a phone, a screenshot of the TV

What was on screen when you tapped, as a JPEG in the phone's share sheet.
Measured: 316–355 ms from the Shortcut's first action to the captured frame;
the time iOS takes to launch the Shortcut comes on top (felt as roughly half a
second in total). Built on the vendor capture tool (see
[docs/research/11-screen-capture.md](../../docs/research/11-screen-capture.md))
and, for HDR sources, [`shotconv`](../shotconv/).

The phone gets **its own SSH key that can run exactly one script** — no shell,
no forwarding. Even if the phone or the Shortcut leaks, that key can only take
screenshots.

## TV side

1. Copy `phone-shot.sh` to rw storage, e.g. `/var/local/alvidaa/phone-shot.sh`,
   `chmod 700`. Set `SHOTCONV` at its top if `shotconv` lives elsewhere (or skip
   `shotconv` and always ask for `png`).
2. Back up the root key file (on the 55U61KEVS re_sshd setup:
   `/APPS/.re_sshd/root_home/.ssh/authorized_keys`), then append the phone's
   public key with a forced command:

   ```
   command="/bin/sh /var/local/alvidaa/phone-shot.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA… phone
   ```

   Dropbear 2022.83 honours all of these. Verify with a throwaway key first:
   any command (`id`, `cat /etc/passwd`) and an interactive login must return
   only base64; `ssh -N -L …` must fail with "administratively prohibited".

## Phone side (iOS Shortcuts)

1. **Run Script Over SSH** — host `<tv-ip>`, the TV's SSH port, user `root`,
   authentication **SSH Key**: let iOS generate an ed25519 key and copy its
   public half into step 2 above. The private key never leaves the phone.
   **Script:** one word — `shot`. It must not be empty: an empty script returns
   nothing without an error, and only the next step fails.
2. **Base64 Decode** the Shell Script Result.
3. **Set Name** `tv.jpg` (`tv.png` for mode `png`), then **Share** or save.

The word picks the mode; anything else is ignored and never executed:

| word | result |
|---|---|
| `shot` | JPEG, converted from HDR when the frame looks like HDR |
| `raw` | JPEG, never converted |
| `hdr` | JPEG, always converted |
| `png` | the untouched original PNG |

To measure latency, put a **Date** → **Format Date** `HH:mm:ss.SSS` in front
and pass the Formatted Date as the script: digits survive into
`/tmp/phone-shot.log`.

## Notes

- The frame is grabbed ~0.1 s after the script starts; the 2–5 s that follow
  (PNG, conversion, transfer) do not change which moment you get — as long as no
  other capture is running. The TV processes captures one at a time, so a second
  tap during the first one's 2–4 s is captured only when its turn comes.
- No frame ever arrives while DRM-protected video plays (Crunchyroll playback;
  its menus capture fine), and rarely otherwise (seen twice in a row during a
  slow app start with a mostly black screen). The script then says so after
  ~25 s; outside protected playback, try again once the picture is up.
- Errors come back as one line of text starting with `ERROR:` instead of base64,
  so **Base64 Decode** is the step that fails. To see the message, put an **If**
  (Shell Script Result begins with `ERROR`) → **Show Alert** before it.
  If `shotconv` fails, the script reports that rather than sending a PNG the
  Shortcut would save as `.jpg`; the word `png` still returns the original.
- The tool captures whatever is on screen, including a work laptop on HDMI.

## Teardown

Remove the phone's line from `authorized_keys` (or restore the backup), then
`rm /var/local/alvidaa/phone-shot.sh` (and `/APPS/.re_sshd/shotconv` if
installed). `/tmp/phone-shot.log` disappears at reboot. Delete the Shortcut and
its key on the phone.
