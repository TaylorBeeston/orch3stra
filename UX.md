# Workspace navigation · 2.0.1

## One place for each kind of work

The large top toolbar is replaced by five work areas. The underlying features are
still present; their original buttons remain available through **All tools / settings**.

- **Overview**: project summary and the four main steps.
- **Story**: brief, joint story/cast development, refinement and pacing.
- **References**: characters/files, Fill missing coverage, image/voice studios,
  scene reference planning and Clinic.
- **Timeline**: real monitor, timeline, window selection, render controls and editing.
  **Window settings** exposes timing, overlap, entry/exit state and direct references
  without keeping an always-open inspector on the screen.
- **Post**: the independent finishing room and export/backups.

**Activity** provides existing render, sequence, queue and AI request monitors.
**All tools / settings**, also opened with Ctrl/Cmd+K, is searchable. Selecting an
area, opening a tool or going Back does not start AI/GPU work.

## Back versus close

The shared tool dialog has a persistent Back control and breadcrumb. Opening a
child tool temporarily detaches the parent DOM rather than serializing/rebuilding
it. Back restores that parent's form values, element listeners, nested scroll
positions and focus where possible. The previously selected window is restored too,
so a parent inspector cannot accidentally edit a different window. Escape follows Back; the × closes the whole
tool stack. Returning to a different project discards the old stack instead of
showing an editor that belongs to another project.

This is **in-app navigation**, not integration with the browser's Back history.
The stack is bounded to twelve parents. It is not a substitute for committing edits:
use Save/Apply before browser refresh or close. Existing tools with their own separate
workspace (for example Post) retain their own close controls. Existing workflow-specific
Back buttons remain for compatibility.

Large tool surfaces use most of the viewport, while focused asset editors can remain
smaller. Phone layouts stack controls and use the visible viewport height. Activity
notifications retain their existing top-layer behavior.

## Recovery stays in the active task

Fill missing coverage shows an actionable next step rather than requiring library
cleanup for malformed model replies. See INSPECTION-REPAIR.md. Candidate rejection,
correction text, explicit extra-attempt permission and fresh generation are in the
same place. Parent form inputs survive a visit to Connections.

All permissions, source ownership, exact-ID checks, stale-result protections and
serial renderer reservations remain in force. This navigation layer does not rewrite
projects, clear queues, enable autonomous work, or migrate stored project schemas.

## Deployment

This is a Node/editor-only upgrade from the supplied 1.9.3 package. The Python worker,
legacy plugin, launcher and dependency files are unchanged. Keep the running worker's
old release directory, H3_DATA_DIR, browser profile and exact editor origin.

Stop the old Node coordinator after parking ongoing automatic work; run
`node start-headless.mjs` in this release. Do not run `--stop` merely for this update.
The bridge reports 2.0.1; an unchanged 1.9.2 worker version is expected.

The earlier 2.0.0 download/source was not available in this workspace. This package
contains the newly implemented navigation shell, tested alongside the actual available
1.9.3 functionality, rather than claiming to recover unseen 2.0.0 source.

## Validation boundary

The full-shell Chromium regression exercises the navigation, parent form restoration,
inspection repair, candidate retry and window settings at desktop and portrait sizes.
Legacy feature suites separately exercise the existing tool components without the
navigation shell. They are not counted as full-navigation tests. Browser storage and
provider/backend transports are modeled; real HTTP/files/media processing are covered
by separate Node/Python suites. No physical-phone or live provider/GPU test is claimed.
