# Restore Home behind the native Settings drawer

The operator reported that native Settings opens over black rather than over
Free My TV Home. They specifically identified Home as the preceding screen;
this is not a report of video playback being stopped by Settings.

The adapter's `deactivated` hook calls `stop()`, which clears the Home DOM while
releasing listeners, timers and idle hooks. Retaining the visual contents fixes
the missing backdrop on the actual TV without changing native Settings geometry.

The correction retains an inert visual copy only for a native Settings
route, using SDK module identity rather than path guesses. The live Home still
stops: it cannot steal Settings keys or run its own screensaver underneath.
The copy is hidden from accessibility, placed below the native shell, and removed
on Home reactivation, another module, document hiding or component destruction.
It is a static backdrop, not a second live launcher. Only Home DOM is copied;
opening Settings over other apps/video was not re-tested in this trial.

Offline tests cover preservation, canvas copying, runtime shutdown, route exit,
visibility loss, activation/destruction cleanup and clone failure. All 141 Node
tests pass. Actual Cobalt captures confirm the native Picture drawer over the
scrolled Home view, with the existing menu transparency, and a clean return Home.
Allow the native transition to settle: an immediate capture caught the upstream
Home drawer before native Settings appeared; a two-second wait showed the settled
native drawer with the correct backdrop.

## Guarded trial and preference-baseline trap

The first visual trial succeeded, but its acceptance guard compared preferences
to the historical theme-only hash. Current preferences also contained a nine-item
shelf. The guard refused acceptance and the existing controller automatically
restored Home `4d541b56…`; the current preference bytes remained intact. No attempt
was made to repair preferences back to the obsolete baseline.

The retry captured the current preference bytes first and verified them after
fresh context publication. It reused the exact trial recovery inputs only after
matching current/before metadata (apart from controller-owned engine/error fields),
previous and candidate hashes, and confirming that no update was pending. Shared
shell and normal Home update guards remained active.

Private space is tight. Only the rejected trial's generated JS caches were moved
to `/APPS/alvidaa-web-release-e458d54b/failed-backdrop-cache`, with hash-verified
copies and inventory records before removing the old copies. Original code,
state and recovery backups were retained. Neither origin storage nor accessibility
or hardware preferences were modified. The 64 MiB private-space reserve remained
intact; approximately 68.4 MB was free after installation.

## Installed result

- Home: `e33a1ed19f07a7a072f79f54b68617087f34811ee2508de0534e2b1c61ac1393`.
- Current preferences: auto theme and nine shelf entries; exact hash
  `6117b815026a8ff186c0f1b335008d59fa80a847212e53a296bf4a29097ac20a`.
- Recovery directory: `/var/local/alvidaa/native-home/update-0eY5JL`.
- Installed phase, no pending update; engine 5445, owned feed PID/group 2197,
  zero image failures; bootstrap still `5f6f1d20…`.
- TV returned to Home. Private captures were not published.

The prior operator playback/voice/accessibility and cold-boot results are recorded
in [findings 19](19-release-controller-trial.md); they were not all repeated after
this narrowly scoped presentation change. Legacy recovery retirement remains
separate work.
