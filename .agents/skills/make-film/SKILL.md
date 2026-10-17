---
name: make-film
description: Make, review, and finish an original film in Orch3stra through its CLI or MCP tools, from story and reference development to real footage, Post, export, and backup. Use for agent-driven filmmaking, not merely UI testing.
---

# Make a film with Orch3stra

Work from the repository root; check `node --version` is **22 or newer** and select an already installed supported runtime if needed. This skill operates on **server-published projects**, not unsynced browser copies. Never modify an existing film without reading its current record and preserving its media. Do not confuse a successful tool call, a completed render, and a good film.

## Connect and discover first

```sh
node orch3stra.mjs tools
node orch3stra.mjs describe project
node orch3stra.mjs doctor
```

If no studio is running, `node bridge.mjs` starts the editing server without starting a renderer. Keep that process running in a separate terminal. For generation, an independently installed working WanGP environment and licensed, available models are required: `node start-headless.mjs --check` inspects prerequisites (exit 2 means structural checks passed, not model inference verified); `node start-headless.mjs` starts/reuses the real worker and studio. Use `--setup` only if paths have not been configured. Never replace a live server, restart an active worker, install packages, or download models merely to make a check green. Read [connection and safety](references/operations.md).

Use `--url` or `ORCH3STRA_URL` for a known studio origin. Remote pairing uses `pair --password-stdin --cookie-file` and a private cookie file; do not put passwords in command arguments. Read `describe TOOL` before calling a new family: its schema, actions, effects and examples are the executable contract. CLI accepts `--json @request.json` or stdin; MCP accepts the identical argument object. [Tool map](references/tools.md) makes every family discoverable without reading application code.

## Working agreement

- Inspect the supplied brief, project, settings, assets, jobs and capabilities yourself. Ask only for missing **creative choices, spending/compute ceilings, distribution/rights, or identity/voice consent** that materially change the film. Do not interview the user for observable settings.
- Define audience, intended feeling, premise, duration/aspect ratio, delivery, and a finite attempt budget. An agent can author creatively; an existing configured planner is optional, not a prerequisite.
- No provider/GPU/CPU/network/delete permission is implied by connectivity. Pass `--allow` (MCP `_allow`) only for explicitly authorized effects. Model/license acknowledgement is separate and per dispatch. No invented IDs, outputs, consent, model availability, or live-generation success.
- Existing-project mutations use `projectId` and the latest **`serverRevision` as `expectedRevision`**. On conflict, reread and compare; never silently overwrite. Store real uploads under immutable keys; changed bytes need a new key.
- Persist request, intent and returned job IDs before moving on. Submit once. On lost replies, inspect/reconcile the same operation; do not spend again. A wait deadline does not cancel a job. Review/paused/uncertain means stop and inspect, not auto-resume.

## Production loop

1. **Plan the emotional cut.** Establish → change → payoff; each shot must supply new information or feeling. Lock cast, wardrobe, location, props, screen direction, exact dialogue and voice routing. Read [creative direction](references/creative-direction.md).
2. **Author an actual project.** Use `project`, `story`, `subjects`, `timeline`; use packets for an optional planner or write the plan yourself. The [programmatic recipe](references/recipe.md) creates a complete original silent microfilm plan with dynamic IDs and CAS, without provider or GPU work.
3. **Develop the look in stills first.** Import owned/licensed imagery or explicitly authorize image generation. Approve one identity anchor before variants; select only references needed by this shot. Inspect the actual image, not just its caption. Repair scene/coverage conflicts without deleting cast or dialogue. Read [references and generation](references/generation.md).
4. **Calibrate one short window.** Discover the actual installed model/profile, compile and validate the task, inspect its reference manifest and timing, then approve one bounded dispatch. Watch and listen to the actual result at full speed and around cuts before scaling up. A missing model/rights/consent branch stops generation honestly; keep the authored project and state the prerequisite.
5. **Review and choose.** Adopt authoritative completed jobs; keep originals and alternatives separate. Compare takes, trim handles, inspect continuity into descendants, and use local speech evidence/listening where relevant. Do not infer pixel/audio quality from progress or ASR alone.
6. **Finish without regenerating unnecessarily.** Create Post from selected footage, cut/mute/trim, place permitted ambience/music, attach only observed-audio captions, export with CPU finishing. Upscale only a locked master if specifically authorized. Read [review, sound and delivery](references/finishing.md).
7. **Deliver evidence and backups.** Download/play the actual MP4; verify joins, duration, canvas, audio, captions and end frame. Include project ID/revision, selected takes, export/job ID, local file/hash, caveats and remaining rights restrictions. A portable project backup and downloaded generated footage are separate necessities. Never report a generated film when only a plan or synthetic transport smoke exists.

## Progressive reference index

- [Operations](references/operations.md): launch, pairing, MCP configuration, permission/rights budget, recovery.
- [Tool map](references/tools.md): every authoring/service family and when to use it.
- [Creative direction](references/creative-direction.md): emotional arc, coverage, continuity, dialogue and prompts.
- [Executable recipe](references/recipe.md): concrete original brief, JSON requests, dynamic IDs, full production continuation.
- [References and generation](references/generation.md): image-first development, sparse inputs, optional planner/coverage loop, real dispatch/adoption.
- [Finishing](references/finishing.md): measured audiovisual review, speech alternatives, soundtrack/captions, export/upscale/backup.

MCP hosts can discover this same skill and reference files through `resources/list` (`orch3stra://filmmaking/SKILL.md`) and invoke `prompts/get` with `name:"make_film"`, a `brief`, and optional `constraints`.

## Verified boundary

The real local studio has been driven through this recipe's planning/backup path, CLI and MCP authoring, actual image upload/probing/Post transfer/download, stale-write rejection, and explicit browser pull of the resulting three-shot plan. Retained authoring evidence: `/home/taylor/.local/state/orch3stra-verification/20261016-agent-filmmaking-02/`; scratch services were removed while evidence survived. Worker/provider generation and artistic quality require a separately authorized real-media run; fixture coverage and the authored plan do not establish them. Use [the verification skill](../verify-orch3stra/SKILL.md) and maintain its feature map when the application changes.
