# Authored window timing advisor

This candidate adds editable advisory timing beside window geometry. It does not run inference, recognize speech, silently rewrite dialogue, replace selected takes, or convert artistic cuts into continuation. Production is unchanged.

The default15-second generated-span preference is owner-reported planning capacity, adjustable per project and distinct from maxSpan/model constraints and the15-second reference-audio budget. At24fps the H3grid gives345frames14.375s or362frames15.083s; a rounded span above15s is displayed honestly as over preference/experimental. Overlap is reused context, not new committed duration. H3.schedule supplies all geometry.

Ordered timingPlan.groups sum. Members inside each group are explicitly simultaneous and take the maximum range; no overlap is inferred from prose. Include uneven actions, reactions, camera transitions, holds and pauses. A constraint member is static and costs0s. Durations are authored intended ranges, never measured speech. Missing actions retain an unknown upper bound. Dialogue uses exact assigned line ordinal, explicit intended duration or editable rough100–160WPM assumptions. Unknown language timing stays unknown. Prior dialogueTiming allocations and voice-reference length are not fit evidence. Set actionsReviewed:true only after all action/hold/camera timing has been reviewed.

Statuses: Over capacity; May be tight; Fits stated assumptions; Needs timing detail. Source stamps invalidate timing after text/order/geometry/project/selected-take/preference changes. Extension previews round upward to sufficient retained duration, disclose changed generated span and downstream offsets, and require explicit confirmation. Apply changes editable requested frames only and uses ordinary undo; jobs, media and historical ranges remain frozen. Simplify displays contributing prompt/state for manual review. Split v1 is review-only and requires distinct child action groups, intact utterances once and matching endpoint state; no automatic split.

Existing generic split now refuses populated prompts rather than cloning the complete action/dialogue to both halves. Oversized story beats likewise require explicitly authored child beats before a pacing copy; a copy never repeats an entire action for every technical chunk. Empty planning windows can still be split. This deliberate restriction prevents replay, but is not evidence these code paths made a particular historical film.

Fresh versus linked geometry is conspicuous. Later cuts using stills named W1-end etc show a name-based earlier-state review warning, not a claim of authoritative provenance. Continuous actions still require actual submitted predecessor verification; still reference identity is not audiovisual context.

Validation: scripts/check-timing.mjs; tests/browser_timing_check.py; full check-all. Browser test is an offline component fixture, never live acceptance.
