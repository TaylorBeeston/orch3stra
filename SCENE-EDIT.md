# Scene editing and compact timeline — 2.2.0

This release reconstructs the previously undelivered 2.1 feature work on the available
2.0.1 source. It does not claim byte-for-byte recovery of the missing 2.1 archive.

## Scenes

The timeline toolbar offers a scene selector, **Scene dialogue**, **Render scene…**,
**Go to scene**, and **Scene board**. Rendering opens the normal reviewed selection
workflow: opening a scene does not submit work. Existing scene IDs and membership are
used; windows outside a defined scene have an explicitly ungrouped view. Editing and
rendering use current project state; old sequence snapshots are unchanged.

## Dialogue

**Scene dialogue** presents all existing tagged lines with registered speaker, editable
words, planned delivery duration and preceding pause. Word-only editing is the default.
Check **Reflow windows** to request new timing, then **Preview window changes**.
Review and Apply is one undoable operation. It does not change speech already baked
into generated videos and starts no rendering. Rerender the affected windows to hear
the new script. Existing media, render snapshots, and Post edits remain intact.

Reflow supports single-shot windows without simultaneous/unison dialogue. It preserves
whole utterances and sequence order, respects window duration and two-speaker budgets,
and splits/grows/shrinks the affected window as needed. Requested times appear as
approximate H3 directions, not guaranteed sample-accurate speech alignment. It does not
force an overlong single utterance across tasks: shorten it or create explicit separate
lines. Multi-shot or simultaneous timing requires manual editing rather than automatic
reflow. New rows are added through the existing composer, not this first scene editor.

Unchecking a line removes its tagged utterance while retaining surrounding directions.
A separate explicit checklist can remove an entire window, including its action. No
empty window is silently deleted. The editor does not automatically merge neighboring
windows. Action continuity, pauses, and changed lip movement still need review. Old
Post cuts keep their original source snapshot and do not silently adopt new scene timing.

## Timeline and takes

- Compact picture/render tracks by default, with optional **Cast in scene** or
  **All references**. The timeline scroll region has bounded height.
- **Ctrl + wheel** zooms around the pointer; **middle-button drag** pans horizontally
  and vertically inside the timeline. Normal left dragging retains its existing role.
- Mobile composer tools expose Takes, previous/next, Duplicate, Split, and remove.
- Without an explicit selected take or trim, playback and export choose the newest
  usable saved take by creation time (array order breaks ties). Failed/unavailable
  footage is not selected. A complete saved range from a running cumulative render is
  eligible once archived.
- Deliberate take selection and trims stay pinned. Choose **Automatic · newest
  successful take** to release that choice. Switching a trimmed clip back to automatic
  asks before removing its take-specific trim; old files remain.

Reflow and take selection are deterministic editor operations, not model inference.
