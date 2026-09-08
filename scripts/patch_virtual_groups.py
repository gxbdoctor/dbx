"""Compatibility entry point; use plugins/virtual-folders/install.mjs directly."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

if __name__ == "__main__":
    print("Deprecated entry point: using the atomic Virtual Folders source add-on installer.")
    sys.exit(subprocess.call(["node", str(ROOT / "plugins/virtual-folders/install.mjs"), "apply", "--target", str(ROOT)]))
