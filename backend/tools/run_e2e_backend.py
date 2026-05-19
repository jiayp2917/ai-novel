from __future__ import annotations

import os
import subprocess
import sys

from backend.tools.create_e2e_workspace import main as create_workspace


def main() -> int:
    create_workspace()
    env = os.environ.copy()
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True, env=env)
    return subprocess.call(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "backend.app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "18080",
        ],
        env=env,
    )


if __name__ == "__main__":
    raise SystemExit(main())
