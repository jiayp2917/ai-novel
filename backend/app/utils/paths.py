from pathlib import Path


def safe_join(root: Path, relative_path: str) -> Path:
    root_resolved = root.resolve()
    path = (root_resolved / relative_path).resolve()
    if path != root_resolved and root_resolved not in path.parents:
        raise ValueError("Path escapes content root")
    return path
