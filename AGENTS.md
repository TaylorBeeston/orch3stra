# Release candidate packaging contract

- This source-only 2.3.0 candidate is not a final release or production installation.
- Native music is a separately typed, owned single-song job on the existing serialized
  Session queue. Preserve request IDs across uncertain replies. Never silently retry,
  mix source covers or download instrumental adapters through the song flow.
- Package tracked source and explicitly reviewed synthetic fixtures only. Exclude
  user media, project storage, outputs, voices, credentials, dependencies and Git data.
- Preserve generated decoded PCM byte-for-byte. Only trusted saved-footage provenance
  permits preceding audio resampling; original decoded rate mismatches remain errors.
- The WanGP exact-duration mux patch is a separate reviewed source change. Never apply
  it automatically or restart workers during packaging or fixture verification.
- Read current VALIDATION-2.3.0.md; historical live runs do not validate every candidate change.

# Release 2.3.0 contracts

- Orch3stra is the display name. Preserve all legacy persistence, protocol, auth and
  service identifiers. Never automatically upgrade a worker or WanGP dependencies.
- Read VALIDATION-2.3.0.md and MIGRATION-2.3.0.md. Two live windows passed on the
  installed WanGP 17.17 API; do not claim long-film memory stability or ASR quality.
- H3 Ref2VA/FL2VA window-size minimum is 124, separately from the 107-frame generated
  span minimum. Reject an invalid ceiling before submission; do not rewrite saved
  timings or globally apply this model-specific limit to other model families.
- Historical release/development notes below are evidence, not current install commands.

# Bounded development worker contracts

- Worker 2.3.0 uses the bounded contracts below. Installed API inspection is recorded in docs/WANGP-DECODED-API.md. Never restart or replace the user's worker without explicit idle-upgrade approval.
- New managed sequences use layout=bounded-v1. Local video includes overlap plus new footage; timeline ranges are distinct. Existing captured sequences retain their cumulative path.
- Preserve decoded audio's source-frame origin. Rolling checkpoint media may contain up to 120 frames while inference receives only the requested overlap. Never infer that API audio contains retained source audio.
- Fixed shot appearance images are immutable owned context outputs, not library/canonical replacements. They consume the actual image budget and must not displace pins. All new recovery, restart and archive changes remain release-gated.

# Usability safeguards

- Never silently turn unavailable continuation context into a fresh start or scattered linked windows into independent shots. Reset context choice when selection/strategy changes; count already-rendered windows before GPU submission.
- Movie export and project backup are distinct. Portable backups do not embed worker-owned rendered videos. Opening controls must not submit work.
- Browser tests on baseline 2.2.2 are not evidence for development-source UI changes.

# 2.3.0 development contracts

- This is an unshipped working branch. Do not claim release completion from the presence of isolated helpers or old validation reports.
- Confirm the installed WanGP API and decoded audio/video alignment before enabling bounded generation. Current upstream source is research, not proof about the user’s installation.
- Preserve the legacy runtime/storage identifiers during the Orch3stra display-name change; do not rename existing databases, token files, services or archives automatically.
- A failed current pixel inspection overrides matching labels only for its exact requirement/source stamp. Historical captures, accepted candidates, completed windows and budgets remain immutable.
- Speech reviews attach to output IDs and source ranges. Closing a dialog does not authorize a new request. Preparing a CPU excerpt, ASR model consent and marking suspect remain separate actions. The explicitly authorized opt-in speech-quality feature may create capped alternate takes under SPEECH-QUALITY.md; it never silently replaces footage or retries uncertain submissions.
- Cloud fixture tests use a test-only loopback-interface shim outside this package. It must never ship or be mistaken for network/security QA.

# Release 2.2.2 contracts (override older Node-only install guidance)

Read WANGP-COMPATIBILITY.md. This release changes headless/engine.py and requires an
explicit idle worker restart. Preserve the current persistent data directory, static
token, database, media and original records. Never modify the user's WanGP source or
upgrade dependencies merely to work around this validation failure.

- H3 resolution must NOT inject `mask` or `audio_file`, including with null values.
  `audio_scale` is numeric strength, not an alias. Voices stay in audio_guide/2.
- normalize_generation_settings is a pure, exact-key compatibility boundary. Drop only
  None or the empty string for those TWO obsolete keys. Reject nonempty values, including
  false/zero/containers; do not lose actual media or guess a mapping.
- Keep real image_mask/video_mask, guide ordering, source ownership checks, seed/sampler,
  PW/FG modes, continuation metadata and custom_settings behavior intact.
- Restored queued objects are already resolved: normalize their dispatch COPY as well.
  Never mutate stored payload/digest/resolved history or idempotency request/client IDs.
  Restart must not replay failed/completed/cancelled jobs. New render is user-directed.
- Do not filter arbitrary fields using get_model_schema: current upstream schema output
  is metadata, not a complete authoritative whitelist for arbitrary model settings.
  Do not bypass WanGP's strict validation or move unknown keys into custom_settings.
- Expose h3_settings_compatibility:1 in worker health. Reusing an old worker is allowed
  for editing, but the launcher must warn the user that the video fix is not loaded.
- Progress terminal labels distinguish success, failure and cancellation; stale
  phase='finished' cannot falsely label a failed whole film as successfully finished.
- Regression: tests/test_settings_compat.py (11 cases), stricter test_headless.py and
  tests/fixtures/headless_api.py, check-progress.mjs, browser_progress_check.py.
  Full local suite: node scripts/check-all.mjs --integration. Report fixtures honestly;
  no GPU or exact installed upstream checkpoint is exercised by these doubles.

---

# Release 2.2.1 contracts (override historical install instructions)

Read REFERENCE-PROGRESS.md. This is Node/editor-only; preserve 2.2.0 worker/launcher/
plugin/dependency bytes. Do not require a worker restart for the allowance fix.

- maxAttempts is configurable 1–20; preserve old/default permissions until explicit
  authorization. Use A.attemptLimit everywhere including automatic/manual retries.
  One-off extra credits are counted, never reset, and overall/group budgets still apply.
- extend-window checks exact budgetStamp, parked state, unresolved GPU work and parent
  lifecycle. It cannot implicitly approve/reject a waiting candidate. Persist the grant
  before launch and roll back in-memory control state on save failure.
- save-progress is a checkpoint, NOT completion or cancellation. Allow on cancelled
  records too, verify owned approved media, and do not delete/approve rejected candidates.
- progressCopy uses source revision checks and a new project ID. Preserve original
  history/takes/Post, copy completed-window bindings only, distinguish partial history
  from final referencePreparationHistory, and never replace newer edits.
- A progress-pack download must never write to the browser media store. A project-copy
  save checks all local media-ID collisions first and must not overwrite edited bytes.
- A download of the progress pack has actual new approved images but not original
  library media/movies. Portable project copies require original local blobs. Be honest
  about the difference. Never use a diagnostic JSON as evidence that bytes are present.
- Tests: check-reference-progress.mjs, browser_reference_progress_check.py, and full
  check-all.mjs --integration. All provider/renderer judgements remain fixtures.

---

# Release 2.2.0: additional invariants

- Sound sources/samples belong to `soundLibraries` / `postMedia`, never H3 assets,
  voices, reference banks or agent planner inputs. Preserve sources and used cue media.
- `sound-server.mjs` owns one CPU queue, persisted revisioned jobs and private blobs.
  Cancellation kills only its process group. Never call the GPU queue from this module.
- Keep URL imports YouTube-only, explicit and bounded. Do not add automatic cookie
  harvesting, credential use, generic URL fetching or access-control bypass.
- Analysis detects chapters/quiet gaps, NOT semantic sound names or isolated stems.
  Do not advertise it as ML/audio separation. NumPy/Torch/ASR are not required.
- Sample extraction must preserve channels and source sample offsets. Normalize once
  to the owned PCM source, then cut exact frames; retain all original metadata/decisions.
- Scene dialogue changes edit future scripts. They must not rewrite captured historical
  takes or Post. Explicit window deletion and timing reflow need preview/undo.
- Auto-select newest usable take only when no explicit take/trim is pinned. All preview,
  export, thumbnail and take-inspector consumers must agree on H3Edit.segment.
- Image family limits apply at UI, planner guidance and worker boundaries. Never discard
  reference images to fit a text-only preset or use Qwen acceleration settings for Krea.
- Frame display names are not media filenames; normalize missing extensions by known
  MIME at upload without changing payload bytes or removing validation.
- New tests: scripts/check-sounds.mjs, scripts/check-scene-edit.mjs,
  tests/test_sound_worker.py, tests/test_image_families.py, tests/browser_sounds_check.py.
- Base for this release is the actual 2.0.1 ZIP. Missing 2.1 artifacts were reconstructed,
  not assumed to exist. Never link a release before verifying its exact local path.

---

# Agent guide — Orch3stra 2.0.1

## Current release contracts: 2.0.1

Read INSPECTION-REPAIR.md and UX.md first. The Python worker, plugin, launcher and
requirements are unchanged from 1.9.3. Do not restart/patch the GPU worker for this
Node/editor fix. Historical version-specific notes below are not upgrade commands.

Existing-image inspection is closed-set reply validation, not library deduplication.
`labelBatch` accepts only attached IDs or their exact packet-local keys. It retains
independent valid rows, conservatively coalesces agreeing duplicates, and returns
conflicting/missing rows explicitly. Never approve out-of-batch IDs, merge conflicting
judgements, lower the threshold or relabel unrelated assets to make it pass.

A durable inspectionBatch freezes the prompt/items/attachments/sourceStamp before a
paid call. Cached replies cannot be interpreted against a new selection. Valid rows
are applied once. retry-inspection checks exact stamp, permission, parent state,
unknown GPU work and shared budgets. A new call contains only unresolved items.
The optional repairInspectionReplies grants one corrective request per failed batch,
not a loop of retries or an exception to transport-failure recovery. Keep old raw
responses and spent allowances. A manually requested repair receives one request.

Reject/retry uses exact pending candidate ID and stamp, preserves original sources,
validates target and prompt labels, and has a distinct request ID/fresh seed. A user
rejection stays outside the bank and cannot be accepted by ordinary Resume. Extra
window attempts are explicit and do not change overall limits. Serialize competing
mutating actions on reference-agent-control:<id>; don't create nested same-key locks.

The workspace shell presents existing tools. Detach parent dialog DOM for Back, don't
copy user form values as HTML or lose listeners. Clear cross-project navigation stacks;
never invoke paid work on navigation. Candidate correction text must survive polling.
The shell's Window settings must preserve access to hidden inspector functionality.

Run check-inspection, check-candidate-review, browser_workspace_check and the full
check-all --integration. Component browser suites intentionally omit the shell; only
the dedicated workspace suite tests its navigation. Report that scope honestly.


## 1.9.2 single-image contract (overrides earlier worker-unchanged notes)

Read IMAGE-PROMPT-FIX.md. Worker 1.9.2 is required for new Qwen image tasks.
Force multi_prompts_gen_type=FG in the client builder AND Python image resolution/dispatch.
Keep original prompt bytes, standard/Viggle settings and separate task arrays intact.
Never globally overwrite H3 PW/sliding modes or remove coverage-target instructions.

retry-image is explicit and restricted to a known failed, output-free prompt-splitting
rejection. Recheck the real job, capability, revision, policy, parent cancellation and
budget before clearing its handle. Archive that attempt; reserve a distinct new request ID.
No blind native resubmission, automatic paid plan call, counter reset, or data deletion.
Completed candidate review remains mandatory. Old queued image dispatch copies get FG;
terminal records and original submitted payloads remain unchanged.

Extend existing image-worker, reference-recovery and portrait coverage UI tests. A mocked
WanGP rejection reproduces its contract but is not a live Qwen/H3 inference test.

## 1.9.1 contracts (override exact model-echo validation)

Read REFERENCE-RECOVERY.md. Node/editor only; worker/plugin bytes remain unchanged.

- Requirement IDs, subjects and fixed-source pins are authoritative. Model state/angle
  echoes are not keys. coverageTarget binds the real project target and a freshness stamp;
  bindingChanges is an audit, not a claim of semantic equivalence or approved pixels.
- generationPrompt() supplies that target and current appearance/location. Keep proposed
  and actual sent prompts in provenance. Validate target freshness before new submission;
  never recompose/repeat already-accepted GPU work during recovery.
- validatePlan() is shared by live validation and read-only diagnosis. retry-plan needs
  explicit confirmation, current recovery stamp, budget, a parked run and no uncertain
  GPU work. Allocate a distinct call revision, retaining previous calls, index and usage.
- Retain completed AI text and report lastPlan/planFailure/latest request in diagnostics.
  Never expose raw credentials or embedded source/candidate bytes.
- Existing-image inspection includes current window appearance/location, not only scene
  narrative states. Do not silently backtrack into completed manifests or render snapshots.
- Test wrong IDs, pins, unseen sources, rejected candidates, legacy 21-window preservation,
  same-run repairs, two-device races, budgets and truthful status. Fixtures are not live
  Qwen/H3/provider verification.

## 1.9.0 contracts (take precedence over older blanket state-pin rules)

Read COVERAGE.md and RENDER-SELECTION.md. Node/editor only; worker/plugin bytes unchanged.

- `scene-core.js`: eligibility is approved + present + not excluded. Role/pose/state fit
  is per requirement. A pinned identity portrait may be identity-only while another image
  covers scene state. Do not restore the blanket incompatible-state file filter. Explicit
  requirement.assetIds remains a hard source restriction, separate from file pinning.
- `core.js`: role-specific compiled source usage must have a current referenceUsageStamp.
  Never remap the library IDs themselves or emit stale identity-only guidance.
- `reference-agent-server.mjs`: keep accepted exact-requirement pixel evidence and prior
  user confirmations. Negative checks go to the planner; do not turn them into a generic
  permission failure. Accepted generated evidence must follow real candidate inspection
  or explicit human approval. It does not grant approval/exclusion exceptions.
- `render-selection-core.js` is pure. Original edit/timing/history/Post state never mutate
  when selecting or preparing a range. Noncontiguous linked selection is rejected, never
  silently filled. Arbitrary independent selections are explicit no-overlap tasks. Prefix
  context is created only from existing selected source ranges, not preceding prompts.
- `render-selection-ui.js`: preflight current queue, exact source stamp and window IDs;
  reconnect server sequence records without overwriting authored project fields or an
  explicit selected take. A declined/uncertain submission must never display success.
- Prefix cancellation stops only the newly created CPU finishing job. It never kills the
  GPU worker or another person's render. Once submitting, cancellation is through the
  native/sequence manager, not a misleading UI-only AbortController.
- `H3Activity`: a manual popover must be a descendant of the active native modal, otherwise
  it can be visible but inert. Track dialog opening order, nested modals and Escape close.
  Keep notifications accessible, do not steal keyboard focus, and deduplicate exact notices.
- New tests: check-render-selection.mjs and browser_render_selection_check.py. Extend the
  coverage tests with portrait + state-variant union, preserved manual evidence, a persisted
  needs-review run reaching one actual HTTP image task, and protected-input refusal. Model
  outputs are fixtures. Never describe these tests as live H3/Qwen/provider verification.

## 1.8.0 coverage-flow contracts

Read COVERAGE.md. Node/editor 1.8.0 only; Python worker 1.5.0 / legacy plugin 1.0.5 unchanged.

- `coverage-ui.js` is the single guided entry point. Keep persistent progress above setup;
  never make the user infer that "analysis complete" means results reached their project.
  Quick preferences do not silently change render/draft automation authorization.
- `scene-core.js`: distinguish label mismatch from observed contradiction. Normalize only
  case/whitespace, not synonyms. `coverageEvidence` is exact-requirement and source-hash
  scoped. It survives source selection but invalidates on relevant asset/cast/label edits.
- Mandatory/pinned conflicts carry `assetId`, name/token, reasons, required/current labels
  and exact origins. Use `fieldKey`, not `key`, for locators: credential redaction intentionally
  removes fields named `key`. Read-only old-run diagnostics make no model/GPU requests.
- `LABEL_SYSTEM` receives actual pixels and a closed set of known assets/requirements.
  Never invent identity ownership, unexclude inputs or approve rejected images from a model
  response. Explicit user approval/exception needs a current manifest stamp; keep all bytes.
- Existing-image inspection precedes generation. A negative/uncertain review is not approval.
  A genuine pinned conflict still parks; do not relax it to fill nine input slots.
- Same-run authorization is explicit, standalone only, and refused while GPU acceptance is
  unresolved. It never resets counters or group/parent budgets. No blind paid retries.
- Shared result apply is a source-stamp + CAS transaction; canonical normalization may be
  compared but semantic changes may not. Local apply rechecks after downloading blobs.
  Preserve dialogue, timings, cast ownership, historical jobs, original media and Post edits.
- Explicit apply acknowledgement prevents automatic reapply after Undo/reload. Do not assume
  the server can update a closed browser's IndexedDB. Keep local/shared states distinguishable.
- Start IDs are idempotent; changed source/policy with an old request ID must be rejected.
  Diagnostic downloads exclude keys/tokens. Existing backend auth/CSRF boundaries remain.
- Extend check-coverage.mjs and browser_coverage_check.py for any changes. Tests use fixture
  vision/GPU decisions and browser storage; never present that as live model validation.

## 1.7.0 Post contracts (override older editor limitations)

Read POST.md. Node/editor 1.7.0, worker 1.5.0 and legacy plugin 1.0.5 unchanged.

- `post-core.js` is a pure independent picture edit. `project.postEdit` snapshots actual
  chosen source ranges. No Post operation edits `project.windows`, render plans, reference
  manifests, dialogue or prior takes. Explicit reset/duplicate is required to rebuild it.
- `project.postMedia` is separate from `project.assets`. Add keys to portable backups and
  Shared Studio, never to model packets/reference pools. Store hashes and preserve bytes.
- Cue anchors are clip IDs plus retained offsets. Splits/reorders/cuts must be deterministic
  and undoable. Do not silently drop overhanging cues or stretch music after a speed change.
  Source Min/Max, 24-fps ranges, rate rounding, independent picture/audio fades are explicit.
- `post-server.mjs` only runs FFmpeg via `Finishing` with managed arguments, owned source
  IDs and signature/size/hash-verified media. No arbitrary URLs/paths/filters; never accept
  SVG/playlists. Restrict decode protocols/demuxers. Source movie metadata may use nb_frames
  to avoid repeated full-prefix decode; every encoded part and final frame count is verified.
- Float audio joins precede one final AAC encoding. Never normalize amix by input count,
  extend the film via a looping cue, lose picture frames with -shortest, or duplicate a
  cumulative source prefix. Speed changes affect original audio and picture together.
- Fades are not cross-dissolves. User ducking is not speech isolation. Web Audio preview
  approximates scheduling; final FFmpeg limiting/timing can differ. Document that boundary.
- Export snapshots are immutable, idempotent and authenticated. Unknown acceptance is
  reconciled by request ID. Restart parks the job, with explicit resume; no auto paid work.
  Base Post exports do not reserve/cancel the GPU, but the explicit master-upscale does.
- Post finished jobs have no automatic renderJob and cannot become H3 context. Preserve
  the explicit no-theme/no-logo contamination boundary. Shared studio access is unchanged.
- `H3Edit.finishId()` uses getRandomValues rather than randomUUID so export IDs stay valid
  at the user's ordinary HTTP your-hostname origin. Do not alter H3's existing identity schema.
- Test actual encoded pixels/audio/frames/cancellation with check-post.mjs and real browser
  controls with browser_post_check.py. Model responses and browser IndexedDB remain fixtures.

## 1.6.0 contracts (override historical release notes)

Read SCENES-AND-AGENT.md first. Node/editor 1.6.0; Python worker unchanged 1.5.0;
legacy plugin unchanged 1.0.5. Preserve the user's OMP storage/profile/auth changes.

- `scene-core.js` owns approved banks, stable scene IDs, requirement coverage, explicit
  manual pins/empty selections, capability constraints and exact task manifests. Bank
  membership never automatically loads an image. Internal shots share a task's budget.
  Keep manualDirect/manualSubjectSources and managedSourceValues distinct; repeated
  optimization must NOT turn manual choices into droppable automatic sources.
- `doctor-core.js` wraps Clinic tools with before-value/source-state checks and invariant
  simulation. A model cannot self-authorize arbitrary edits by labelling them mechanical.
  Split proposals require approval, preserve tagged lines and simultaneous groups, and
  disclose timing. Compile after edits. A de-duplicated validator message exposed at a
  later unchanged window is not automatically a newly introduced error.
- `reference-agent-core.js` validates finite permissions and closed model actions. No
  paths, commands, new subjects or uninspected source IDs. Known identity anchors cannot
  be bypassed with original-identity permission. Actual candidate pixels are required;
  a score/statement alone is insufficient. Threshold scores are not probabilities.
- `reference-agent-server.mjs` checkpoints AI and GPU request IDs BEFORE dispatch. Do not
  replay unknown acceptance. Use the existing serialized queue and global dispatch lock.
  There is never a second WanGP runtime. Cancel/pause/restart preserve uncertain leases;
  parent managed sequences stay parked during human review. Approved new assets modify
  the future captured sequence snapshot only; each old submitted manifest stays immutable.
- Prior-frame evidence is authorized, range-checked, archived, hashed and context-only.
  Pair it with the known canonical identity; unrelated locations must not be inherited.
  Qwen candidates and actual references go to the user's selected vision provider.
- Native sliding tasks cannot swap refs mid-run. Managed mode has a boundary hook after
  prior archival and before next submission. Never frame this as live mid-step mutation.
- Draft reference results stay staged until explicit Apply. Update image number counters
  when merging generated sources; new asset IDs must not collide with future uploads.
- Keep physician/agent history and blobs out of localStorage. Shared Studio remains the
  synchronization authority; exact revision checks protect current edits and old takes.
- Limits apply over the whole consent group (before+after draft, or full managed sequence),
  not a fresh allowance per window. Preserve source/candidate provenance on rejection.
- `tests/browser_scenes_check.py` exercises actual controls; add scripts to the test runner
  and load new globals in old offline fixtures. No live provider/GPU is implied by tests.

## Historical 1.5.0 contracts (take precedence over historical notes)

Read FILM-DESK.md, ENVIRONMENT.md, CODEX.md and VALIDATION-1.5.0.md first.
Historical versions: bridge/worker 1.5.0; legacy plugin remains unchanged at 1.0.5. Never restart active
GPU work or auto-install dependencies. Keep H3_DATA_DIR and worker ownership/queue isolation.

- clinic-core.js has pure live field locators, exact stale guards, per-window exclusions,
  atomic source replacement and structural issue routing. No mutation of provenance, old
  AI responses or captured render snapshots. Missing source IDs are tolerated only by
  project loading so they can be repaired; AI-generated casting remains strict.
- Changing a [data-cast-source] checkbox must enable custom mode before readCast. An explicit
  [] differs from absent/inherit. Window excludedAssetIds removes all routes to that physical
  source (default, override, direct). Native sliding pools remain a union. Never exceed limits
  by renumbering or silently dropping files to make validation pass.
- `asset.generationExcluded === true` is a project-wide reversible generation exclusion.
  Retain files, stable labels, registrations, pins, crop provenance and historical
  snapshots. Model-input pools and image-studio/agent pixel assembly must exclude these
  assets. Explicit bindings, pins, fixed requirements and literal source tags that
  contradict exclusion must block with reactivation/removal guidance, not silently
  drop the selection or relax a pin. Crops inherit exclusion and must not implicitly
  replace/reactivate excluded originals. Portable backups still preserve all media.
- Project JSON, including cast, assets, jobs and snapshots, is stored in IndexedDB
  (`h3-director-media` stores `projects` and `meta`), not localStorage. Media bytes stay
  in `blobs`. `save`/`load`/`index`/`remove` stay synchronous against the memory cache;
  `save` returns a promise that resolves only after the IndexedDB commit. Await that
  promise before an irreversible GPU submit. Legacy `h3-director:project:*` rows migrate
  once and are removed only after the copy commits. A failed migration keeps the
  localStorage copy. If IndexedDB cannot be opened, project JSON stays in localStorage.
  Tiny UI, connection and token keys may remain in localStorage.
  Portable backup media data URLs decode directly into Blobs; do not `fetch(data:)` for
  large embedded media.
- Desktop main/library/inspector occupy explicit grid columns. Collapsing display:none on a
  sibling must not auto-place main in the zero-width column. Test portrait + keyboard viewport.
- film-core.js is a closed typed editor schema. Exact patches/counted replacements are validated
  against exposed live keys, dialogue protection and source stamp. Typed inserts allocate IDs
  locally; unknown subject IDs are rejected. New-film bootstrap creates cast+beats jointly as
  a new project; a scaffold with no detail/soundscape is not render-ready.
- Film conversation, pending proposals, developmentDraft, voice design descriptions and jobs
  persist/sync as project metadata. Context is bounded and omissions must be disclosed. No
  claim of autonomous generation: AI changes need review; GPU actions need explicit confirmation.
- Undo cannot erase accepted physical jobs. Preserve voiceJobs like referenceJobs and movie
  jobs. Exact original voice prompt is stored as provenance, not silently substituted as dialogue.
- headless/reference_voices.py admits only actual qwen3_tts_voicedesign architecture. Fresh
  settings, no inherited file/path/LoRA inputs. Audio uses the same serialized engine queue,
  audio-only real decode/archive with authenticated ownership, no fabricated frame timeline.
  Keep idempotency before/after lost replies. This is not an HTTP URL-fetch voice service.
- Qwen image tasks use fresh server-owned settings. Viggle Turbo is opt-in and only
  accepts the exact profiles exported by WanGP; resolve them to allowlisted LoRA URL,
  multiplier 1, `viggle_v02`, and the profile's 4/5/6 steps with guidance 1. Never accept
  client LoRA paths or forward `viggle_turbo_lora_filename`; absent profile means reject.
- Qwen license consent is explicit once per license revision and browser origin. After
  acknowledgement, persist only a local-origin revision marker across projects/jobs;
  never treat it as creative project data or copy it into backups/sync. A new revision
  starts unchecked.
- Codex login uses official device-code RPC, never token scraping. The picker refreshes the
  live paginated, includeHidden catalog on open. GPT-6 Sol/Luna catalog support needs CLI
  0.156.1+; warn on older binaries, but never hardcode an entitlement or model entry. Preserve
  reasoning effort/modalities. All account routes are paired/CSRF protected; kill RPC on close.
- H3_PYTHON is the shared interpreter. Nemotron's dependency overlay is subprocess-only;
  don't prepend it for WanGP. Explicit setup script protects installed core versions,
  stages/verifies native mapping and swaps overlay with backup. Never upgrade Transformers
  in the GPU environment blindly. Package inventory is not a backup of all venv bytes.
- Validate UI on full-index fixture in browser_film_check.py and targeted legacy harnesses.
  Fixtures are not model inference. New key tests: check-film, check-codex,
  test_reference_voices. No user projects/credentials/recordings belong in the app ZIP.

---
## Retained historical contracts

### Previous guide

## 1.4.0 reference-workshop and diarization contract (current)

- Read REFERENCES.md and DIARIZATION.md before editing. Runtime/bridge version 1.4.0;
  headless image capability requires 1.4.0. Older workers remain usable for prior features;
  never replace an active runtime. The legacy plugin source remains 1.0.5 unchanged.
- The library sidebar is hidden on narrow screens: the header Subjects & images entry
  must remain reachable. Modal flex body scroll, visualViewport resize, sticky Save and
  44px controls are regression-tested. A new subject is staged, not persisted on open.
  Upload while editing must preserve unsaved text and selected file IDs.
- Catalog is closed. An uploaded picture is not implicitly a subject. Zero-subject schema
  examples must be empty. Only exact UUID/tag/unique-name aliases may normalize; log them.
  Never fuzzy-match or fabricate a character to make a draft pass. Keep raw failed output.
- reference-core.js is pure; reference-ui.js uses app-owned mutate/undo and shared storage.
  H3References.manifest distinguishes scene/prop/style/direct images from subject sources.
  New character generation is anchor-first, then explicit variants using approved images.
- referencePlans/referenceJobs/imageSettings live with project JSON; accepted image bytes
  live in IndexedDB and normal backup/sync. Restore physical image jobs across undo, just
  like movie jobs: undo is not renderer cancellation. Cards carry subject UUID, ordered
  source IDs, state, suggested windows and optional local appearance/retention.
- Subsequent wardrobe references go in subject.referenceVariants, not globally in assetIds.
  Explicit apply-to-windows requires reviewed casting and sets only local source selection
  and supplied state descriptions; never rewrite dialogue, timing, old render snapshots
  or unrelated prose. Scene-reference additions are explicit too. Idempotent import by
  job/output prevents duplicate assets. First approved image may become the default anchor.
- Qwen <imageN> input positions are independent of H3 library/compiled Picture tokens.
  Reordering source cards remaps the prompt and file payload together; referenced removal
  must fail until prose is corrected. No accidental stale-label source swap.
- headless/reference_images.py verifies actual qwen_image_21_7B architecture from registry,
  not a guessed name. Fresh native image settings: image_mode=1, sampler=default, one phase,
  I reference flag when needed, max10 owned images; no inherited movie inputs/output paths.
  Finite steps/guidance/seed/canvas and real input decoding/fingerprint are validated.
- The Qwen Research License is visible and acknowledged before dispatch. Do not relabel it
  Apache or assume research permission authorizes commercial deployment. No weights bundled.
- Image jobs use the existing single SessionJob queue. Image submission checks managed and
  finishing reservations under studio.serialize('sequence-start'). No independent CUDA server.
  Persist stable request ID BEFORE /generate. Lost replies are uncertain; read-only lookup,
  not automatic retry. An explicit retry must reuse the original payload/ID and check the
  worker instance; an unsuccessful retry cannot prove the original was never accepted.
  Known pre-dispatch/4xx rejection is distinguished from unknown transport acceptance.
  Image plans are nonmutating CPU/network work, not GPU authorization.
- Image results must pass real decoding and immutable private archive checks; media_kind=image,
  no fabricated fps/frame-window mapping or H3 telemetry. Native metadata may contain window_no;
  do not let that make image output a movie. Auth/CSRF/private byte ranges remain enforced.
- New helper scripts/diarization_worker.py runs only through a server-chosen separate Python
  executable (.diarization-venv or H3_DIARIZE_PYTHON). CPU float32/two threads/no remote code.
  Never upgrade torch/transformers in the working WanGP or Whisper environment for this.
- Native Nemotron API: AutoProcessor + AutoModelForAudioFrameClassification; uppercase segment
  keys; max8 anonymous speakers; 16k mono; >20s uses processor chunk geometry with one persistent
  speaker_cache and final-tail flag. Do not concatenate independently restarted diarizations.
- Existing faster-whisper ASR remains. Failed grouping keeps the transcript with a named warning
  and redacted credentials. Regroup-only never reruns ASR, rewrites cut text/times/Keep, or silently
  retains stale custom speaker names; require confirmation, retain old labels and support Undo.
- Model load/download is explicit. Tokens in stdin, not command arguments. Group child shares
  voice worker process group so Cancel reaches both; dependency check must not load weights.
- Fresh APIs: headless GET /image-models, /image-model?model_type=…; existing /generate with
  narrowly validated mode=reference_image. voice actions diarize and nemotron-capabilities.
  Add static script allowlist/order entries together; no new anonymous network route.
- New tests: check-references.mjs, test_reference_images.py, browser_references_check.py.
  Keep all older suites. Real PNG/HTTP tests are not Qwen inference; synthetic turns are not
  a tested Nemotron inference. Document unverified dependency installs and GPU requirements.


Read EDITOR.md, VALIDATION-1.3.0.md, README.md, PROGRESS.md, SEQUENCES.md, AI-REQUESTS.md, HEADLESS.md and VALIDATION-1.2.4.md first. This is an independent local editor,
not an official WanGP fork. Keep the no-build frontend / Node 22+ / no npm runtime
dependencies architecture unless the user explicitly chooses a change.



## Editing/finishing invariants (1.3.0; read before legacy release notes)

- The edited film clock is NOT H3.schedule(). `edit-core.js` owns actual selected-take
  ranges, ripple layout, playhead mapping, split aliases and EDL construction. Generation
  geometry stays in core.js. Missing media is a visible placeholder and blocks export;
  a missing explicitly selected take must never fall back silently to another take.
- `editCuts[windowId]` pins jobId/outputId/sourceWindowId and exclusive inFrame/outFrame.
  Never transfer a trim onto replacement output bytes. A split alias resolves the parent
  render window without duplicating source intervals; it survives normalize/export/import.
  Preserve captured plans, media numbering, dialogue and all historical takes on editing.
- `editor-ui.js` uses the existing app mutate/undo owner. AI insertion is insert-only,
  scoped to new IDs and existing assets at an explicit anchor. Freeze source revision;
  stale proposals must not overwrite a later edit. Preview/apply does not start the GPU.
- `studio-ui.js` maps edit time to exact source ranges. A progress poll must not reload
  the same preview. Guard out-of-order asynchronous source loads and seeks. Browser
  playback/scrubbing never dispatches generation or rewrites a project.
- Rendered right-edge drag is an Out trim; unrendered drag remains plan resizing. Keep
  overlap handles semantically separate. Split footage does not create generated frames.
  Resetting a split to its full parent can duplicate footage; require explicit warning.
- Partial managed branches use verified, owned prefix video via project.continuation.
  An edited prefix is explicitly assembled at the model's generation canvas and imported.
  The coordinator still verifies each actual cumulative endpoint and +/-4 output policy.
  Preserve following old takes; never claim a local replacement fixed downstream continuity.
- `finish-server.mjs` validates an EDL of owned native/managed/finish output IDs, NOT
  arbitrary client filesystem paths/URLs. Decode-count/fps verify sources and results.
  All APIs require studio pairing, and POST requires CSRF. Downloads support byte ranges.
- Finishing uses shell:false FFmpeg; frame-domain trim, video PTS rebasing, source A/V
  alignment, consistent 48k stereo assembly, exact frame count and H.264/AAC MP4. Use
  intermediate MOV with timescale 24000 and PCM; Matroska millisecond rounding lost frames
  in a real regression. Do not relax exact finishing-count validation to hide that bug.
- Upscaling uses only `mode=edit_postprocessing`, never H3 prompt/model settings. The
  worker whitelist is independent of H3 preset validation; source is an owned upload,
  immutable fingerprint, <=3,000 frames at 24 fps. Virtual source end_frame is inclusive
  upstream; internal/UI outFrame is EXCLUSIVE. Test the conversion explicitly.
- Chunk handles are finishing context, not H3 overlap. Cut them away after processing;
  original edited-base audio packets are remuxed unchanged into the final upscale. No
  recurrent-cache guarantee across native tasks and no universal VRAM fit promise.
- Persist native request IDs BEFORE dispatch. Lost reply => uncertain, read-only lookup;
  no blind retry. Node restarts park work, explicit Resume reuses accepted job IDs.
  Cancel remains sticky and reconciles worker state before releasing its reservation.
- Finishing/managed admission shares store.serialize('sequence-start'). Include finishing
  reservations in manager status and native submission guards. Never equate an unreachable
  worker with idle. CPU export and original footage do not require a worker restart.
- Bundled worker is 1.3.0; launcher can reuse 1.2.0 without replacing it during a render.
  Late upscaling checks capabilities and requires a deliberate idle upgrade. Legacy plugin
  stays byte-for-byte 1.0.5. `--stop` waits for process exit; no SIGKILL to enable an upgrade.
- New source: edit-core.js, editor-ui.js, editor.css, finish-server.mjs. HTML/static
  allowlist/module order must match. Tests: check-edit, check-finishing, partial-branch
  check-sequences cases, test_postprocess.py, browser_editor_check.py. Keep all prior
  progress/recovery/AI/persistence tests. Document real vs mocked inference precisely.

## Progress and measured-boundary contract (1.2.4)

- `render-progress.mjs` coalesces authenticated, read-only whole-studio snapshots.
  `progress-ui.js` owns polling; share snapshots with legacy displays. Never generate,
  resume, reconcile, cancel or write creative edits because a monitor refreshed.
- Native worker counters are authoritative. Normalize object/string backend descriptors;
  headless routing is server-owned, not compared to an obsolete browser adapter URL.
- Preserve last observations on disconnect, mark stale, suppress ETA. Unreachable is NOT
  idle. Returning from hidden/mobile state refreshes promptly; browser focus is never
  needed for GPU work. Avoid overlapping polls and stale history replacing active work.
- `progress-core.js` is pure and shared by Node/browser. Managed samples persist on each
  completed window. Never treat a one-window task's remaining time as whole-film ETA.
  Do not invent historical samples or denoising steps. Coarse estimates must be labeled,
  bounded, learning/overdue aware and suppressed for paused/stopping work.
- Only COMPLETED native outputs permit +/-4 decoded frames at the existing 24-fps check.
  This is an explicit Director policy, not an upstream guarantee. Wrong FPS, decode errors,
  noninteger count, no new footage and larger differences remain unsafe. Preserve native
  output on failure. Do not loosen strict verification of a saved input prefix.
- Rebase the SUBMITTED render plan, keeping prior boundaries and future requested new
  durations/overlaps unchanged. Log expected/actual/delta, store originalPlan, and serve
  actual take ranges. Never pad, truncate, re-encode audio/video or silently change the
  editable creative project. Guard arbitrary observedRow input in managedWindow().
- Recovery requires completed, available, same-backend native output; check count/rate
  again with real FFprobe before accepting. Confirmation creates a NEW parked copy of
  the original submitted plan (completed if final window). Back up and preserve the
  original cancelled lifecycle. No inference/cancel/resume is part of recovery.
- Recovery confirmation checks revision + output ID under the existing serialization
  gate and is idempotent. Save the new run only after successful verification. Unknown
  active acceptance and cross-backend ownership restrictions remain intact.
- New modules: progress-core.js, render-progress.mjs, progress-ui.js. Update static
  allowlist and HTML script order together. Tests: scripts/check-progress.mjs and
  tests/browser_progress_check.py; all existing suites remain required.
- Worker 1.2.0/plugin 1.0.5 remain unchanged. Do not make the update restart a GPU job.

## Cross-backend recovery contract (1.2.3)

- Backend scope is explicit. Missing backendMode is displayed as inferred pre-headless
  legacy. Never infer headless ownership from an empty worker queue or automatically
  map old plugin job IDs to the worker.
- Foreign checkpoints are not rewritten at init and are never launched by cancellation
  maintenance. Mismatched pause/resume/cancel/reconcile/attach requests fail before I/O.
- Explicit local retirement is distinct from verified native cancellation. It needs user
  acknowledgment and a preview revision/backend check; it makes no renderer calls.
- Retired is a terminal LOCAL tracking status, never a terminal native renderer status.
  Preserve old phase/status/error and native ID in retirement metadata plus a private
  backup; save failure must not change the live in-memory record. Files remain served.
- History restore only unhides a retired record. Changing backends/restarting must not
  revive it. Previous Node releases do not understand retired; document rollback limits.
- Current worker activity, queue pause, uncertain acceptance and same-backend records
  remain protected. Never generalize other-backend retirement into an unconditional
  force-clear of an active headless job.
- UI shows saved phase separately from lifecycle status. A foreign "cancelled" phase
  does not prove stopped rendering. Wrong legacy launch shows start-headless guidance.
- Test both mismatch directions, untagged records, no-network retirement, stale preview,
  zero GPU/queue actions, backup/save failure, history restoration and mobile controls.

## Sequence manager contract (1.2.2)

- sequence-server.mjs is the authoritative lifecycle owner; sequence-ui.js displays fresh
  observations rather than interpreting browser project status as renderer truth.
- Keep separate axes: sequence state, cancellation intent, local in-flight work, native
  job status, and global queue pause. Paused+cancelRequested is cancelling, never resumeable.
- Cancellation polling runs in Node without browser activity. No auto-resume of ordinary
  generation on startup, refresh, recovery or queue unpause. Reconcile never generates.
- End-idle needs an affirmative worker observation, no local in-flight operation and no
  uncertain acceptance. GET /requests found=false plus empty queue is NOT evidence that
  an unacknowledged in-flight remote submit can be safely forgotten.
- Never turn auth/timeout/malformed-response errors into job-not-found. Known missing IDs
  need request lookup and idle queue checks before cleanup. Other-backend records cannot
  be force-cleared merely because the current backend is idle.
- start/resume/control decisions serialize on the shared sequence-start gate. Record writes
  serialize per ID. work Map prevents two loops or duplicate archival for one sequence.
  Check cancellation/pause after asynchronous preparation and before submission. A cancel
  during submission must retain the eventual accepted ID and cancel that specific job.
- Safe cleanup backs up records; no media deletion. History is terminal-only visibility.
  Cleanup never unpauses the global queue or resumes anything else. Keep confirmations.
- If completion races cancel, keep verified output; if it cannot be mapped, keep the native
  job ID and warn. Do not block cancellation forever on an already finished renderer.
- The Render monitor must route kind=managed cancellation to /api/sequence; never send
  seq_ IDs to the renderer. UI actions do not trust stale preflight eligibility; the server
  rechecks. No automatic restart, kill, replay, or paid request to repair state.
- Tests: scripts/check-sequences.mjs, added real-worker cases in check-headless.mjs and
  tests/browser_sequences_check.py. Fixtures are gated/async; no claim of live GPU proof.
- Preserve worker compatibility 1.2.0 and unchanged plugin 1.0.5 for this Node-only patch.

## AI request contract (1.2.1)

- ai-server.mjs owns asynchronous AI requests and private disk history; ai-stream.mjs
  implements bounded native HTTP(S)/SSE for DeepSeek. No npm runtime dependencies.
- /api/ai start returns durable acceptance. Polling/list/get are read-only. A lost
  acceptance response is looked up by ID; never blindly submit again. Duplicate active
  pacing for one project is refused. No paid retry, model fallback or automatic apply.
- Browser disconnection must not abort the server request. User cancellation and Node
  shutdown abort upstream transport; server restart records interrupted work, never replays.
- Keep network phase/received-character progress honest: keep-alives are not generated
  tokens and no reliable ETA/percent is inferred. Distinguish idle/total deadlines,
  HTTP errors, incomplete streams, output truncation and downstream validation.
- SSE handles split UTF-8, CRLF, comments, DONE, final finish reason, usage on a final
  content chunk or a separate usage-only chunk. Incomplete JSON is diagnostic only.
- Terminal/logfile metadata must not contain prompts, output or echoed provider errors.
  Private records retain redacted creative text. Omit keys/media bytes and do not store
  provider reasoning channels. API keys must not survive on disk. Pairing/CSRF still apply.
- ai-ui.js uses textContent/escaped HTML for untrusted model/provider text. Recovery of
  pacing requires an unchanged source packet and existing project ID. Applying still
  forks a project. Other request types support diagnostics, not automatic rehydration.
- Preserve renderer files and compatibility version 1.2.0 for this patch. The headless
  worker must not be restarted merely to debug a planner timeout.
- Run scripts/check-ai.mjs and tests/browser_ai_check.py, then the full check runner.
  These use simulated upstreams, not evidence of successful live DeepSeek inference.

## Headless runtime contract (1.2.0)

- `node start-headless.mjs` is the primary entry. `bridge.mjs` alone is explicit legacy
  rollback; systemd sets H3_WANGP_BACKEND=headless. No automatic switch of running jobs.
- `headless/server.py` runs with WanGP's .venv interpreter and imports `shared.api.init`
  with no webui_state. Never retrofit browser callbacks or spawn a second Gradio runtime.
- `headless/engine.py` owns SQLite jobs/uploads/outputs and one FIFO dispatch thread;
  one SDK SessionJob at a time. Persist acceptance and task intent before GPU submission.
- Native generation must continue without Node or browser polling. Managed sequencing
  still belongs to Node and pauses safely on coordinator restart. Do not promise otherwise.
- Token is a persistent private file read server-side. Never send it in health responses,
  browser settings, URL query parameters, project/trace exports, or logs. Browser-provided
  URLs/tokens cannot override the headless endpoint (wangp-backend.mjs).
- Accepted request IDs are idempotent for the same payload and reject changed payloads.
  Lost responses resolve through read-only lookup, not a second blind submission.
- Worker restarts mark in-flight renders interrupted and pause previously queued jobs.
  No automatic renderer restart/replay. Do not fabricate diffusion checkpoint recovery.
- Public event consumption feeds telemetry. Optional SDK private state is observation
  only, never a dispatch dependency. Raw preview/tensor payloads must not go to SQLite.
- Archive immutable outputs and verify frame counts before assigning timeline ranges;
  a partial or wrong-FPS result stays unmapped. Preserve native originals on archive failure.
- Startup's Linux process-name guard is best-effort; checkout lock prevents duplicate
  worker instances, not arbitrary external GPU programs. No unrequested process kills.
- `backend-ui.js` exposes status/queue/explicit cancel/pause/reconnect. Polling is read-only.
- Network studio pairing token hashes persist for their seven-day lifetime; password
  changes revoke prior sessions. Equal trust for paired devices remains explicit.
- New tests must use the gated async SDK double, real service/Node restarts and files;
  never treat a synchronous mocked submit as proof a GPU or browser chain worked.
- Preserve other existing editor invariants below. No user's source media is bundled.

## Editing constraints

- Preserve source media, exact dialogue inside `<d>…</d>`, project IDs, render snapshots,
  and undo/redo semantics. Never silently migrate the user's creative choices.
- New UI writing hints must be HTML placeholders, never default prompt values. Maintain
  submission/export readiness checks. A model draft can be reviewable without renderable.
- Separate Subject identity, Speaker identity, library reference numbers, and actual
  per-task input slots. Binding to Audio 2 does not require Subject 2 or S2.
- Keep Visible and Heard independent, per shot. An unseen remote caller must not produce
  a visual-retention claim. An unreviewed legacy cast is unknown, not automatically visible.
- Do not auto-submit paid AI requests or GPU work as a repair/retry, refresh, import, sync,
  or migration. Require deliberate user action. Surface uncertain submission outcomes.
- Do not claim a mock/DOM test proves GPU generation, network deployment, audio identity,
  ASR accuracy, or ETA quality. Avoid another release that promises a queue handoff only
  modeled as an instantly completed render.

## Architecture / file ownership

| File | Responsibility |
|---|---|
| core.js | UMD pure project model, frame grid, six-section compiler, reference/cast/voice mapping, proposal validation, retakes, render ranges |
| storage.js | IndexedDB project JSON and media/voice sources, legacy localStorage migration, portable backup |
| ai-server.mjs / ai-stream.mjs | durable AI request lifecycle, explicit deadlines, SSE transport, safe logs |
| ai-ui.js | request monitor, private diagnostic downloads, explicit pacing recovery |
| providers.js | planner protocols, in-memory API keys, remembered WanGP/HF keys, trace capture, authenticated bridge calls |
| app.js | primary state/undo/rendering, timeline editing, proposals, native submission and monitor dialogs |
| direction-ui.js | shot presence, per-window source overrides, voice routing, pacing, dialogue attribution review |
| speech-core.js / speech-ui.js | non-destructive cuts and waveform workflow |
| soundscape-ui.js | targeted soundscape-only drafting/review, no rewriting the film |
| takes-ui.js | existing native alternate-take/import/edit-list workflow |
| studio-core.js | pure managed-window compilation, diagnostic redaction, continuity heuristics |
| studio-ui.js / studio.css | Program Monitor, thumbnails, activity stack, explicit publication/pull, managed control UI |
| studio-server.mjs | pairing auth, allowed Host/Origin, disk CAS projects, immutable blobs, ranged media |
| sequence-server.mjs / sequence-ui.js | serial coordinator, lifecycle/queue reconciliation, safe cleanup, global mobile manager |
| bridge.mjs | HTTP dispatch, static serving, upstream provider/Codex/OpenCode APIs, studio/voice/media integration |
| voice-server.mjs / scripts/voice_worker.py | isolated CPU speech workers and public-source media extraction |
| headless/ | standalone worker, persistent SQLite FIFO and observed telemetry |
| wangp-backend.mjs / start-headless.mjs | fixed backend routing, detached worker lifecycle, no shell |
| backend-ui.js | server queue/health, explicit job recovery |
| scripts/install-services.mjs | opt-in Linux user unit generator, no automatic start |
| wan2gp-h3-director/ | LEGACY ONLY, UNCHANGED 1.0.5 plugin and telemetry adapter bound to existing Gradio runtime |

Historical architecture notes are omitted from the release candidate. This file takes
precedence for 1.1 networking, credentials, traces, and managed continuation.

## Project model additions (schema still version 1)

`mode` is `sliding`, `managed`, or `independent`. Unrecognized modes normalize conservatively.
`windows[].casting[subjectId].sourceAssetIds` optionally narrows inherited visual inputs.
Omitted = inherit subject.assetIds. Empty array = no visual reference for that subject
in that window. Direct `window.assetIds` remain explicit inputs and are not hidden merely
because a character is silent. Source narrowing and prompt remapping must change together.

`renderThumbnails` holds window/take-specific IndexedDB keys. `traceIds` references large
JSON blobs, not embedded raw request bodies in localStorage. Old variants may still contain
raw model output. Each render owns a frozen plan/snapshot: editing the timeline must not
change the recorded frame range of an old take.

`jobs[].kind==='managed'` and `jobs[].id` with prefix `seq_` refer to the Node coordinator,
NOT native adapter job IDs. Plans have absolute cumulative ranges but distinct per-window
task indices. Output bytes are served through /api/studio-media/<owned-output-id>.
Never send a seq_ ID to the native adapter. Native records remain unchanged.

## Timing and continuation invariants

H3's encoded frame contract is 24 fps, 17k+5 generation spans (minimum107), overlap0 or
1+17k up to120. A scheduled row contains `kept`, `overlap`, `span`, `start`, and `end`.
Overlap is previous audiovisual context, not extra final footage. A source prefix shifts
absolute coordinates, not requested new duration. Do not use seconds where frames are expected.

H3.tasks(managedProject) intentionally throws. H3Studio.managedWindow() creates a
single-window native `sliding` task with the correct preceding `continuation.keepFrames`;
its calculated retained frames/overlap must equal the original managed row. The compiler
then maps fresh inputs and inserts the overlap Picture1 anchor when applicable.

The coordinator checkpoints BEFORE submitting. After /generate returns a job_id it polls
that same job until terminal. A completed output is archived, verified by real FFprobe for
exact cumulative frames at24fps, and only then becomes the next source. Do not loosen a
failed frame check silently. Imported prefix IDs are generated by the adapter, not filesystem
paths supplied by a browser. Source files are frozen by the adapter before native submission.

Current managed mode starts from the first window, with no native generation-time upscaling.
It is not arbitrary managed retaking from the middle. Implementing that later requires a
verified owned archive/source, scope semantics, correct absolute mapping and reference pool,
and explicit invalidation of downstream continuity. Do not merely change a mode string.

After restart or a lost response, reconcile; never blindly repeat /generate. An uncertain
submission must be matched to its actual native job. Cancelling an active job and pausing
after a window are different. No next task may submit after a pending cancellation. Keep
archival failures retryable WITHOUT repeating GPU generation.

The current prefix strategy retains every cumulative MP4. Storage/I/O grow faster than the
final file. A future optimization must retain source ownership, frame verification, and
no-delete-until-referenced safety; do not silently delete user outputs.

## Networking and privacy

Default loopback127.0.0.1; H3_HOST=0.0.0.0 enables network pairing. Host checks allow local
interfaces, localhost, your-hostname, explicit H3_HOSTNAMES, exact H3_PUBLIC_ORIGIN. Do not accept
arbitrary Host/Origin, wildcard CORS, credentials in URLs, redirects for media requests, or
arbitrary browser-supplied server paths. Mutation requires the bridge CSRF token after
pairing. Network binary media is also gated by the HttpOnly SameSite session cookie.

`H3_DATA_DIR` is private mutable state, outside the release. Never package it, `.voice-venv`,
real credentials, personal project files, downloads, __pycache__, or model weights. Project
writes are atomic and compare expectedServerRevision; a conflict is 409, not last-write-wins.
Media keys map to hashed filenames and immutable bytes. Pairing password uses scrypt;
sessions are in memory and expire/reset on bridge restart. Credentials are intentionally
plaintext (WanGP/HF only); provider API keys remain memory/environment.

Diagnostics preserve private creative content but strip credentials and media data URLs.
Do not log auth headers. Captured AI trace has actual system/prompt, visual attachment labels,
usage/finish reason when supplied, raw assistant text, errors, times; it does not pretend
to contain original images/audio or metrics not returned by a provider. Native submission
traces capture the actual task payload and uploaded-ID mapping. Managed submissions live
in run checkpoints. Never attach a new trace to a different project that became active
while the request was running.

Sync is explicit publish/pull with optional debounced pushes, not collaboration. Retain
local work on409. A published fork must get a new projectID, not overwrite a server revision.
Token deletion cannot erase another device's already-downloaded local copy; state that clearly.

## UI correctness

Program Monitor must not shrink to zero in .main's flex layout, and a hidden mobile rail
must not place .main in a zero-width grid track. Existing browser test covers these regressions.
Use real selected-output frames for thumbnails; never show source pictures as render results.
Use ranged streams, not an entire final MP4 converted to a base64 localStorage field.

Activity notifications distinguish running, completed, error, and uncertain. Dismissal is not
cancellation. Whole-sequence ETA is currently intentionally missing; a current native job's
ETA must not be called the full-film ETA. Preserve measured H3 vs postprocessing counters.

## Test / release gate

```sh
node scripts/check-all.mjs
node scripts/check-all.mjs --integration
```

Optional integration needs installed Gradio, Playwright, Chromium, FFmpeg/FFprobe. Tests use
mock WanGP/providers and offline DOM loading; do not silently launch real API/GPU calls.
`PYTHON_BIN` and `CHROMIUM_BIN` choose interpreters. Run tests from a fresh ZIP extraction
before publishing. Check ZIP CRC and SHA256 manifest. Report failed/skipped checks, not only
passes. Keep screenshots synthetic and label them. Never bundle fonts from the environment.

A future Pi/full agent should propose typed edits through the same validation/review/undo
path and get explicit permission for provider or GPU work. No agent runtime is included now.
