# 08 — Ad removal on VIDAA (55E7QTUK, standard tier) 2026-11-08

Owner-scoped ad-removal on the boot-persistent-root unit. Deployed as an
`adsfw` stage inside the `re.installer` postinst (the same boot-timed
root context that already applies the OTA freeze), after mapping this
unit's own domain surface — the GBR build ships the **EU variants** of
the reference endpoint families.

## This unit's ad/telemetry host families (verified from
`/APPS/domain/domain_list.json`, `ReleaseDate 2026-08-03`)

- **Tier 1 — telemetry/event beacons:** `evt-eu`, `ter-jrnl-eu`,
  `exc-jrnl-eu`, `policy-jrnl-eu`, `dvcstatus-dataretrv`, `file-ul`
- **Tier 2 — ad content + promo rows:** `rsc-ads`, `rsc-mntz`
  (monetization), `recommend-ui-eu`, `home-ui-eu`, `layout-ui-eu`,
  `topic-ui-eu`, `abtest-tv`, `sport-vidaa`
- **Kept allowed** (function-critical or owner-chosen): `ota-tv`,
  `upgrade-plc-tv-eu` (and their shared CDN `131.189.69.51` — frozen
  anyway per the owner's OTA decision), `vidaa-base-auth-eu`,
  `oauth-auth-eu`, `geo-bas-eu`, `bas-eu`, `time-bas-eu`, the voice
  family (`voice-eu`, `vidaa-voice-eu`, `tts-voice-eu`, `google-voice`,
  `amazon-voice`, `partners-voice`, `iot-voice-eu`, `base-ai/-iot`),
  the detail/search/category/member/params UI family, `appstore/odinstore`,
  `web`/`domain`.
- `dohServers: dns.google/dns-query` + `dohDomains: vidaahub.com` — the
  DoH bypass is already dead on this unit: the OTA-freeze firewall blocks
  the `8.8.8.8/8.8.4.4` DNS/DoH lane at boot, so vidaahub lookups fall
  back to the LAN resolver where any resolver-side rules can also apply.

## The adsfw stage (in the `re.installer` postinst, boot-timed)

1. `adsfw.hosts` ships inside the IPK (`./APPS/.re_sshd/adsfw.hosts`,
   14 hosts, redact/comment-annotated) and the postinst moves it into
   `/APPS/.re_sshd/` (the mv list needed its own row — the package-tree
   `SRC → D` move only handled dropbear/key/keys before).
2. Background stage on boot: `sleep 25` (LAN DNS needs ~25–35 s after
   cold boot — findings 12), then per host:
   `/usr/local/bin/busybox nslookup <host>` → A records →
   `iptables -I OUTPUT N -d <ip> -j REJECT` (idempotent via `-C`),
   appending `resolved <host> -> <ip>` lines to
   `/APPS/.re_sshd/adsfw.log`. IPv6 answers are skipped
   (`ip6tables` is absent; the family record keeps the kernel-side
   block v4-only).
3. Resolver lesson (logged as a trap): **`cut` is absent from the
   postinst PATH; the busybox wrapper `"$BUSY" cut` is the working
   form** — the first run wrote 14 `command not found` lines and zero
   rules.
4. Measured deployed run (manual drive of the stage during the deploy):
   14 Tier-1/2 hosts resolved; 12 v4 rules inserted (14 − 2 duplicates
   for shared CDN IPs), 15 total OUTPUT REJECTs incl. the 3
   OTA/DoH freeze rules. The boot-persistent cycle re-fires this on
   every cold boot.

## Fallback behavior (what the owner should expect)

Blocking `recommend/home/layout/topic` renders the home's sponsored /
fresh / themed rows empty — the reference's own deployed posture; the
apps row (installed apps), inputs and Settings still resolve (those go
through the local app registry, not the blocked UI endpoints). Ad-tiles
from `rsc-ads` fail silently. The DoH note above means the ads can't
workaround the block via their vendor-supplied DoH path.

Teardown: remove the `adsfw.hosts` mv + stage from the postinst (or
uninstall the package per findings 05) and delete the OUTPUT REJECTs
for the resolved IPs; the IPs are logged per-host in
`/APPS/.re_sshd/adsfw.log`.

## Boot-test note (honest)

The sysrq restart used for the boot-level test left the TV's network
stack down this time: after `echo b > /proc/sysrq-trigger` the box went
dark on all measured ports (`8008/36669/3366` closed). No boot-side
adsfw+root evidence could be gathered from the network lane; the
previous sysrq boot (finding 06) DID re-arm — this run's crash dark
state is consistent with an emergency-restart leaving the wireless
stack un-initialized; **a mains cycle by the owner is the recovery
path** (the persistence stack is intact on disk: `services/re_sshd`,
pristine serviceList backup, installer IPK, packaged adsfw hosts).

Next boot's adsfw.log (fresh postinst, ownerказыва).

## Boot-native run (verified, owner mains cycle 2026-11-08)

After the power cycle: `uptime 43.94 s`, root session restored (`Uid 0`, `CapEff 000001ffffffffff`), dropbear pid **2485** (fresh), adsfw.log carries the boot-native resolve run (111 lines across deployed history), and the kernel plane measured **15 OUTPUT REJECTs** (3 freeze + 12 ad v4 rules) within the first minute of boot.

The ad-removal state is now boot-native, no-manual-work: every cold boot re-fires resolve + block, so no LAN machine ever has to fight the per-IP movement explicitly.
