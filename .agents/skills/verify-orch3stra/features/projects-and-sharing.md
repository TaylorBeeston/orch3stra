# Projects and sharing

Create a fresh project through visible controls, name it and save its brief, reload/reopen it locally, and publish then pull the server version. Use [SKILL.md](../SKILL.md) and [verify.py](../scripts/verify.py); the helper's `run` mode exercises this journey. The recipe itself is source-grounded, not a claim that a particular run passed.

Recorded execution: `/home/taylor/.local/state/orch3stra-verification/20261016-skill-proof-03/` passed this local create/edit/save/reopen/publish/pull journey, including the Overview route, both Film desk brief entrances, button/keyboard tool finder, actual revision-1 server-file comparison, and restoring the published values over an unsynced local name after confirmed pull and reload. See `result.json` for exact entrypoints. The optional independent second-context pull below remains unexecuted; do not include it in that PASS.

## Sub-features

- `project-create`: create an empty local project without replacing the seeded example.
- `project-edit-save`: name the project and save its brief locally.
- `project-reload-reopen`: retain both values after reload and reopening from Local projects.
- `project-publish-pull`: explicitly publish to this isolated bridge and reopen its stored version.

## How to get to it (user POV)

- **Local projects:** the visible topbar Projects button, or All tools / settings → Projects. The latter finder also opens with Ctrl+K. New project and each project's Open/Current button are inside Local projects.
- **Name:** the topbar Project name input. **Brief:** Story navigation or Overview → Develop the story exposes the director's brief. Story → Refine with the assistant (also All tools → Film desk) offers Describe your movie and Save brief as an alternate editor for the same brief.
- **Save:** edits autosave; Ctrl+S explicitly saves. **Reopen:** reload this same origin/context or use Local projects → Open/Current.
- **Sharing:** All tools / settings → Studio, or Ctrl+K → Studio → Publish / save current project. Refresh list and each server project's Open / pull are in that same Studio dialog. There is no visible topbar Studio button in this shell.

## Driving it with Playwright

Preconditions:

- The isolated baseline in [the index](README.md), a working bridge, no active media operations, and a unique name such as `Verification project`. This new project has no source media to upload. Never publish the user's project.

- **Create → an empty project appears.**
  ```python
  page.locator('.workspace-header-actions [data-action="projects"]').click()
  expect(page.locator('#dialog-title')).to_have_text('Local projects')
  page.locator('#dialog [data-action="new-project"]').click()
  expect(page.locator('#dialog')).not_to_be_visible()
  page.locator('#project-name').fill('Verification project')
  page.locator('nav.workspace-navigation [data-workspace-area="story"]').click()
  page.locator('#request').fill('A paper boat crosses a quiet pond at sunrise.')
  page.keyboard.press('Control+s')
  expect(page.locator('#save-status')).to_contain_text('Saved in this browser')
  ```
- **Reload → both values survived storage.**
  ```python
  page.reload()
  expect(page.locator('#project-name')).to_have_value('Verification project')
  expect(page.locator('#request')).to_have_value('A paper boat crosses a quiet pond at sunrise.')
  ```
  Story is the persisted workspace area; if a different area was selected before reload, enter Story before asserting the visible brief.
- **Reopen via the alternate Projects entry → same saved project.**
  ```python
  page.keyboard.press('Control+k')
  page.locator('#workspace-tool-search').fill('Projects')
  page.locator('#dialog [data-action="projects"]').click()
  row = page.locator('#dialog .project-item').filter(has_text='Verification project')
  expect(row).to_have_count(1)
  row.locator('[data-open-project]').click()
  page.locator('#dialog [data-action="close-dialog"]').click()
  expect(page.locator('#project-name')).to_have_value('Verification project')
  expect(page.locator('#request')).to_have_value('A paper boat crosses a quiet pond at sunrise.')
  ```
- **Alternate brief editor → edited value persists after returning.** Story's `#workspace-home [data-film="open"]` or the finder's `#dialog-body [data-film="open"]` opens Film desk. For each entrypoint, fill `#film-brief` with a value different from the current brief, click `#dialog [data-film="save-brief"]`, wait for `#save-status` to contain `Saved in this browser`, close with `#dialog [data-action="close-dialog"]`, reload, then assert `#request` has that exact new value. Restore the original brief through the second entrance and repeat the reload assertion. Do not infer either passed from editing `#request`.
- **Publish via the button-opened finder → server revision exists.**
  ```python
  page.locator('nav.workspace-navigation [data-workspace-tool="tools"]').click()
  page.locator('#workspace-tool-search').fill('Studio')
  page.locator('#dialog [data-studio-action="shared"]').click()
  expect(page.locator('#dialog [data-studio-action="publish"]')).to_be_visible()
  page.locator('#dialog [data-studio-action="publish"]').click()
  server_row = page.locator('#dialog .project-item').filter(has_text='Verification project')
  expect(server_row).to_have_count(1)
  expect(server_row).to_contain_text('revision 1')
  expect(server_row.locator('[data-studio-pull]')).to_be_visible()
  ```
  `revision 1` applies only to first publication of this unique fresh project. Capture the server row and the helper's read-only server evidence; a local save toast is insufficient.
- **Pull → server-backed values return.** In Studio, click `#dialog [data-studio-action="shared"]` to refresh the list. Select the unique named row's `[data-studio-pull]`; `expect(page.locator('#app-confirm-summary')).to_contain_text('Open the server version?')`, then `page.locator('#app-confirm [data-app-confirm="accept"]').click()`. Assert the main name and brief again, reload, and assert both persisted. For independent browser proof, open this same run URL in another fresh context, enter Studio via its finder and pull the same row; do not copy browser storage into it.

## Gotchas

- Local IndexedDB is origin-specific. A new port, browser context, or `file://` URL is not a local-reload persistence test; a second context must pull from Studio.
- Brief edits autosave after a debounce. Wait for `Saved in this browser`; do not race reload against typing. The film-desk editor requires Save brief.
- A server pull warns about unsynced edits. Approve only this disposable project's pull; do not treat confirmation bypass as proof.
- Use `.workspace-header-actions` and `#dialog` scoping because the original header controls are hidden duplicates.
- Publishing the seeded example can fail if it refers to absent source media. The required fresh-project journey avoids that precondition honestly, not by removing validation or faking blobs.
- Opening a local project through the tool finder returns to its parent All tools dialog rather than closing every layer. Explicitly click `#dialog [data-action="close-dialog"]` before outside navigation. Likewise inspect for a remaining dialog after pulling a shared project; close it before using the main workspace. The helper encountered this in a real run; do not force-click through an inert modal.
- Film desk has a hidden dialog-header duplicate. Scope the finder button to `#dialog-body [data-film="open"]`; `#dialog [data-film="open"]` matches two nodes and fails Playwright strict mode. This was found by executing the real recipe, not by forcing a click.
