"""The old follow-up replacement is included in the complete source add-on."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

if __name__ == "__main__":
    print("Deprecated fix script: verifying the complete Virtual Folders source add-on.")
    sys.exit(subprocess.call(["node", str(ROOT / "plugins/virtual-folders/install.mjs"), "check", "--target", str(ROOT)]))
