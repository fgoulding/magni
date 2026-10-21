"""Run owned populated and browser staging after verified publication."""
import argparse
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys

from config import load_config, require, valid_image
from operations import prepare_output, write_receipt


def validate_publication_receipt(config, receipt, checkout_revision, dirty):
    require(config.get("githubRunId") is not None and str(receipt.get("run")) == config["githubRunId"], "Publication CI run mismatch")
    require(receipt.get("status") == "passed" and receipt.get("phase") == "verified-publication", "Publication has not been verified")
    require(receipt.get("configHash") == config["configHash"], "Publication configuration mismatch")
    require(receipt.get("commit") == config["candidateRevision"] == checkout_revision and dirty is False, "Staging requires the exact clean source checkout")
    require(valid_image(receipt.get("pinnedImage"), config["imageRepository"]), "Staging requires an immutable candidate")
    return receipt["pinnedImage"]


def stage(config, config_file):
    require(config.get("githubRunId") is not None, "Pin the CI run before staging")
    output, root = prepare_output(config), config["repositoryRoot"]
    scripts = Path(__file__).resolve().parent
    state = {"status": "running", "phase": "validating-publication"}

    def save(**fields):
        state.update(fields, updatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
        write_receipt(config, "stage-status", state)

    def run(args, name):
        with (output / name).open("w") as log:
            subprocess.run(args, cwd=root, stdout=log, stderr=subprocess.STDOUT, check=True)

    save()
    try:
        receipt = json.loads((output / "publication.json").read_text())
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
        dirty = bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=root, text=True).strip())
        candidate = validate_publication_receipt(config, receipt, revision, dirty)
        save(phase="pulling-verified-image", candidate=candidate)
        run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", config["sshHost"], "docker", "pull", candidate], "candidate-pull.log")
        save(phase="populated-rehearsal")
        run([sys.executable, str(scripts / "release.py"), "--config", config_file, "rehearse", "--candidate", candidate], "populated.log")
        save(phase="browser-staging")
        run(["node", str(scripts / "browser-staging.mjs"), "--config", config_file, "--candidate", candidate], "browser-staging.log")
        save(phase="ready-for-review", status="passed")
    except Exception as error:
        save(status="failed", failedPhase=state["phase"], error=str(error))
        raise
    return state


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    file = str(Path(args.config).resolve())
    print(json.dumps(stage(load_config(file), file)))


if __name__ == "__main__":
    main()
