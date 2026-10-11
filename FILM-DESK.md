# Film desk and Project clinic — 1.5.0

## One guided workflow

Open **Film desk**, describe the movie, then **Story + cast / Propose cast & timeline**.
A single planner operation proposes every recurring role and rough beats together. No
images or pre-existing subjects are required. Review names, descriptions and durations.
The model can ask follow-up questions; answer in the constraints box and ask again.
Creating the development copy preserves your source project and render history. New
windows are scaffolds with empty detail/soundscape fields: they must be drafted before
rendering. An entry/exit outline is not a finished H3 prompt.

Use Images to approve one identity anchor per person, then outfit/location variants.
Use Voices to give each character an original voice description, generate candidates,
audition and approve a WAV. YouTube/local-file Voice workshop remains available for editing
recordings. Final Draft uses the existing one-window-at-a-time planner and explicit proposal
application. Clinic checks the result before submission. Render opens the existing Send view.

These stages guide rather than enforce order. A silent movie need not create voices; a
text-only project need not create images. The 9-image limit applies to each actual H3 task,
not the whole library. Native sliding mode has a union pool; managed mode has per-window pools.

## Conversational refinement

Examples:
- “Make Crew member A brown-haired everywhere she appears, preserving Crew C. Prepare a
  new identity image prompt, but do not change the story or spoken dialogue.”
- “Add more exposition showing each crew member's ordinary life before recruitment.”
  The assistant may ask how long or where. Answer in the same conversation.

The conversation is project data, so it participates in ordinary save/sync/portable backups.
Each request includes recent messages, current story outline, exact editable keys/values,
and selected images (only when enabled). Character focus narrows scope. Field selection is bounded
to 190,000 characters by default and 2,000,000 for Codex GPT-6 Sol. The packet reports included
field characters and the exact number omitted; the UI warns when fields were omitted. This is a
field-character budget, not tokenizer accounting, so provider context limits can still reject a
large or token-dense request. Six image samples maximum. A long-history conversation is not
infinite memory. Raw requests/results use the existing AI-request inspector.

Edits are typed JSON proposals, not executable scripts. The model may propose exact before/
after field changes, counted exact replacements, up to eight inserted windows, and image cards.
Unknown subjects/keys, duplicate anchors, stale fields or invalid casting are rejected. All
literal <d> blocks stay unchanged unless the user explicitly enables spoken-word changes.
A proposal referring to changed creative data must be refreshed, even if unrelated render
progress continues. Approve checked changes as one undoable transaction. No request directly
starts GPU work. New characters during an edit must be created through Subjects; the joint
new-film flow is the path that proposes a new catalog.

Prepared replacement image prompts appear under Images / saved plans. After generating and
reviewing a candidate, expand **Replace an existing identity / state source**, choose the
old source and confirm. Its live default and per-window bindings, exclusions and exact tags
are replaced together. The old asset and historical provenance stay. Pick an image serving
the same role: replacing a civilian anchor globally with a spacewalk picture is not a wardrobe
migration. Apply textual appearance changes separately using the assistant or Clinic.

## Project clinic

Errors/warnings have a specific source field, binding or window pool. Filter by phrase,
character or window, and use Go to fix. Text repairs require exact unchanged before values.
Known library tokens are available as insertion buttons; the tool never guesses that a
missing Picture 2 meant Picture 16. When a missing binding exists, select valid sources in
Cast & speech. Imported missing references remain inspectable instead of crashing project load.

Input budget shows the real physical H3 task pool. Unchecking a picture adds a per-window
exclusion without deleting it. Prose that still mentions an excluded file gets its own issue.
In native sliding mode an image used elsewhere remains in the union; choose managed mode or
repair all participating windows rather than assuming one checkbox removes it globally.

Global source replacement updates live references atomically and retains both originals and
captured takes. Deletion of an in-use file now redirects to repair rather than breaking all
its uses. Descriptions are not arbitrary searchable JSON: historical raw AI, render snapshots
and generation provenance never participate in live replacement. Brown-hair/black-bob warning
is deliberately a narrow heuristic; Clinic is not a comprehensive semantic consistency judge.

## Voice studio

Uses native Qwen3 TTS VoiceDesign through the existing serialized worker (1.5.0+), with prompt
as the exact sample text and alt_prompt as original voice direction. The duration control is
an upper limit, not a guaranteed exact duration. Model setup/downloads are WanGP's responsibility.
Candidate audio is verified, archived privately, streamed with authentication, then bound only
on approval. Use one approved recording repeatedly for consistency, rather than regenerate a
new voice on every scene. Sample identity/timing/lip sync still depend on H3 adherence.

H3 audio reference budgeting remains separate: at most two inputs, at least 2s each, 15s total.
A saved longer recording needs trimming. Checked per-shot Heard settings determine when a
character's bound sample is submitted. Original speech in a voice sample is not requested dialogue.
A lost voice submission reply is uncertain; reconnect by saved request ID, not an automatic retry.
