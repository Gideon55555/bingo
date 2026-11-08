# Minimal eSpeak NG wrapper (ctypes) → 16-bit mono WAV
import ctypes, wave, sys, espeakng_loader
lib = ctypes.cdll.LoadLibrary(espeakng_loader.get_library_path())
SYNCH = 0x02  # AUDIO_OUTPUT_SYNCHRONOUS
rate = lib.espeak_Initialize(SYNCH, 0, espeakng_loader.get_data_path().encode(), 0)
CB = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_short), ctypes.c_int, ctypes.c_void_p)
buf = []
def cb(wav, n, ev):
    if wav and n > 0: buf.append(ctypes.string_at(wav, n * 2))
    return 0
ccb = CB(cb)
lib.espeak_SetSynthCallback(ccb)
def say(text, out, voice='am', speed=140, pitch=50):
    buf.clear()
    lib.espeak_SetVoiceByName(voice.encode())
    lib.espeak_SetParameter(1, speed, 0)   # espeakRATE
    lib.espeak_SetParameter(3, pitch, 0)   # espeakPITCH
    t = text.encode('utf-8')
    lib.espeak_Synth(t, len(t) + 1, 0, 0, 0, 0x01 | 0x10, None, None)  # espeakCHARS_UTF8 | SSML-off
    lib.espeak_Synchronize()
    with wave.open(out, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(b''.join(buf))
if __name__ == '__main__':
    say(sys.argv[1], sys.argv[2])
