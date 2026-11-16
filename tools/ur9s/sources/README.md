# Offline build sources

The 75UR9S build scripts expect the upstream source tarballs here:

- `openssh-9.9p1.tar.gz` — OpenSSH 9.9p1 portable (for the static sftp-server)

Download it from the upstream release page
(https://cdn.openbsd.org/pub/OpenBSD/OpenSSH/portable/) or set
`OPENSSH_SRC=/path/to/openssh-9.9p1.tar.gz`. No third-party source archive is
shipped in this repository.

The scripts verify the SHA-256 before building.
