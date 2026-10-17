# References

Maintain reusable subject identities, classify real uploaded pictures, and review generated candidates before adopting them. Follow [SKILL.md](../SKILL.md), [verify.py](../scripts/verify.py), and the [baseline](README.md). These source-grounded recipes are unexecuted until a run records their actions and results.

## Sub-features

- `reference-subject`: create and reopen a text-only subject without generating pixels.
- `reference-file`: upload a permitted image and classify/bind its purpose without losing the original.
- `reference-image-generation`: author an image plan, explicitly dispatch to a real worker, review and adopt a returned candidate.

## How to get to it (user POV)

- **Library:** References navigation or Overview → Prepare references → Characters and files. All tools / settings (also Ctrl+K) → Subjects & images is another entry. Film desk → 2 · Images opens the library; the Reference workspace tab Subjects & files returns to it from subject/image forms.
- **Subject creation:** the library's ＋ Create subject; or Projects (header or tool finder) → Create subject. Existing library cards have Edit subject.
- **Upload:** the library's ＋ Upload images, subject editor's ＋ Upload more images, or Projects → ＋ Add references (also accepts audio/video). These are visible upload-label entrypoints; the permanently hidden sidebar is not.
- **Classification:** an uploaded image card's Assign / classify. Subject editor's default source checkboxes bind existing files; these are distinct from classifying a room/prop/direct reference.
- **Image studio:** References → Image studio; library → Generate reference images; Reference workspace → Image studio; a subject card → Generate variants; subject editor → Save & generate images. Film desk's image action also reaches image generation. None of these entrypoints alone generates an image.

## Driving it with Playwright

Preconditions:

- A disposable baseline project. Text-only subject creation requires neither media nor provider.
- `reference-file` needs a user-permitted, real local image at `image_path`; the baseline has no downloaded reference media, so the full upload journey is **FAIL — precondition** until supplied. Do not synthesize a mock image response to claim real-media coverage.
- Image generation additionally requires a reachable authenticated worker, installed compatible image preset and weights, explicit license acknowledgement by an authorized user, GPU/download permission, and any chosen source images. No such permission exists in the baseline. A manually written prompt avoids planner dependence but not worker/GPU dependence.

- **Create a subject → identity card appears.**
  ```python
  page.locator('nav.workspace-navigation [data-workspace-area="references"]').click()
  page.locator('#workspace-home [data-ref="home"]').click()
  page.locator('#dialog [data-ref="new"]').click()
  page.locator('#subject-name').fill('Verification traveler')
  page.locator('#subject-description').fill('An adult traveler with short dark hair and a green coat.')
  page.locator('#ref-subject-use').select_option('none')
  page.locator('#dialog [data-ref="save-subject"]').click()
  card = page.locator('#dialog .ref-card').filter(has_text='Verification traveler')
  expect(card).to_have_count(1)
  expect(card).to_contain_text('0 default source(s)')
  ```
- **Reopen after reload → saved identity, not a draft.** Close the dialog, wait for `#save-status` to contain `Saved in this browser`, reload, enter References → Characters and files, and click the named card's `[data-ref="edit"]`. Assert `#subject-name` and `#subject-description` have the exact values above. The alternate Projects entry uses `#dialog [data-action="add-subject"]` and the same form/assertions.
- **Upload/classify supplied media → picture and purpose survive reopen.** In the library, `page.locator('#ref-upload').set_input_files(str(image_path))`; locate the unique `.ref-card` by its filename, `expect(card.locator('img')).to_be_visible()`, and click its `[data-ref="classify"]`. Set `#ref-purpose` to the intended option actually offered, fill `#ref-role` with a precise usage description, and click `#dialog [data-ref="classify-save"]`. Assert the card shows the selected purpose. Reopen Assign / classify after reload and assert `#ref-role` retains the value. For subject binding, instead select the real subject option in `#ref-bind`; reopen that subject and verify its source checkbox is checked and its thumbnail visible. Alternative upload inputs are `#ref-subject-upload` and Projects' `#mobile-media-upload`; each needs separate action/result evidence.
- **Write a local image plan → editable prompt, no image job.** Return to References and click `#workspace-home [data-film="images"]`, then `#dialog [data-ref="manual"]`. Run `page.locator('#ref-plan [data-card-field="prompt"]').fill('A paper boat on a quiet pond at sunrise, wide view.')` and press Tab to commit the change. Assert `expect(page.locator('#ref-plan [data-card-field="prompt"]')).to_have_value('A paper boat on a quiet pond at sunrise, wide view.')`; capture `#ref-results` and the absence of a new generated candidate. This is authoring proof only. The library/tab entry uses `#dialog [data-ref="images"]`; variants use the chosen subject card's `[data-ref="variants"]`; Save & generate uses `[data-ref="save-generate"]` after filling a valid subject.
- **Authorized complete generation → real pixels are adopted and persist.** With prerequisites satisfied, click `#dialog [data-ref="discover"]`, select the actual discovered value in `#ref-model`, review capabilities/settings and source order, and complete the human license review before checking `#ref-license`. Select exactly the intended plan card(s), then click `#dialog [data-ref="generate"]`. Read the app confirmation and approve only the reviewed workload. Capture the real job ID, terminal completion, and `#ref-results .ref-result-image`; require a decodable, nonempty image, not just a completed label. Select the intended output's `[data-ref="import-image"]` (Use this image), then `expect` that output card to contain `Saved in library`. Return to Subjects & files and verify the new image/subject binding, reload and reopen it. Unavailable outputs, failed licensing, uncertain dispatch, or no returned image fail the full journey; never substitute opening Image studio.

## Gotchas

- A subject is not a picture. A text-only card with zero sources is valid, but does not demonstrate identity conditioning.
- Default sources, variants, and per-window source overrides have different meanings. Do not attach every variant as a default or silently apply suggested windows.
- Save & generate images opens the studio; it does not itself authorize GPU work. Conversely Generate checked pictures can dispatch expensive work and must not be clicked in the baseline.
- Image upload fields are legitimately hidden inside visible labels. `set_input_files` is allowed there; force-clicking hidden navigation is not.
- Generated candidates are not automatically adopted. Saved-in-library and reload proof are necessary. Full media/provider journeys with absent prerequisites remain FAIL even if all panels open successfully.
