# 2.2.1: keep going or save what is ready

The normal per-window image allowance now accepts **1–20**. On a stopped run, use
**Allow 20 here & continue** or change **Image attempts per window** in Run settings.
Existing extras and all spent counts remain. Overall image, AI and time budgets are
separate; a grant never bypasses them or accepts a rejected image.

**Keep what is ready** saves approved progress before the pass finishes and remains
available after cancellation. Prefer a separate project copy plus portable download;
use the progress ZIP to salvage accepted image files when the live edit changed.
Read **REFERENCE-PROGRESS.md** before the historical recovery notes below.
This update restarts Node only, not the worker.

---

## 1.9.2: one image prompt stays one task

**This release updates both Node/editor and the idle Python worker to 1.9.2.**
Qwen image requests now explicitly use FG (all paragraphs are one prompt), including
standard and Viggle settings. H3 video-window modes are unchanged.

When GPU work is idle, stop the old Node process. From this NEW release folder run
`node start-headless.mjs --stop`, then `node start-headless.mjs`, keeping H3_DATA_DIR.
No dependencies, plugin installation, token rotation, or data reset are needed.

For the already-failed reference run, use **Fill references → Retry image as one prompt**.
It retries the saved request, not the whole preparation pass, with a new native request ID.
The old error, completed windows, accepted pictures and spent allowances are preserved.
Candidate review still runs. See **IMAGE-PROMPT-FIX.md** for safe service upgrades and
budget/queue-pause details. Earlier release sections below are historical.

---

## 1.9.1 planning-response recovery

A paused “Generated coverage must preserve…” run can continue from its saved response.
State/angle labels are bound to the existing requirement, not copied back by the model.
**Repair this step & continue** is available for genuinely invalid responses: one new
planning call, not a new run. Results, images, finished windows and usage stay intact.
Read **REFERENCE-RECOVERY.md** for the workflow, safeguards and diagnostic limitations.

# Fill missing coverage — Orch3stra 1.9.0

## Role-aware coverage (1.9.0)

A mandatory file is not required to satisfy every role. A portrait named in retention
can establish a face; a separate dinner variant can supply the seated pose/outfit; the
room image supplies the set. Coverage is their union, not a requirement that every file
show a complete target frame. The source list remains within the same model limits.
The compiler emits explicit identity-only usage guidance for retained portraits whose
pose/outfit are not selected scene coverage. That guidance uses local compiled picture
numbers and is invalidated when relevant source/casting/requirement metadata changes.

A pose/activity state can still need a new image. The agent reviews existing pixels and,
when they genuinely cannot cover it, proceeds to image planning, Qwen, actual candidate
review, scoped annotation and assignment. It is not supposed to demand evidence of a
phone app, an off-camera conversation partner, a thought or a future action in a still.
The labels evaluator is instructed to assess visible reference properties, not the whole
story beat. This improves prompting, not the reliability of every model judgment.

For an already parked 1.8.0 run, use **Continue with these settings**. Its original
permissions and spent budgets persist; no reset or restart-from-window-one is needed.
The existing index, accepted evidence and generated candidates are retained. A genuine
excluded/missing/unapproved file remains blocked. A requirement explicitly constrained
with `assetIds` is different from an ordinary file pin: it cannot be silently satisfied
with a newly generated replacement. Inspect/confirm the existing source or unlock that
specific requirement deliberately.

The accepted candidate receives both its described role and a scoped evidence entry for
the requested requirement. It does not relabel unrelated scenes, edit dialogue, delete
references, or turn generated frames into new canonical people.


## One workflow

Click **Fill references** in the main toolbar (or **Fill missing coverage…** in Scene
references, Clinic doctor or Image studio). Choose the selected window, its scene, or
whole film. Use a small scene first. Without accepted scene grouping the scene scope
falls back to the selected window; it does not invent scene membership from titles.

The primary Start/Continue action stays visible above the findings, including on phones;
you do not need to scroll past a long conflict list to start the repair pass.

The visible order is **check existing → generate only gaps → visually review → label
and assign**. The default quick flow is automatic, with existing-image inspection,
Qwen image generation, and automatic application enabled. Opening the panel does no
inference. Start requires explicit confirmation of the scope, source/model authorization,
vision-enabled planner, and finite image/AI budgets. These quick settings are saved as
`project.coveragePreferences`; they do not silently enable future render/draft checkpoints.
The advanced Reference agent still configures those per-project checkpoints.

Existing Image studio canvas and acceleration settings (including Viggle) are reused.
Changing the selected Qwen model resets the old acceleration profile. No second model
server is launched. H3 and Qwen use the existing serialized worker queue.

## Existing images come first

A numerical gap may be a metadata gap, not a missing picture. The optional existing-image
pass sends actual bounded thumbnails and exact requirements to the selected vision
planner. It can confirm state, pose, role or angle coverage for **already registered**
subjects and eligible approved images. It does not identify new people, assign anonymous
portraits to a named subject, or silently approve/reinclude files the user excluded.

An accepted check is stored as `window.referencePolicy.coverageEvidence`. It records
asset ID, exact requirement, reason, reviewer result, source hash and a requirement/cast
fingerprint. It is scoped to the checked window. A variant labelled "everyday outfit"
can satisfy a specific "navy blue shirt" requirement after a positive visual review,
without renaming the whole film's wardrobe. Case and whitespace differences alone are
normalized; other label differences are not guessed to be synonyms.

Evidence invalidates when the source hash, annotation, requirement, or relevant
appearance changes. Applying a manifest does not itself invalidate the evidence just
because `sourceAssetIds` changed. The compiler selects from verified evidence as well as
ordinary approved metadata and still enforces all reference and voice limits.

If existing pixels do not provide the required coverage, the existing Qwen generation
and actual-candidate review path runs. Failed/uncertain visual checks are not approvals;
rejected images remain inspectable and do not become render inputs. Model scores are
subjective assessments, not calibrated confidence or proof of visual identity.

## The pinned-image error

The former generic message collapsed missing media, exclusion, approval, and state
mismatch into one error. The new diagnostics name each offending file, library token,
window, required state, existing labels, and why it is mandatory. Prose references
include an exact Clinic field link. This works for old saved blocked runs too; opening
an old run computes current diagnostics without making a model or GPU request.

For a blocked run:

* **Allow this image here** changes only that prepared window's exclusion, with
  confirmation. A scene-wide exclusion stays intact; the window records its exception.
* **I checked: this image matches** records a user-confirmed match for the exact current
  requirements. The button waits until the actual image pixels load. It is not an image edit.
* **Approve this image for reference use** explicitly changes approval in the prepared
  library. The button requires loaded pixels and confirmation; the AI cannot grant it.
* **Inspect this window**, exact field links, and **Review image labels** are available
  for genuinely wrong references or creative changes.

The first three operations repair the saved *prepared snapshot*, not the active source
project. Resume/continue is explicit. If you edit the live film through a field/library
link, the old run is still a snapshot. **Use my edited project instead…** cancels that
parked reference attempt, preserves its records/candidates, and returns to setup with
the current edit. It does not start a new paid job until you press Fill missing coverage.
Unresolved accepted work must stop/reconcile first.

A true wrong costume, deleted original, forbidden image, impossible task budget, or
unreviewed cast can still require a decision. The agent never clears pins just to turn
the status green. An explicitly named image is a hard reference even when no Pin button
was pressed. Editing its tag or using Clinic's source replacement may be the correct fix.

The earlier Seinfeld portable attachment does not contain the later blocked run and its
scene-state metadata. The error text alone cannot identify its particular offending file.
The new panel reports that on the user's actual saved run; this release does not modify
or claim to have inspected that running installation.

## Old analysis-only runs can continue

**Save permissions & continue** upgrades a paused standalone run after explicit consent.
It retains its planned image request, accepted candidates, request IDs and spent budgets.
No need to cancel and re-plan merely to allow Qwen. Budgets are totals, not fresh allowances.
Authorization is refused during active/unresolved GPU work, for managed-owned runs, and
for grouped draft budgets. Those remain governed by their parent workflow's authorization.

An old generation-disabled run no longer offers a useless generation-approval button.
You must grant generation permission before it can submit anything. Existing candidate
approval remains separate. You can also change from automatic to review mode.

## Automatic application, undo and recovery

When selected, a completed **standalone** run applies to an unchanged Shared Studio
project on the server using its expected revision. Browser closure does not prevent that
commit. A local-only project applies on its next open/refresh in this browser: a server
cannot write to a closed browser's IndexedDB. New image bytes are downloaded before the
single undoable project edit, and the source stamp is checked again after the download.

Changes to story, timing, cast, original files or recorded takes are rejected. Existing
images gain only verified source hashes; coverage annotations live in the scoped bank/
window metadata. Result application preserves current historical takes/proposals/Post
edits and records the reference preparation in history. Shared revision conflicts and
local edits leave the prepared result available instead of overwriting newer work.

A small IndexedDB acknowledgement plus a server receipt prevents a result automatically
reapplying after Undo/refresh. This is not stored in localStorage. Manual **Apply reference
results** remains available. When the original source changed, its existing handler offers
a separate prepared project copy instead of a destructive merge.

Progress and the most recent decisions appear at the top of the one flow; polling runs
about every two seconds while active/open. Clarification text survives progress refreshes.
Each run has a downloadable diagnostic. It contains private prompts/descriptions but no
provider/adapter keys. Data-directory privacy and studio pairing requirements are unchanged.

The pending start ID makes repeated delivery of the same start request idempotent.
Provider/GPU retries are not automatic. Node restart parks active operations for explicit
reconciliation; past paid requests and uncertain accepted work are not blindly replayed.

## Upgrade

Includes 1.7.0 and its Post room. Update the **Node server and editor only**. Do not change
worker/plugin files or run `--stop`. Let active AI work finish, park automatic sequence
dispatch, back up the project, stop the old Node process, and run `node start-headless.mjs`
from the new folder. Preserve `H3_DATA_DIR`, exact origin/browser profile and environment
settings. Keep the old folder while a detached worker still uses it. In systemd, update
and restart `h3-director.service` only, not `h3-wangp.service`.

## Tests and limitations

`node scripts/check-coverage.mjs` exercises actual local HTTP, disk persistence, immutable
media, scoped label evidence, pin conflicts, consent, idempotency, and Shared Studio CAS.
`python3 tests/browser_coverage_check.py` exercises real Chromium controls, image decoding,
paused-run repair/authorization, automatic application/undo, and phone layouts.

The vision reviews, planner replies, renderer outputs and browser storage/transports in
these fixtures are simulated. The tests are not a live DeepSeek/Qwen/H3 run or a physical
phone test. The feature cannot guarantee a model will judge reference suitability correctly.
