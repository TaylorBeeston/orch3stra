> **1.8.0:** For the simple workflow, use **Fill references** and read **COVERAGE.md**.
> The controls below remain the advanced per-project checkpoint workflow. A standalone
> parked run can now explicitly upgrade its permissions without cancelling/replanning.
> Existing-image label verification is opt-in in advanced policies and on by default only
> in the explicitly started quick flow. Auto-application is opt-in and revision-guarded.

# Scene references, Clinic doctor, and bounded reference autonomy — 1.6.0

This release is based on the user's `h3-director-latest.zip`, including its IndexedDB,
Viggle profile, live Codex, and other OMP changes. It does not replace those systems.
The editor and Node coordinator are 1.6.0. The unchanged headless Python worker is
1.5.0 and the unused legacy plugin is 1.0.5. No new Python/package installation is needed.

## Start with a copy and one short scene

Export a portable backup. Stop/restart only Director's Node process from this release,
keeping the same H3_DATA_DIR and exact browser URL/profile. Start with
`node start-headless.mjs`; do NOT stop a running GPU worker for this update. Keep the
folder containing its running code. For systemd update/restart only the Director unit.
Park managed dispatch before switching coordinators. Active AI calls may be interrupted.
Existing queued/rendering snapshots are not retroactively opted into automation.

Open **Scene references** in the main toolbar, or **Film desk → Coverage**.

1. **Review scene grouping** suggests groups from contiguous beat titles. This is a
   proposal, never an automatic regrouping. You can instead ask the planner to propose
   boundaries from the story and continuity. Review location/time/state and apply.
2. In **Scene board**, select a scene and window. The bank is everything available;
   the task manifest is exactly what will be sent. Scene IDs survive title edits,
   explicit splits, deletions, and inserted windows assigned to that scene.
3. Annotate important images with subject, role, exact state/outfit, angle, approval
   and quality preference. A set picture containing people may be marked setting only.
   This is metadata, not a claim that an AI examined its pixels.
4. **Optimize inputs…** previews bindings only. **Only over-budget tasks…** limits it.
   It does not remove visible characters, change timing, edit dialogue or delete files.
5. Inspect pins/exclusions and missing requirements. **Unlock current manual selections**
   is explicit: until then, existing local choices, deliberate empty choices, direct
   props/sets and prose-referenced sources are preserved. Pins win over an optimizer;
   impossible pins produce an explanation, not a hidden truncation.
6. Draft with the actual task manifest. The draft can report a `referenceRequests`
   entry for missing coverage instead of inventing a picture or a subject.

## The four layers

Film library → scene bank → shot requirements → generation-task manifest.

A scene can have dozens of sources. A close-up may need a character and a prop;
a wide shot may need every visible character and a set. Visible and Heard are separate.
Requirements cover identity, wardrobe, setting, prop, angle, pose and style. One good
image can cover multiple requirements. Exact state names are deliberately not fuzzy
synonyms: approve aliases/annotations rather than trusting a guessed costume match.

All internal `[Shot N]` sections share one task's limits. Native sliding mode uses
its shared union. Director-managed tasks can change physical inputs at boundaries.
The current Ref2VA capability contract is 9 images, 2 videos, 2 audio references,
12 total files, with the existing voice-duration rules. Visual/audio input pairing
is validated as well. The continuation anchor changes Picture numbering, not identity.

The pure bounded beam/set-cover selector checks required coverage, pins, exclusions,
source availability, states, counts, reference labels and audio constraints. It prefers
fewer useful images, quality and previous-source stability. It does NOT select the
first nine files. Cached results are keyed by current source/scene/window state and
hash metadata, not just window title. At most 128 cached results are retained.

**Why included** explains coverage. The matrix displays per-shot visibility and
voice presence. **Use a state throughout a scene** sets scoped state/pins; it does
not rewrite contradictory stage directions or old pixels. Clinic/refinement must
resolve contradictory prose before rendering.

Scene-bank removal affects future automatic replans. It does not delete library bytes
or override a manual pin/prose reference. Generating a new variant does not replace
the canonical identity or append it to all global subject defaults.

## Clinic doctor

Scan → group causes → propose typed operations → simulate on a copy → review → apply → rescan.

The **Clinic doctor** tab groups repeated issues and links to exact fields, input
pools and existing Clinic controls. **Preview mechanical fixes** handles provably
adjacent duplicated Shot markers, duplicate physical source registrations, and a
missing speech verb next to an already correct Subject/Speaker label.

**Ask the doctor** uses your chosen planner with up to eight selected windows and
bounded live fields/context. Omitted windows/fields are disclosed; change scope for
later groups. It can call the deterministic manifest tool, propose exact-before
field repairs, source-binding replacement, reviewed casting or a creative split.
It cannot return arbitrary code or write the project wholesale. Questions and
proposals are retained; nothing is applied merely because a model called it safe.

Every apply is one undoable transaction. Exact-before/project-state checks reject
stale responses. Dialogue blocks/order, voice ownership, original media metadata,
and historical takes/prompts are invariant unless the explicit repair operation
allows a reviewed creative change. Splits keep complete tagged lines and recognizable
simultaneous/unison groups together, preserve the visible cast over the exchange,
and show added windows/time. Recognition is intentionally conservative and is not a
complete natural-language understanding of timing; review split proposals.

No unconditional “fix all” button erases voices or rewrites a joke to get a green
badge. More than two required simultaneous voice identities is a capability conflict,
not an image shortage. It needs a reviewed delivery/audio plan. New image work never
silently unbinds voices, crops recordings, adds duration or changes dialogue.

The phone/ear heuristic now uses a word boundary, so “searching” or “near” alone do
not become “phone to ear.” The doctor still distinguishes suspected validator defects
from genuine project problems.

## Opt-in autonomous reference loop

Open **Reference agent** in the workbench. Opening it submits nothing.

Save explicit settings:
- Enable reference preparation; choose **Review each candidate** or **Autonomous**.
- Select before-draft, after-draft and/or before-managed-render stages.
- Allow local image generation and, separately, eligible prior-frame sampling.
- Leave **Allow original identity creation** off for an established cast. Even when
  enabled it cannot bypass an approved existing identity anchor.
- Choose an image-capable planner, enable sending images, select the installed Qwen
  preset, and acknowledge its license. Existing Image studio/Viggle settings are reused.
- Set finite image-attempt, AI-call, per-window-attempt, elapsed-preparation and
  inspection-image limits. Defaults: 4 images, 24 AI calls, 2 attempts per window,
  60 minutes, 8 images per inspection, minimum review score 0.8.

A typical Seinfeld instruction:

> Prefer approved identity and current-scene references. Reuse an existing compatible
> variant before making another. When needed, create a clear seated/phone or reverse-angle
> reference. Preserve every character and all dialogue. Compare actual candidate pixels
> with the approved identity, not just the prompt. Ask rather than change wardrobe or story.

Those default budgets are deliberately small for the first test, not sufficient to
visually audit a 249-window episode. A ready window can consume one planning call;
an image decision + review + ready check typically needs at least three. Budgets span
all stages of one drafting request and all reference work of one managed sequence.
Image counts reserve attempts, including requests whose delivery needs reconciliation.
The elapsed budget is checked at operation boundaries; accepted AI/GPU work can finish
before it parks. It is not a process-kill deadline or a hardware-runtime prediction.

The server loop:

1. Run independently verified mechanical repairs when allowed; compute coverage.
2. Inspect bounded actual thumbnails. The planner can request another inspection batch.
3. Reuse an approved compatible identity/state source from another scene bank when
   available; inspect it before using it. No Qwen job is required for reuse.
4. Otherwise request a specific missing reference with exact IDs, role, state,
   source images and a Qwen prompt. Unknown IDs and uninspected/unapproved inputs fail.
5. Submit a single job on the existing serialized WanGP queue. No second model server.
6. Archive the actual output, verify image dimensions/MIME, and send candidate pixels
   plus source evidence to the vision planner. An anchored review needs at least two
   image slots. Approved identity evidence is prioritized over a generated frame.
7. Accept only a valid image-specific review that passes every configured threshold;
   otherwise retry within budget or park. Rejected candidates remain inspectable but
   never join the usable bank. Review mode pauses before generation AND before acceptance.
8. Add accepted coverage as a scoped variant, preserve originals, recompute the manifest,
   compile and continue the same window/workflow.

Scores are subjective model judgments, NOT measured confidence or a guarantee of
identity/visual quality. The model can miss an error. Human review is still available.
Prompt-injection instructions in images/transcripts/filenames are data, never tools.
Source requests cannot introduce people, rewrite scenes or execute commands.

## Prior rendered frames

With permission, a managed sequence can sample verified archived footage immediately
before the next window (last retained frame, roughly half and one second earlier).
The agent can use those pixels as Qwen edit inputs with an approved identity reference.
Frames keep source output ID, frame index, hash and context-only provenance. They do
not silently become canonical character portraits or ordinary inputs in every task.

Before drafting, the selected prior **managed** take and its trimmed range can provide
this evidence too. The archive must belong to the recorded sequence and the range must
be valid. This release does not scrape arbitrary local paths, download random gallery
files or support every legacy/native-job source as a prior-frame source.

An unrelated hard-cut location does not inherit the previous setting's pixels.
Within a confirmed scene, a hard-cut shot may still inspect its scene's prior footage.
Continuation is still subject to the actual H3 overlap settings; changing the reference
pool does not remove audio or visual mistakes already in the overlap.

## Draft and render integration

**Drafting:** optional preparation runs before drafting and after each returned batch.
Draft-reported missing coverage becomes a real requirement. Prepared files/choices are
staged with the draft, not silently merged into the live editor before Apply. Source
state is checked again on application. If preparation parks, its server run and any
completed proposal text are retained. Resolve in Reference agent; stale results can
open in a separate project copy instead of overwriting newer edits.

AI requests and reference-agent runs continue server-side when the browser is hidden.
The existing multi-batch Draft button still coordinates the transition between batches
in the browser. Closing/reloading the editor does not automatically finish all remaining
batches; use the retained drafts/runs and explicit unfinished retry/recovery controls.
No paid request is replayed merely because its browser vanished.

**Managed generation:** the coordinator calls reference preparation after saving the
previous video and before uploading/submitting the next task. It releases no conflicting
queue reservation. Qwen runs on the same serialized renderer and the video then resumes
from its archived prefix. This is a boundary interruption, not a change halfway through
H3 denoising. Its generated references affect the captured future sequence snapshot,
not already-submitted task payloads, original images or earlier recorded takes.

The central Render overview displays reference planning/generation/review instead of
an obsolete video ETA. Reference agent shows images, decisions, request IDs and counters.
Import prepared sources back into the editable library explicitly; the user may have
edited the live timeline since submitting the captured film.

A native sliding task cannot swap its reference pool halfway through. Use managed mode
for generation-time autonomy. Review/pin conflicts, voice limits, unknown submissions,
unavailable bytes, timeouts or exhausted budgets park rather than pretending to succeed.

## Persistence, stop/resume and privacy

Agent state and decisions are in `$H3_DATA_DIR/reference-agent/*.json`; ordinary provider
request/partial-output logs remain under AI requests. Candidate blobs are in the existing
shared media store. Source hashes/provenance and exact submitted payloads are retained.
No provider keys, adapter secrets or pairing passwords are written into agent JSON.
Source samples and generated pixels ARE transmitted to the configured planning provider.

Cancel stops auxiliary work cooperatively and never submits the next video window.
Pause waits at a safe boundary and retains accepted work. The parent sequence waits when
human review is needed. Resume the reference run to resolve its question/candidate, then
explicitly resume/reconcile the parked sequence. A Node restart parks loops. Accepted
worker jobs may keep running; resume reconciles their request IDs instead of resubmitting.
Credentials may need reconnecting if supplied only in memory rather than the existing
server environment. The ordinary static WanGP token is unaffected.

Do not run two Node coordinators against one data directory. Do not delete the old
release folder while a detached worker is running code from it.

## Verification

Run `node scripts/check-all.mjs` for the local unit/integration checks and add
`--integration` for Gradio contract and offline Chromium workflow suites.
The new tests exercise deterministic constraints, exact repairs, stale transactions,
real local HTTP and durable AI records, actual FFmpeg/FFprobe image/video processing,
archival, retries, unknown acceptance, cancellation, replay protection, queue reservations,
phone/keyboard layouts and staged draft application. Native rendering and provider
judgments use fixtures. No live H3/Qwen or authenticated model-account evaluation is
claimed, and the user's GPU/tailnet environment has not been accessed.
