# Bingo caller voice

`am/<n>.mp3` is what plays when number `n` (1–75) is called — the letter, then the number in Amharic
(e.g. `54.mp3` = "ጂ ሃምሳ አራት"). The exact text for every number is in `shared/amharic-calls.js`.

The bundled clips were generated offline with eSpeak NG (`scripts/voice/make-espeak.py`). To change the voice:

- **Natural AI voice (recommended):** `scripts/voice/make-azure.js` — Azure's Amharic neural voices, free tier is enough.
- **A real caller:** record 75 short clips (MP3, mono), name them `1.mp3` … `75.mp3`, put them here.

Then run `npm run build`.
