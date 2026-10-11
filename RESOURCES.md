# Reference-media directory

Research date: 2026-09-11. These are discovery leads, not media bundled with the app. Free access is not the same as permission to reuse. Open the original item and check its rights/attribution notes. Keep source URL, author, and relevant license in your notes. For real-person experiments, do not pass generated speech off as an authentic recording.

| Source | Useful for | Important qualification |
|---|---|---|
| [Wikimedia Commons](https://commons.wikimedia.org/) | Portraits of public figures, historical photographs, some audio/video. | Check each file's license and required attribution. See [reusing content](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia). A free image license does not certify all possible uses of the depicted person's identity. |
| [Openverse](https://openverse.org/) | Search openly licensed/public-domain images and audio across collections. | Follow the result to its original host and verify the listed license. It is not a guarantee of a particular character voice or a video-download service. [Official API overview](https://docs.openverse.org/api/reference/made_with_ov.html). |
| [Internet Archive](https://archive.org/) | Older interviews, films, radio, public recordings, and historical media collections. | Item availability and rights vary; not everything on the site is public domain. [Official help](https://help.archive.org/). Use the item-provided download when permitted. |
| [Library of Congress: Free to Use and Reuse](https://www.loc.gov/free-to-use/) | Curated historical images, posters, portraits, and film collections. | Especially useful for historical settings/people rather than game characters. Check the collection/item rights statement and source notes. |

Prefer recordings you own or are licensed to reuse. Audition a short normal-speaking clip, remove other speakers, and retain its source and license notes. The workshop accepts permitted local files directly. Only single public YouTube URLs are imported by URL in this build.

## Tools behind the workshop

- [yt-dlp](https://github.com/yt-dlp/yt-dlp): single-video source acquisition; current YouTube support can require a JavaScript runtime. Review the separately installed tool and JavaScript runtime requirements before use. No cookies/login/DRM bypass is implemented.
- [FFmpeg](https://ffmpeg.org/): local extraction/downmixing. Director leaves your original files unchanged.
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper): local transcription with word timing. Model weights are downloaded separately with explicit consent.
- [pyannote Community-1](https://huggingface.co/pyannote/speaker-diarization-community-1): optional anonymous speaker grouping; model conditions/account token required. It does not tell you which group is a named character or isolate simultaneously mixed voices.
