# Reviewed soundtrack placement

YuE2's current app route creates vocal songs from lyrics. The installed WanGP source also describes a separate instrumental composition mode requiring an adapter that downloads on first use. That mode is not dispatched or offered by this app. No adapter is downloaded automatically. Instrumental-only intent is refused with guidance to import a permitted recording.

Audition a completed recording, then choose explicit film In/Out and recording In. The review shows measured source duration, the chosen range, cue coverage and any exact remaining gap. Trim requires enough source; shorter coverage leaves the disclosed gap; explicit loop repeats the recording, including vocals. Acceptance places one cue per owned output identity with 0.5 second end fades, independent of the playhead. Retrying import of the same output does not generate again or duplicate an existing imported recording/cue. Existing Add at playhead remains available for ordinary manual imports.

Mark a range in a picture clip and choose Keep dialogue clear, or explicitly confirm reviewed observed caption timings. Added music is reduced by 12 dB over merged ranges, with a 0.25 second attack and 0.5 second release. Preview and export use the same piecewise envelope. The feature does not alter original-audio gain, mute state, source ranges or audio filters. Existing master controls and the export peak limiter still affect the final mix. It does not isolate speakers or establish ASR certainty. Changing picture ranges invalidates dialogue timing; review or explicitly clear it before export.

The legacy Original audio under cue control remains under Advanced and reduces the entire original soundtrack, including dialogue and ambience. Existing projects retain their saved values.

Generated recording provenance, job/output identity and captured generation settings survive Post/export snapshot validation. License review and output clearance remain separately unknown unless reviewed; this feature does not grant rights, select a license or accept terms.

Validation: `node scripts/check-soundtrack-placement.mjs` and `node scripts/check-post.mjs` use synthetic data/tones only. Full local checks include the placement test. Live browser QA, GPU generation and subjective audio quality need separate evidence.
