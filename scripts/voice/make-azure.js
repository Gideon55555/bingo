// Re-creates the 75 bingo call clips with Microsoft Azure's natural Amharic neural voice.
// Much more natural than the bundled eSpeak clips. Azure's free tier (500,000 characters/month)
// covers this many times over — the whole set is ~1,000 characters.
//
//   1. Create a free "Speech" resource at https://portal.azure.com → copy its key and region.
//   2. AZURE_SPEECH_KEY=xxxx AZURE_SPEECH_REGION=westeurope node scripts/voice/make-azure.js
//      (optional: VOICE=am-ET-AmehaNeural for the male voice; default am-ET-MekdesNeural, female)
//   3. npm run build   → the new clips are served at /voice/am/<n>.mp3
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_CALLS } from '../../shared/amharic-calls.js';

const key = process.env.AZURE_SPEECH_KEY;
const region = process.env.AZURE_SPEECH_REGION;
const voice = process.env.VOICE || 'am-ET-MekdesNeural';
if (!key || !region) {
  console.error('Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION (see the comment at the top of this file).');
  process.exit(1);
}
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/public/voice/am');
fs.mkdirSync(outDir, { recursive: true });

const ssml = (c) => `<speak version="1.0" xml:lang="am-ET"><voice name="${voice}">
  <prosody rate="-8%">${c.letterAm}<break time="250ms"/>${c.words}</prosody></voice></speak>`;

for (const c of ALL_CALLS) {
  const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'bingo-voice-generator',
    },
    body: ssml(c),
  });
  if (!r.ok) {
    console.error(`#${c.n} failed: ${r.status} ${await r.text()}`);
    process.exit(1);
  }
  fs.writeFileSync(path.join(outDir, `${c.n}.mp3`), Buffer.from(await r.arrayBuffer()));
  process.stdout.write(`\r${c.n}/75 ${c.text}            `);
  await new Promise((res) => setTimeout(res, 120)); // stay well under the free-tier rate limit
}
console.log(`\nDone: 75 clips with ${voice} in ${outDir}. Run "npm run build" to publish them.`);
