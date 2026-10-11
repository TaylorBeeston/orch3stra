# Selected take continuity

Selecting an alternate starts no renderer or provider work. The edit layer compares
captured conditioning sources with current selected footage and retained tails.
Linked descendants require explicit review or regeneration when their context changes;
captured zero-overlap hard cuts stop propagation. Original jobs, outputs and Post
cuts remain immutable. Unknown legacy external/finished provenance requires review.

Review proceeds from the first affected descendant. Each acknowledgement is bound
to its selected take/range and compact recursive ancestor fingerprints. A later
ancestor substitution invalidates those acknowledgements again. Fingerprints are
change detection, not authentication. Shared per-layout memoization and fixed-size
fingerprints avoid exponential history growth.

New suffix branches capture the actual contributed tail lengths and selected source
identities. Removing unused leading footage is safe; removing any required tail is
not. Split clips keep separate editable identities and review records.

The selected-cut export refuses stale dependencies. Post and observed subtitle
analyses stay historical after a selected edit change. Rebuild Post explicitly and
analyze the matching retained audio before new final/caption export. Existing saved
movies and sidecars remain available as historical artifacts.

Verification: scripts/check-take-dependencies.mjs, updated render-selection and
speech-quality-server fixtures, and real-browser synthetic selection/restoration/
review/export tests. Synthetic footage does not establish audiovisual continuity,
ASR quality or GPU long-film stability.
