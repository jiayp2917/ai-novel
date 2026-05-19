from __future__ import annotations

import argparse
import sys

import uvicorn

from backend.tools.key_env import loaded_key_names


def main() -> int:
    parser = argparse.ArgumentParser(description="Start the FastAPI backend after loading local API keys from key.txt.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--key-file", default="key.txt")
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    names = loaded_key_names(args.key_file)
    if names:
        print("Loaded API key env vars:", ", ".join(names))
    else:
        print("No API keys loaded. Create key.txt or set env vars before model calls.", file=sys.stderr)
    uvicorn.run("backend.app.main:app", host=args.host, port=args.port, reload=args.reload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
