"""Local-only transport for a user-provided audio model. Does not install/download models.

python scripts/local-audio-adapter.py --backend /path/to/backend.py --port 9001
The backend must expose analyze(goal, clips, reference) -> JSON-compatible dict.
Each clip contains probe, sample_rate, samples (float list), and measured metrics.
"""
import argparse
import array
import base64
import hmac
import importlib.util
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer


def decode_audio(audio):
    if audio.get("encoding") != "pcm-s16le" or audio.get("sampleRate") != 16000 or audio.get("channels") != 1:
        raise ValueError("Unsupported audio format")
    raw = base64.b64decode(audio["data"], validate=True)
    if not 0 < audio["samples"] <= 512000 or len(raw) != audio["samples"] * 2:
        raise ValueError("Invalid sample count")
    samples = array.array("h", raw)
    if sys.byteorder != "little":
        samples.byteswap()
    return [sample / 32768.0 for sample in samples]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", required=True, help="Trusted local Python model adapter file")
    parser.add_argument("--port", type=int, default=9001)
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location("synthverse_audio_backend", args.backend)
    if spec is None or spec.loader is None:
        raise RuntimeError("Cannot load backend")
    backend = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(backend)
    if not callable(getattr(backend, "analyze", None)):
        raise RuntimeError("Backend must define analyze(goal, clips, reference)")
    key = os.environ.get("AUDIO_ADAPTER_KEY", "")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, status, value):
            data = json.dumps(value, ensure_ascii=False).encode("utf8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            if self.path != "/analyze":
                return self.reply(404, {"error": "not found"})
            if key and not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + key):
                return self.reply(401, {"error": "unauthorized"})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 8000000:
                    return self.reply(413, {"error": "invalid size"})
                payload = json.loads(self.rfile.read(size))
                if payload.get("protocol") != "synthverse-audio-v1" or not 1 <= len(payload["clips"]) <= 4:
                    raise ValueError("invalid protocol")
                clips = [{"probe": clip["probe"], "sample_rate": 16000, "samples": decode_audio(clip["audio"]), "metrics": clip["metrics"]} for clip in payload["clips"]]
                reference = decode_audio(payload["reference"]["audio"]) if payload.get("reference") else None
                result = backend.analyze(payload["goal"], clips, reference)
                if len(json.dumps(result).encode("utf8")) > 48000:
                    raise ValueError("response too large")
                self.reply(200, result)
            except Exception:
                self.reply(500, {"error": "Local model analysis failed"})

    print(f"SynthVerse local audio adapter: http://127.0.0.1:{args.port}/analyze", flush=True)
    HTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
