# Story and timeline

Shape a film through manual timeline edits or a reviewed planner-created development copy. These are source-grounded recipes, not executed results; follow [SKILL.md](../SKILL.md), [verify.py](../scripts/verify.py), and the [baseline](README.md) before collecting proof.

## Sub-features

- `timeline-manual`: append locally planned windows, select/name a window, and persist the edit.
- `timeline-window-settings`: inspect the selected window's timing/reference/continuity settings without dispatching work.
- `story-development`: request cast and beats from a real planner, review them, and explicitly create a development copy.

## How to get to it (user POV)

- **Manual timing:** Story navigation or Overview → Develop the story → Pacing and timeline. Story's brief also has Build timeline. The dialog offers Append windows or Replace timeline; only Append is used below.
- **Timeline:** Timeline navigation or Overview → Review and render. Its top toolbar has ＋ Window; its bottom has Add a window. Click a window clip to select it, edit Selected window title, or use Duplicate / left / right / delete in the editor. Only add/name/persistence are scoped here.
- **Window settings:** Timeline toolbar → Window settings, or All tools / settings (also Ctrl+K) → Selected window settings. The sidebar inspector itself is hidden.
- **Story proposal:** Story → Story + cast; or Story → Refine with the assistant → Film desk's 1 · Story & cast. All tools → Film desk reaches that same step. The hidden quicksteps are not extra entrypoints.

## Driving it with Playwright

Preconditions:

- An isolated disposable project with at least one window. Use a fresh project from [projects and sharing](projects-and-sharing.md) for predictable counts; retain its original name and brief.
- Manual operations need no planner, worker, or media. The complete `story-development` journey requires separately authorized planner access, a configured usable model, and permission to send the brief. These are absent from the baseline: report **FAIL — precondition**, not planner PASS based on opening its form.

- **Append a small manual plan → additional windows appear.**
  ```python
  page.locator('nav.workspace-navigation [data-workspace-area="timeline"]').click()
  before = page.locator('#timeline .window-clip[data-window]').count()
  page.locator('nav.workspace-navigation [data-workspace-area="story"]').click()
  page.locator('#workspace-home [data-action="scaffold"]').click()
  expect(page.locator('#dialog-title')).to_have_text('Build a timeline')
  page.locator('#target-seconds').fill('12')
  page.locator('#window-seconds').fill('6')
  page.locator('#scaffold-overlap').select_option('0')
  page.locator('#dialog [data-action="scaffold-append"]').click()
  page.locator('nav.workspace-navigation [data-workspace-area="timeline"]').click()
  assert page.locator('#timeline .window-clip[data-window]').count() > before
  ```
  Record the actual rounded duration and resulting count; do not assume target seconds equal frame-grid output. Exercise `.brief [data-action="scaffold"]` separately for the Build timeline entry.
- **Add/name/reload → exact window persists.**
  ```python
  before = page.locator('#timeline .window-clip[data-window]').count()
  page.locator('.timeline-toolbar [data-action="add-window"]').click()
  expect(page.locator('#timeline .window-clip[data-window]')).to_have_count(before + 1)
  page.locator('#window-title').fill('Verification final beat')
  page.keyboard.press('Control+s')
  expect(page.locator('#save-status')).to_contain_text('Saved in this browser')
  page.reload()
  clip = page.locator('#timeline .window-clip[data-window]').filter(has_text='Verification final beat')
  expect(clip).to_have_count(1)
  clip.click()
  expect(page.locator('#window-title')).to_have_value('Verification final beat')
  ```
  The alternate add entry is `.timeline-bottom [data-action="add-window"]`; run the same count assertion for it rather than inferring equivalence from one button.
- **Open selected settings → the selected title is shown.** Click `.timeline-toolbar [data-workspace-tool="window-details"]`; `expect(page.locator('#dialog-title')).to_have_text('Window settings · Verification final beat')`. Close, open the finder using Ctrl+K, fill `#workspace-tool-search` with `Selected window settings`, click `#dialog [data-workspace-tool="window-details"]`, and assert the same heading. This is settings navigation proof, not a continuity/media check.
- **Inspect story proposal form safely → brief is visible, no request submitted.** Close the modal; enter Story and click `#workspace-home [data-film="outline"]`. Assert `#outline-brief` has the saved brief and `#dialog [data-film="outline-send"]` is visible. Capture the form. Do not click Propose cast & timeline in the baseline.
- **Authorized full planner journey → reviewed development copy survives reload.** Configure the real provider/model through Settings (not internal state); open the proposal form, fill `#outline-brief` and `#outline-extra`, then click `#dialog [data-film="outline-send"]` only under explicit dispatch authorization. Wait for `expect(page.locator('#outline-result [data-film="outline-apply"]')).to_be_visible(timeout=180000)` and inspect the returned questions, `[data-outline-name]`, `[data-outline-description]`, and `[data-outline-seconds]` fields. Resolve questions through another reviewed request if necessary. Record the actual response/proposal before clicking `#dialog [data-film="outline-apply"]`. Expect Film desk, close it, verify the new development project's name, subjects and timeline against the approved values, save/reload, then reopen Projects to prove both original and development copy exist. A provider error, malformed response, or absent beats fails the journey; never insert a fake proposal.

## Gotchas

- Manual scaffolding creates editable blank plans, not generated screenplay or video. A new window may need cast and prompt review before generation.
- Replace timeline removes live old window IDs after explicit confirmation; it is not used by the non-destructive append recipe.
- Selecting a clip after reload matters: selected-window persistence is not assumed. Read its title through the visible editor.
- Planner proposals are guarded against a changed source project. Do not edit the source during the request then force-apply stale output.
- Window settings can be opened without real references; that does not prove reference conditioning or audiovisual continuity.
