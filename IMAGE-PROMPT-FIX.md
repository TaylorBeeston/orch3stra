# Single-image prompt handling and recovery — 1.9.2

## What broke

The 1.9.1 reference planner correctly bound the authoritative coverage target, but
`generationPrompt()` wrote the target and the composition suggestion as two paragraphs.
Neither the image-task builder nor the Python image resolver set `multi_prompts_gen_type`.
WanGP could therefore select `PG`: separate paragraphs become separate generation tasks.
The standalone single-task API rejected the request before rendering.

The correct contract for one image card is `multi_prompts_gen_type: "FG"`. All paragraphs
belong to one prompt. Do not strip the coverage constraints, increase batch size, or
change H3's separate `PW` sliding-window behavior.

Official semantics checked against WanGP's docs/PROMPTS.md, Text Prompt Basics and
How To Process Each Line:
https://github.com/deepbeepmeep/Wan2GP/blob/main/docs/PROMPTS.md

## What changes

- `reference-core.js` sends FG for each Image studio/agent task.
- `headless/reference_images.py` independently forces FG in resolved settings, preserving
  the exact prompt, input order, steps, guidance, and supported Viggle profile.
- The worker forces FG on image dispatch copies too, covering old queued image settings.
  It does not rewrite their submitted payloads or replay terminal jobs. Video/voice modes
  are not modified.
- Worker 1.9.2 advertises `reference_image_prompt_mode: "FG"`. Node refuses new reference
  images against an older worker and explains the necessary idle upgrade. Existing accepted
  work can still be reconciled. No auto-restart or automatic GPU cancellation occurs.
- Fill references detects a terminal, output-free paragraph-splitting error and offers
  **Retry image as one prompt**. It rechecks the actual job before making a new attempt.

## Install: THIS update requires an idle worker restart

1. Preserve your project backup. Let GPU work finish (or cancel it deliberately), and park
   managed automatic dispatch. Let AI requests finish or park. Stop the old Node coordinator.
2. Extract the new release into a fresh folder. Keep the same H3_DATA_DIR and environment.
3. From the NEW h3-director folder run:

```sh
node start-headless.mjs --stop
node start-headless.mjs
```

`--stop` refuses active rendering. It stops the old detached worker, not just the browser.
The new launch must report worker 1.9.2 via **WanGP server** or `--status`. Updating Node
alone will reconnect to the old Python process and will not load the fix.

For systemd, update the installed service paths to this release while idle, stop the Node
coordinator, restart `h3-wangp.service`, then restart `h3-director.service`. Do not launch a
parallel manual worker. Service setup and persistent paths are documented in HEADLESS.md.

The worker's static token, SQLite database, uploads, archived outputs, and projects remain
under H3_DATA_DIR. No pip install, WanGP checkout patch, plugin replacement, or token reset.
Queued work is paused after worker restart; inspect **WanGP server / Sequences** before
unpausing, since other queued native tasks may then run.

## Recover the EXISTING reference run

Open **Fill references**, choose the stopped run, and click **Retry image as one prompt**.
This explicit operation:

- Requires a known failed image job with this precise parser error and no generated files
  or output records. Running, unknown, completed, or output-bearing jobs cannot use it.
- Preserves the full saved composed prompt and image settings. Reuploads the same source
  IDs in the same order as necessary. The only semantic routing change is FG.
- Uses a new native request ID, so the worker does not return the same failed job forever.
- Keeps the old request/native result in imageRetryHistory for diagnostics.
- Retains completed windows, accepted candidates, project fields, and spent allowances.
- Does NOT repeat the AI planning call. Candidate review and subsequent checks still use
  the usual AI allowance. The replacement image costs a new image attempt.

The failed attempt still counts. When a budget is exhausted, expand it explicitly using
this run's settings; **Continue with these settings** also recognizes the image retry.
Ordinary Resume only reconciles; it never guesses that a failed job should be resubmitted.

For a parent managed sequence, the image retry does not override a cancelled/finished parent
or a pause-after-window request. Resume/reconcile that parent deliberately when ready; no
new video window is submitted merely by opening these controls.

## Validation scope

Focused regressions cover multiline text-to-image and edit prompts, standard and Viggle
profiles, two separate image cards, persisted queued jobs, image retry confirmation,
budgets, state races, Node restart, stale workers, and refusal on unknown or output-bearing
jobs. Real local HTTP, SQLite, image archiving, and browser controls are exercised.
WanGP model inference and provider decisions are simulated, not live GPU validation.
