# Upgrading, backup and rollback

Upgrade the Git checkout in place (`git pull`), or check out a new revision, while the app is idle. Keep your runtime environments and H3_DATA_DIR. Note the current commit (`git rev-parse HEAD`) so you can return to it. Never upgrade dependencies or overwrite a checkout while it owns active work. Inspect native jobs, managed coordinators and AI requests first; pause future dispatch and wait for accepted work before an intentional upgrade.

Before switching source paths, make a private, consistent backup of the full data directory (SQLite databases and associated files, jobs, uploads, immutable outputs, checkpoints, service settings and credentials), plus browser-origin projects/media and any separately referenced source/output locations. Stop writers during a full snapshot; preserve file metadata where possible. Verify file hashes and perform a disposable restore, not a production overwrite. Keep secrets private. Export each browser-local project as a portable backup before moving origins. Exported MP4s alone cannot restore an edit.

On an idle source upgrade, explicitly stop the old editor and worker before starting the new source with the same reviewed data/runtime paths. Generated user services capture absolute source/interpreter paths; review and regenerate them explicitly if those paths change. Starting a second worker does not migrate or recover a queue.

Source-only rollback can check out the previous commit with the original data before incompatible new work. Full-data rollback must preserve post-upgrade changes separately. Worker outputs may freeze device/inode/mtime identities: a byte-identical filesystem copy is not necessarily a valid continuation source. Do not rewrite provenance locks to force acceptance; inspect/reimport through an owned-output workflow or obtain a reviewed provenance-aware restoration plan. Portable backups omit native worker checkpoints and output ownership context.

The offline suites cover isolated worker restart, queue pause/reconciliation, CAS conflicts, portable export/import, audit cancellation, and retained output bytes. They do not establish a full production disaster-recovery guarantee. A complete browser + worker + service-path restore has not been rehearsed.


## Fresh-path footage recovery

A file snapshot is not a portable worker-state restore. Output records retain absolute paths and device/inode/size/mtime identities. Moving or copying byte-identical files does not transfer that ownership. An unavailable old output is a protective refusal, not permission to edit its path/stat record. There is no verified in-place relink or full model-checkpoint restore command.

For footage recovery, retain a private untouched snapshot and hash manifest. Verify the preserved movie against the snapshot's recorded SHA256 before importing; a hash generated only after damage is not proof of the original bytes. Keep the old projects, jobs and IDs for inspection. Start the recovered worker only deliberately under the normal idle/start safeguards; do not replay queued or uncertain requests.

In the recovered editor, open the project whose linked window order and durations match the preserved final cumulative film. Open **Project renders** and choose **Import finished film**, or open a window's **Takes / regenerate this window** controls and choose **Import a finished full film**, select that verified movie, review the 24-fps timeline and check the confirmation box, then choose **Upload & index finished film**. This uploads a new owned copy and checks the frame count. It does not regenerate footage, change the old job/output IDs, infer original prompts/conditioning, or restore model checkpoints. If indexing loses its reply, inspect the worker's completed imported records before attempting another import.

The current full-film UI import supports linked (`sliding`) timelines. Do not change a managed/bounded or independent project into linked mode to force an import. Preserve its history and seek a separately reviewed reconstruction of its exact ranges; transparent managed checkpoint recovery remains unverified. New imported footage can be previewed/exported, but inspect joins and provenance warnings before explicitly using it as continuation. Keep source owners when transferring finished-edit history: the finished record alone may be insufficient to verify conditioning.

Verify playback in the app, download the final movie, compare its bytes/hash with the saved export, and retain the recovery record. Browser-origin storage and operating-system service paths need separate restoration. These steps recover reviewed footage, not a complete production disaster-recovery guarantee.
