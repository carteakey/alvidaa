#!/bin/sh
# phone-shot.sh — the ONLY command the phone's SSH key may run (forced command
# in the root authorized_keys). Takes a screenshot of what the TV shows,
# prints it as one line of base64 on stdout, and deletes it again.
#
# Install anywhere on rw storage (55U61KEVS: /var/local/alvidaa/phone-shot.sh),
# invoked as `/bin/sh <path>`
# (on that unit /var/local runs no ELF binaries and ignores shebangs).
# Converter: SHOTCONV below (source: tools/shotconv/); without it, use mode png.
# Absolute paths throughout: SSH sessions on this TV carry no PATH.
#
# Whatever the phone sends as "command" arrives in SSH_ORIGINAL_COMMAND and is
# never executed. Only its first word picks the mode:
#   shot (or anything else)  JPEG, converted from HDR when the frame looks like HDR
#   raw                      JPEG, never converted
#   hdr                      JPEG, always converted
#   png                      the untouched original PNG (lossless, large)
# A short log goes to /tmp/phone-shot.log (tmpfs, gone at reboot).
PATH=/bin:/usr/bin:/usr/local/bin
SHOTCONV=/APPS/.re_sshd/shotconv
F=/tmp/phone-shot-$$.jpg   # the vendor tool writes PNG bytes whatever the name says
OUT=/tmp/phone-shot-$$-out.jpg

# Capture first: the frame is taken ~0.1 s after this call, the rest can wait.
read up _ < /proc/uptime
/usr/local/bin/screenshot /tmp "phone-shot-$$.jpg" >/dev/null 2>&1

set -- ${SSH_ORIGINAL_COMMAND:-shot}
case "$1" in raw|hdr|png) MODE=$1 ;; *) MODE=auto ;; esac

# Wait for a complete PNG: on the 55U61KEVS the file appears in one step, end
# marker included, but checking for IEND keeps this independent of that.
n=0
while [ $n -lt 100 ] && ! { [ -s "$F" ] && /bin/grep -q IEND "$F"; }; do /bin/sleep 0.2; n=$((n+1)); done
if ! /bin/grep -q IEND "$F" 2>/dev/null; then
  /bin/sleep 5; /bin/rm -f "$F"
  echo "ERROR: no frame after 20 s, try again"
  exit 1
fi

if [ "$MODE" = png ]; then
  NOTE="png: original"
  /usr/local/bin/openssl base64 -A -in "$F"
else
  NOTE=$("$SHOTCONV" "$F" "$OUT" "$MODE" 2>&1)
  if [ -s "$OUT" ]; then
    /usr/local/bin/openssl base64 -A -in "$OUT"
  else   # converter failed: say so instead of sending a PNG the phone saves as .jpg
    NOTE="$NOTE (converter failed)"
    echo "ERROR: converter failed; send the word png to get the original PNG"
  fi
fi
printf '%s uptime=%s input=%s %s\n' "$(/bin/date +%H:%M:%S)" "$up" \
  "$(/bin/cat /var/local/current_source_app 2>/dev/null)" "$NOTE" >> /tmp/phone-shot.log
/bin/rm -f "$F" "$OUT"
