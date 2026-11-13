#!/bin/sh
# sftp-srvr — the SFTPSERVER_PATH entry in the patched dropbear (findings 02).
# dropbear execs this directly for the sftp subsystem (no args). OpenSSH
# sftp-server with no -d chroots to the passwd home — /basic on this TV — so
# pin the root to / for whole-filesystem access. One log line per session.
echo "sftp-srvr: exec sftp-server -d / at $(date)" >> /APPS/.re_sshd/sftp-srvr.log 2>&1
exec /APPS/.re_sshd/sftp-server -d / "$@"
