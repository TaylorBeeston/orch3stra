# Existing-image inspection recovery · 2.0.1

## What the error actually meant

`Uninspected or duplicate existing image.` came from validation of the AI's
`inspections` response. It meant an entry named an image outside the attached
batch, or the reply repeated an image ID. It was **not** a finding that the user's
library, subject defaults, or scene pins contain duplicate files. Do not delete
pictures or remove valid reference bindings in response to that message.

The old all-or-nothing validator discarded usable judgements when a single row was
malformed. Resume could then load the same stored response and fail indefinitely.

## What changes

Each inspection has a durable, exact list of image IDs, short keys (`I1`, `I2`, ...),
allowed requirements, attached image IDs, and a fingerprint of the relevant source
and scene context. The model returns one judgement per supplied item, not one per
requirement and not a copy of the entire library catalog.

Agreeing duplicates are coalesced using the lowest supplied score. A conflicting
verdict or requirement set is not guessed. Unknown IDs receive no evidence or
approval. Valid rows for other images are retained. Missing, invalid, or conflicting
rows get a targeted recheck rather than restarting all windows.

The short keys are local to the captured packet and resolve to exact registered
IDs. There is no filename/face inference, permissive ID guessing, or blanket source
approval. The visual suitability threshold is unchanged.

## Continue an old blocked run

1. Open **References → Fill missing coverage** and choose the stopped run.
2. If **Continue saved inspection** appears, use it. The original completed reply
   can be interpreted safely by the new parser, so that inspection is not billed again.
3. Otherwise use **Recheck unresolved images**. Confirm one new AI inspection of
   the remaining images. Completed windows, accepted images, valid checks and spent
   allowances stay in the same run. This is not an H3 video rerender.
4. Subsequent planning/generation follows the run's existing permissions and budgets.

Legacy replies are reused only if their original image packet can be recovered and
matched. If the input metadata was pruned or the scene changed, a fresh confirmed
inspection is required. The screen gives the affected filenames and links to the
captured request. A still-running or uncertain request must be reconciled, not
silently duplicated.

## Optional one-shot correction

The settings expose **Repair a malformed inspection reply once automatically**.
It is opt-in for existing runs. New quick-flow setup preselects it, but nothing is
sent until the user confirms starting the workflow and its allowance.

One corrective request is permitted per failed batch, within the run/group's normal
AI budget. Only unresolved images are sent. A second malformed result stops for
review. Transport errors, provider failures, interrupted requests, and unavailable
pixels are not automatically replayed. A human-requested repair also receives only
one attempt; it does not start another hidden correction chain.

## Reject a generated candidate without restarting

The same workspace has **Reject & retry this image**, a corrective-direction field,
and an optional full-prompt editor. **Reject and pause** records the decision without
sending anything. Rejected pixels stay in history, outside the approved reference
bank. Plain Resume does not approve a user-rejected candidate.

A retry preserves the approved sources and target requirement, checks prompt tokens,
uses a new native request ID and random seed, then reviews the new pixels. The old
candidate is not used as an input or deleted. No extra planning request is required.

If the per-window attempt limit is reached, **Allow 1 more attempt & retry** requires
explicit confirmation. This grants one additional attempt for that window only and
does not expand total image or AI limits or erase spent attempts. Unknown GPU work,
stale candidate IDs, or cancelled parent sequences prevent a retry.

## Limits

This is robust response parsing and recovery, not a guarantee of image quality.
An AI can still misjudge visual content. No stale evidence is carried into a changed
wardrobe/scene or different image. Real missing files, exclusions, unapproved
sources, explicit pins and unsupported input budgets remain real constraints.

The supplied older diagnostics do not contain the user's most recent malformed
inspection reply. Tests reproduce the actual validator/state-machine contracts with
controlled model replies; they do not claim to reproduce unseen provider text.

## Tests

```
node scripts/check-inspection.mjs
node scripts/check-candidate-review.mjs
python3 tests/browser_workspace_check.py
node scripts/check-all.mjs --integration
```

Provider/model responses are fixtures; no live inference is implied. The browser
suite executes the real UI in Chromium with modeled storage/transports.
