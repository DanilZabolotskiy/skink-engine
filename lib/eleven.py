"""ElevenLabs: TTS, sound effects, music. The key is ELEVENLABS_API_KEY in .env or the environment (never print it).

    from lib import eleven
    eleven.subscription()                      # plan and remaining characters
    eleven.add_voice(voice_id)                 # a library voice → into the account (same id)
    eleven.tts(voice_id, text, out_mp3, settings={...}, language="en",  # default model — TTS_MODEL
               dictionaries=eleven.pronunciation("…/pronunciation.json"))
    eleven.stt(mp3, language="en")             # speech recognition: words with timings
    eleven.sfx("low boom", out_mp3, seconds=1.5)
    eleven.music("dark ambient drone", out_mp3, ms=30000)   # or plan={…} — a composition_plan with sections
"""
import json
import time
import urllib.error
import urllib.request

from .env import env

API = "https://api.elevenlabs.io"
TTS_MODEL = "eleven_v4"      # [..] tags in the text; no SSML; 10 000 characters per request
# voice settings the model does not have (GET /v1/models: can_use_style, can_use_speaker_boost; v4 has no speed either)
NO_SETTINGS = {"eleven_v4": {"style", "use_speaker_boost", "speed"}, "eleven_v4_turbo": {"style", "use_speaker_boost", "speed"},
               "eleven_v3": {"style", "use_speaker_boost", "speed"}}


def _req(method, path, body=None, accept="application/json", timeout=300, retries=4):
    headers = {"xi-api-key": env("ELEVENLABS_API_KEY"), "Accept": accept}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    for attempt in range(retries):
        req = urllib.request.Request(API + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                return raw if accept != "application/json" else json.loads(raw)
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="replace")[:600]
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(3 * (attempt + 1))
                continue
            raise RuntimeError(f"ElevenLabs {e.code} {path}: {msg}") from None
        except urllib.error.URLError:
            if attempt < retries - 1:
                time.sleep(3 * (attempt + 1))
                continue
            raise


def subscription():
    return _req("GET", "/v1/user/subscription")


def models():
    return _req("GET", "/v1/models")


def voice(voice_id):
    return _req("GET", f"/v1/voices/{voice_id}")


def add_voice(voice_id):
    """A library voice (shared voices) → into the account under the same id; an already added one is left alone."""
    import urllib.parse
    try:
        return voice(voice_id)
    except RuntimeError:
        pass
    v = next(v for v in _req("GET", "/v1/shared-voices?" + urllib.parse.urlencode({"search": voice_id}))["voices"]
             if v["voice_id"] == voice_id)
    _req("POST", f"/v1/voices/add/{v['public_owner_id']}/{voice_id}", {"new_name": v["name"]})
    return voice(voice_id)


def pronunciation(path):
    """Pronunciation dictionary of a channel (JSON: rules — phoneme / alias rules of the ElevenLabs API) → locators for tts.
    The dictionary is created in ElevenLabs on the first call and again when the rules in the file change; the id, the version and
    the hash of the rules are written into the same file (the elevenlabs field)."""
    import hashlib
    d = json.load(open(path))
    sha = hashlib.sha1(json.dumps(d["rules"], sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]
    el = d.get("elevenlabs") or {}
    if el.get("sha") != sha:
        r = _req("POST", "/v1/pronunciation-dictionaries/add-from-rules",
                 {"name": f"skink-{sha}", "rules": d["rules"],
                  "description": path.replace("\\", "/").rsplit("/", 3)[-3]})      # Windows: a path with backslashes
        d["elevenlabs"] = {"id": r["id"], "version_id": r["version_id"], "sha": sha}
        with open(path, "w") as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
            f.write("\n")
        el = d["elevenlabs"]
    return [{"pronunciation_dictionary_id": el["id"], "version_id": el["version_id"]}]


def tts(voice_id, text, out, model=TTS_MODEL, settings=None, language=None, fmt="mp3_44100_128", seed=None,
        dictionaries=None):
    """TTS of text with voice voice_id → mp3. language — ISO 639-1 (en): the speech and text normalisation language;
    dictionaries — pronunciation dictionary locators (pronunciation()). Settings the model does not have are not sent."""
    body = {"text": text, "model_id": model}
    if settings:
        body["voice_settings"] = {k: v for k, v in settings.items() if k not in NO_SETTINGS.get(model, ())}
    if language:
        body["language_code"] = language
    if seed is not None:
        body["seed"] = seed
    if dictionaries:
        body["pronunciation_dictionary_locators"] = dictionaries
    audio = _req("POST", f"/v1/text-to-speech/{voice_id}?output_format={fmt}", body, accept="audio/mpeg")
    with open(out, "wb") as f:
        f.write(audio)
    return out


def tts_timed(voice_id, text, out, model=TTS_MODEL, settings=None, language=None, fmt="mp3_44100_128", seed=None):
    """Like tts, but via /with-timestamps: mp3 → out, returns the alignment — {characters, character_start_times_seconds,
    character_end_times_seconds} (normalized_alignment if there is no plain one). Tag text is in the alignment, but has no sound."""
    import base64
    body = {"text": text, "model_id": model}
    if settings:
        body["voice_settings"] = {k: v for k, v in settings.items() if k not in NO_SETTINGS.get(model, ())}
    if language:
        body["language_code"] = language
    if seed is not None:
        body["seed"] = seed
    r = _req("POST", f"/v1/text-to-speech/{voice_id}/with-timestamps?output_format={fmt}", body)
    with open(out, "wb") as f:
        f.write(base64.b64decode(r["audio_base64"]))
    return r.get("alignment") or r.get("normalized_alignment")


def sfx(prompt, out, seconds=None, influence=0.4, loop=False, fmt="mp3_44100_128"):
    body = {"text": prompt, "prompt_influence": influence}
    if seconds:
        body["duration_seconds"] = seconds
    if loop:
        body["loop"] = True
    audio = _req("POST", f"/v1/sound-generation?output_format={fmt}", body, accept="audio/mpeg")
    with open(out, "wb") as f:
        f.write(audio)
    return out


def music(prompt, out, ms=30000, instrumental=True, fmt="mp3_44100_128", plan=None):
    """plan — a composition_plan instead of a prompt (styles and sections with durations; without lines — instrumental)."""
    if plan:
        body = {"composition_plan": plan, "model_id": "music_v1"}
    else:
        body = {"prompt": prompt, "music_length_ms": ms}
    if instrumental and not plan:
        body["force_instrumental"] = True
    audio = _req("POST", f"/v1/music?output_format={fmt}", body, accept="audio/mpeg", timeout=600)
    with open(out, "wb") as f:
        f.write(audio)
    return out


def stt(path, model="scribe_v1", language=None):
    """Speech recognition (TTS check): text and words with timings; language — ISO 639-1, None — auto-detect.
    words has words (type word), spaces and sounds (type audio_event: a sigh, a laugh)."""
    import mimetypes
    import uuid
    bnd = uuid.uuid4().hex
    parts = []
    fields = [("model_id", model), ("timestamps_granularity", "word")] + ([("language_code", language)] if language else [])
    for k, v in fields:
        parts.append(f"--{bnd}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
    parts.append(f"--{bnd}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a\"\r\n"
                 f"Content-Type: {ctype}\r\n\r\n".encode() + open(path, "rb").read() + b"\r\n")
    parts.append(f"--{bnd}--\r\n".encode())
    req = urllib.request.Request(API + "/v1/speech-to-text", data=b"".join(parts), method="POST",
                                 headers={"xi-api-key": env("ELEVENLABS_API_KEY"),
                                          "Content-Type": f"multipart/form-data; boundary={bnd}"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read())
