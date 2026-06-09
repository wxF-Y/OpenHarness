"""HF_ENDPOINT defaulting at import time."""
import importlib
import os
import subprocess
import sys


def test_hf_endpoint_defaults_to_mirror():
    """Importing main without HF_ENDPOINT preset gets hf-mirror.com."""
    env = {k: v for k, v in os.environ.items() if k != "HF_ENDPOINT"}
    result = subprocess.run(
        [sys.executable, "-c",
         "import sys; sys.path.insert(0, 'HLAgent/gateway'); "
         "import main; "
         "import os; print(os.environ.get('HF_ENDPOINT'))"],
        capture_output=True, text=True, env=env, check=True,
    )
    assert "hf-mirror.com" in result.stdout


def test_hf_endpoint_respects_preset():
    """Preset HF_ENDPOINT not overridden by setdefault."""
    env = {**os.environ, "HF_ENDPOINT": "https://huggingface.co"}
    result = subprocess.run(
        [sys.executable, "-c",
         "import sys; sys.path.insert(0, 'HLAgent/gateway'); "
         "import main; "
         "import os; print(os.environ.get('HF_ENDPOINT'))"],
        capture_output=True, text=True, env=env, check=True,
    )
    assert "huggingface.co" in result.stdout
    assert "hf-mirror" not in result.stdout
