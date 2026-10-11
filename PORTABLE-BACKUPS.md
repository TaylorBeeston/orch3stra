# Portable project backups and finished movies

A finished MP4 is the viewing artifact. A portable `.h3project` is an editable
project copy. Save both when you need the film and its editable inputs.

| Artifact | Included | Separate preservation needed |
| --- | --- | --- |
| Finished movie | The selected rendered edit; owned SRT/VTT sidecars when present | Editable project, original references and worker archives |
| Portable project backup | Project metadata; embedded original references, Post media, sound-library sources and voice-workshop media; captured job history | Worker-owned rendered clips and continuation checkpoints; installed models/dependencies and runtime state |
| Source ZIP/TAR | App source, documentation and reviewed synthetic fixtures | Projects, media, voices, credentials, dependencies and Git data |

Export → Save portable backup on studio computer writes a private backup in the
configured studio data directory. It uses the authenticated immutable blob API,
redacts credentials, verifies bytes against original metadata and records SHA-256.
It needs no browser Save dialog. References to worker outputs in captured history
are not embedded video bytes.

Version-1 JSON backups have a **64 MiB total encoded limit**, including metadata and
base64 media. Sizes are checked before reading media bodies. One backup builds per
Node process, with at most eight active/queued distinct attempts. This is an interim
bounded-size format, not a streaming long-film media backup.

Identical repeated requests reuse a verified completed artifact. Interrupted builds
are parked on the next bridge start; failed/interrupted attempts are preserved.
Saved backup status offers an explicit new attempt using the original saved snapshot,
not newer browser edits. It never silently resumes a build or deletes a partial file.
Legacy attempts without a usable saved snapshot can require saving a new backup;
keep the old record for inspection.

Import creates a new project and new media IDs. Editable bindings are remapped;
captured render history stays frozen. Existing projects and original media are not
overwritten. Missing embedded sources are marked missing. New blobs, project and
active-project metadata commit in one IndexedDB transaction; activation follows
successful commit. Unavailable IndexedDB prevents import rather than using a
non-atomic media fallback. Voice-workshop IDs and media keys move together.

Movie export and Save movie & sidecars to Videos use owned exports and collision-safe
names. Sidecars are copied only when owned by the export; the source movie and
previously saved files remain unchanged.

Fixtures cover repeated/concurrent backup requests, preflight limits, restart lookup,
interrupted recovery, exact-snapshot retry, media verification, prototype-safe keys,
restore-as-copy identity, transaction rollback and preserved captured history.
Current live/UI verification and remaining limits are recorded separately from
these source-level tests. No fixture proves GPU long-film stability or ASR quality.
