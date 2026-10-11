# Speech evidence, observed captions and bounded alternatives

Speech quality is a separate offline CPU pass over immutable selected footage. The
captured intended script and utterance IDs are comparison targets, never ASR prompts
or recognized captions. Ordinary faster-whisper small.en and small run with VAD,
observed-word timestamps, no initial script prompt and no previous-text conditioning.
Both models must already be cached. Missing weights/packages are UNAVAILABLE; this
flow never downloads, installs, changes licenses or sends media to a remote service.
Word timestamps align recognized words; forced alignment of intended text would not
prove that text was spoken. WhisperX and additional alignment models are not required.

The pass extracts each committed source range exactly once, concatenates retained PCM,
then checks that track plus two-second crops around joins. Source hashes, local source
In/Out, film-global offsets, per-window words, full-track words and boundary words
remain separate in the evidence report. Captions come only from the full retained-track
observed words. Context-crop transcripts never get concatenated into captions. Words
crossing a retained/Post boundary use midpoint ownership and are clipped once. A Post
speed change maps source time to global time; changing source/range/order invalidates
the caption stamp and blocks export until explicitly rebuilt.

A completed Post export can also be analyzed as a final mix. Its identity/hash/duration
are preserved separately; it is not assumed to match a later edited timeline. Music
can mask dialogue or introduce vocals. Mixed-source reviews abstain from automatic
repair. No source separation is claimed. Diarization runs once over the full retained
track, producing anonymous turns; speaker identities stay unconfirmed. A grouping
failure preserves transcripts and cannot trigger regeneration.

Statuses are PASS (normalized word agreement only), REVIEW, CLEAR_FAILURE or
UNAVAILABLE. Silence with no recognized words does not certify no speech. ASR word
error rate, ASR disagreement, diarization failure, short replies, clipped boundaries,
intentional repeats, uncertain speakers and song vocals cannot alone submit a job.
This first gate is deliberately uncalibrated for fully unattended semantic decisions:
CLEAR_FAILURE requires an explicit listening-confirmed retained mismatch plus
corroborating sustained observed words. Recognition-only cases stay REVIEW.

Automatic repair is off by default. The user reviews the exact candidate windows,
model/size/steps, window cap, one alternate per window and total generation-frame cap.
The durable budget cannot be reset/refunded after an attempt. One idempotent native
request is reserved before admission. Unknown acceptance is reconciled by request ID;
no blind resubmission. Cancellation persists and cancels only owned jobs. Restart
parks interrupted analysis/preparation and preserves spent budgets. Alternatives are
fresh independent shots with window-scoped references; originals stay selected.
Completed alternatives receive the same offline word gate and remain for comparison.
No failed alternate causes another attempt. Existing linked descendants, joins, Post
and caption artifacts are explicitly identified for review before take selection;
there is no silent replacement or downstream rerender.

Observed SRT/VTT files are labeled drafts. Post can attach a matching draft, then
optionally burn it into a CPU MP4 export. Burning is off until explicitly enabled.
Text goes into a server-owned SRT file, not a user-supplied FFmpeg expression/path.

