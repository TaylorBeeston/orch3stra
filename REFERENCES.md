# 1.5.0 additions: unified development and source replacement

Film desk develops cast + outline together, then opens the existing image studio. Subject
cards expose Refine everywhere to carry a requested identity change into all relevant live
fields. Image plans are staged, not automatically generated. Approve generated replacement
pictures with **Replace an existing identity / state source** to atomically redirect live tags
and bindings while preserving originals. Cast source checkbox changes now persist without
also enabling the custom-source switch. Use Clinic instead of deleting to meet task budgets.
See FILM-DESK.md for exact limits and the new voice-generation workflow.

# Subjects and reference-image studio — 1.4.0

## Portrait-phone workflow

Use **Subjects & images** in the main toolbar. It remains accessible when the ordinary
left library is collapsed on a narrow screen. The workspace opens full-height on phones
with an independently scrolling body, persistent heading, large controls, and a sticky
Save area. It responds to the browser visual viewport when the keyboard changes height.
There is no requirement to rotate the phone.

**Create subject** opens an unsaved form. Give the subject a name and stable identity
traits; select existing pictures or upload new ones without losing the form text. Save
creates/updates the character. Closing an unsaved new form does not leave a ghost subject.
Optionally use the subject in the selected/all windows, then review Cast & speech:
being in the library does not imply visible in Shot 1 or speaking in every scene.

## Pictures are not subjects

An uploaded file is a picture; a subject is an explicitly registered identity. From the
workspace, classify each image as a **scene, prop, style or direct reference**, link it
to an existing subject, or choose **Create character from this image**. Backgrounds do
not need to become characters.

Before a full video draft, unclassified images prompt for review. Cancel returns without drafting or changing anything. In the manager, **Use unassigned
as direct refs** classifies remaining files without creating subjects; then retry drafting.
The planner receives a closed catalog. With zero subjects its schema contains empty
subjects/subjectIds/casting arrays/objects, rather than an invented Subject 1 example.

Exact existing UUIDs, Subject tags or unique names returned in ID fields can be normalized
and the repair is recorded in proposal notes. Unknown/ambiguous identities are not guessed.
Their raw response stays available for diagnosis. This addresses a schema/prompt weakness,
not all reasons an upstream request can fail. Use **AI requests** for network, truncation,
JSON and semantic errors. There is no automatic paid retry or automatic subject creation.

## Plan missing references with your selected AI

1. Select the normal planner/model in Connections. For visual inspection leave **Send
   images** enabled. DeepSeek Flash currently supports images, but not every alternative
   planner does; turn images off explicitly for a text-only model.
2. Open **Subjects & images → Image studio**, or **Generate variants** on a subject.
3. Write the request, for example:

   > Check the existing Niko and Roman references against the bowling story. Propose one
   > full-body bowling-outfit reference for each cousin and an empty wide view of the
   > bowling alley. Keep their facial identities and the established visual style. Do
   > not add extra characters or change any of the video dialogue.

4. For a direct planning call, select at most 12 pictures and click **Plan selected images**.
   Only those JPEG thumbnails (long side ≤640px) are attached. For a large library, click
   **Ask planner which references to inspect**: the first request sends story/subject metadata
   and the complete filename/description manifest, but no image bytes. Review the returned exact
   UUIDs, choose the pictures, and confirm each visual batch (up to 12 thumbnails per request).
   The assistant may request another batch after inspecting one. Each batch is a separate AI
   request; none is sent automatically. Manual and staged planning do not start GPU work.
5. Review/edit the proposed prompts, target subject (or scene), state, suggested windows,
   optional local appearance/retention, and ordered source images. At most eight output
   pictures are proposed per plan. Raw request/response and failures are retained.

This operation uses the selected planner and its normal costs/subscription. It does not
submit anything to the GPU or alter existing video windows. An invalid plan cannot
create a character or media file. Existing source images/descriptions are source material,
not higher-priority instructions to the planning model.

### New characters

Use **Create subject**, describe a character, then **Save & generate images**. With
no image source, request an initial identity anchor. Generate and approve that image
first, then plan wardrobe/location variants using it. Independently generated text-only
portraits are not a verified identity-consistency mechanism. The system asks for one
anchor before variations; users can edit proposals, but should inspect faces and clothing.

## Generate with Qwen Image 2.1 through WanGP

Requirements: a WanGP checkout exposing native `qwen_image_21_7B` and Director headless
worker 1.4.0+ for standard image tasks. Viggle profile discovery requires the current
1.5.0 worker code and WanGP 13.1314+ exposing exported Qwen accelerator profiles. This is
not a paid Qwen API call; no weights are bundled. WanGP's existing native handler and
download/offload behavior remain in control.
Do not install Diffusers/Transformers into WanGP for this feature: its existing native
handler is used. Native model download/offload behavior is controlled by WanGP.

Click **Discover Qwen 2.1 presets** while WanGP is idle. If absent, update WanGP through its
normal process and restart the idle worker. Choose the actual discovered preset and canvas.
Standard mode defaults to 1024×1024, 40 steps, guidance 4, sampler `default`, and one
guidance phase. The app accepts 256–2048 dimensions on a 32-pixel grid; these guardrails do
not guarantee VRAM fit.

When the exported WanGP accelerator profiles include Viggle Turbo, Image Studio offers
the exact discovered 4-, 5-, and/or 6-step profile(s). A selected profile applies its
matching `activated_loras` entry at multiplier 1, `viggle_v02` scheduler, step count, and
guidance 1. Client requests carry only the profile ID; the headless worker resolves the
LoRA from WanGP's exported profile and rejects unknown IDs or arbitrary paths. This is an
opt-in Qwen acceleration profile, not a model change or a speed/quality guarantee. WanGP
handles any missing LoRA download; inspect profile details and restart the idle worker
after updating WanGP or adding profile files before rediscovering.

The task sends the profile ID, not a filename/path. WanGP's exported profile supplies
`activated_loras`, multiplier 1, `viggle_v02`, matched steps and guidance 1. The Director
never sends arbitrary LoRA paths or `viggle_turbo_lora_filename`. That unexpected constructor
keyword indicates a mismatch between the running WanGP Qwen loader and pipeline; update
the same WanGP checkout, then restart the idle worker before trying again.

The official September 20, 2026 release is under the **Qwen Research License**, restricting
use to noncommercial research/evaluation and requiring separate commercial permission.
Read the upstream license linked below. A fresh browser origin starts unchecked. After
explicit acknowledgement, the current license revision stays checked across projects and
reloads in that browser profile. The marker is local-only, not included in project backups
or sync; unchecking revokes it, and a changed license revision requires review again.

Each task accepts up to ten ordered input images. Qwen uses `<image1>`, `<image2>`, …,
not H3's `<Picture N>`. Moving an input with the arrow buttons remaps the prompt tokens
and payload together. Removing an input still mentioned in the prompt requires editing
that prompt first. Inspect any advanced manual changes to the input-ID field.

Generation uses the **same serialized WanGP queue/model runtime** as H3. It never launches
a competing image-model server. Finish or safely park a managed sequence before starting
image tasks; an active or uncertain managed/finishing reservation blocks image submission.
Multi-image generation is sequential, not parallel GPU inference. Switching models can
require substantial loading time and memory. No automatic paid or GPU retries.

A request ID and intent snapshot are saved before dispatch. A missing response becomes
**uncertain** and is looked up read-only rather than blindly submitted again. **Reconnect
image jobs** reads recent worker records and their saved cards, allowing recovery after
a browser refresh. The worker's recent-list limit still applies; this is not an unlimited
search of every historical native file. For a still-uncertain attempt, **Resolve / retry
original request…** first performs a read-only lookup. If absent, explicit confirmation
can send the exact saved request ID/payload to the same idempotent worker. This may start
work that was never accepted; it never incorporates edited prompts or silently retries.
A known validation/admission rejection is displayed as rejected, not permanently uncertain.
Completed output IDs refer to privately archived,
fingerprint-checked images; changed/missing files are not silently replaced.

## Approve candidates, then assign their state

Generated candidates appear below the image plan. They are **not automatically references**.
Click **Use this image** to import original image bytes into the library/IndexedDB, with
source prompt, model, input IDs and job/output provenance. Publish via Shared studio to
sync that accepted library file to other devices; ordinary portable backups also include it.

For a new subject with no default identity image, its first accepted image becomes a
default source. Later images become `referenceVariants`, not additional global defaults.
This keeps bowling clothes from automatically conditioning every street scene.

The optional **Also use in suggested windows** checkbox is off by default. When selected,
known subject windows need reviewed Cast & speech. It sets only those windows' local
source selection and supplied appearance/retention. A scene image becomes a direct
reference in the selected windows. Timing, dialogue, historical render snapshots and
original media stay unchanged. The operation is undoable. **Old contradictory detailed
prose is not automatically rewritten**, so review it after changing wardrobe.

Variants are also selectable manually under **Cast & speech → Window-local appearance
& retention**. Review H3's existing reference count/duration limits before video submission.
Qwen accepting ten input images does not increase H3's input limits.

## Known boundaries

- Not an autonomous agent that downloads/generates/accepts everything without review.
- No automatic cropping, face recognition, name identification or prompt-injection-proof
  understanding of arbitrary image text. Labels/links are explicit user choices.
- No guarantee of character fidelity, correct wardrobe, or model adherence to a request.
- No Qwen turbo/older-Qwen fallback disguised as Image 2.1. Registry architecture must match.
- Image job progress is native generic progress, not H3's eight-step/window ETA.
- Planned prompts and job metadata can contain private story material. Exports omit secrets,
  not your creative content. Uploading samples to a remote planner sends those samples.
- CPU image decoding/import and raw source blobs still consume browser/system RAM.

## Primary sources checked September 24, 2026

- Qwen release: https://github.com/QwenLM/Qwen-Image-2.1
- Qwen license: https://github.com/QwenLM/Qwen-Image-2.1/blob/main/LICENSE
- WanGP release notes: https://github.com/deepbeepmeep/Wan2GP
- WanGP LoRA guide: https://github.com/deepbeepmeep/Wan2GP/blob/main/docs/LORAS.md
- WanGP Viggle profile: https://github.com/deepbeepmeep/Wan2GP/blob/main/profiles/qwen21/Viggle%20Turbo%20v0.2.1%206%20Steps.json
- Native handler: https://github.com/deepbeepmeep/Wan2GP/blob/main/models/qwen21/qwen21_handler.py
- Native API settings: https://github.com/deepbeepmeep/Wan2GP/blob/main/shared/api.py
- DeepSeek vision: https://api-docs.deepseek.com/guides/vision/

Integration tests use real local images/HTTP/archives, but simulated model results.
See VALIDATION-1.4.0.md before treating this as tested GPU inference on your installation.
