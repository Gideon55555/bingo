# Generates client/public/voice/am/<n>.mp3 for bingo numbers 1–75 with eSpeak NG (offline, free).
#   pip install espeakng-loader     (needs ffmpeg on PATH)
#   node scripts/voice/calls.js > /tmp/calls.json && python3 scripts/voice/make-espeak.py /tmp/calls.json
# For a more natural voice use make-azure.js, or drop in real recordings with the same file names.
import json, os, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from espeak import say

calls = json.load(open(sys.argv[1]))
out_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'client', 'public', 'voice', 'am')
os.makedirs(out_dir, exist_ok=True)
tmp = tempfile.mkdtemp()
for c in calls:
    letter, number = os.path.join(tmp, 'l.wav'), os.path.join(tmp, 'n.wav')
    say(c['letterAm'], letter, speed=125, pitch=45)
    say(c['words'], number, speed=130, pitch=45)
    # letter · short pause · number, trimmed, loudness-normalised, warmed up a little, mono MP3
    subprocess.run([
        'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', letter, '-i', number,
        '-filter_complex',
        '[0]silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse[a];'
        '[1]silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse[b];'
        'anullsrc=r=22050:cl=mono,atrim=duration=0.22[gap];'
        '[a][gap][b]concat=n=3:v=0:a=1,aresample=22050,lowpass=f=7000,bass=g=3,loudnorm=I=-16:TP=-1.5:LRA=7,apad=pad_dur=0.05[out]',
        '-map', '[out]', '-ac', '1', '-ar', '22050', '-c:a', 'libmp3lame', '-b:a', '32k', os.path.join(out_dir, f"{c['n']}.mp3"),
    ], check=True)
print(f'wrote {len(calls)} clips to {os.path.normpath(out_dir)}')
