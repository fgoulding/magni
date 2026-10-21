"""Verify exact CI publication evidence before staging. Import has no side effects."""
import argparse
import datetime
import json
import subprocess

from config import load_config, require, valid_image
from operations import prepare_output, write_receipt

CHECKS = ["gate-policy", "dependency-audit", "route-types", "typecheck", "lint", "tests-and-coverage", "production-build", "e2e"]


def validate_publication(config, metadata, gate, published):
    require(config.get("githubRunId") is not None, "Pin the CI run before publication verification")
    revision = config["candidateRevision"]
    require(str(metadata.get("id")) == config["githubRunId"], "CI run mismatch")
    require(metadata.get("head_sha") == revision and metadata.get("conclusion") == "success", "CI did not pass for the candidate")
    attempt = metadata.get("run_attempt")
    require(type(attempt) is int and attempt > 0, "Invalid CI attempt")
    require(gate.get("status") == "passed" and gate.get("source", {}).get("commit") == revision and gate["source"].get("dirty") is False, "Release gate source/status mismatch")
    require(str(gate["source"].get("runId")) == config["githubRunId"] and str(gate["source"].get("runAttempt")) == str(attempt), "Release gate run/attempt mismatch")
    checks = gate.get("checks", [])
    require([check.get("name") for check in checks] == CHECKS, "Incomplete or reordered release checks")
    require(all(check.get("status") == "passed" and check.get("exitCode") == 0 for check in checks), "Release checks did not all pass")
    require("--fail-on-flaky-tests" in checks[-1].get("command", []), "Strict browser verification missing")
    browser = gate.get("browser", {})
    projects = browser.get("projects", {})
    require(browser.get("expected", 0) == browser.get("passed", 0) > 0 and set(projects) == {"chromium", "mobile-safari"}
            and all(type(count) is int and count > 0 for count in projects.values())
            and sum(projects.values()) == browser["expected"], "Incomplete browser release coverage")
    require(published.get("commit") == revision and str(published.get("runAttempt")) == str(attempt), "Published image attempt/source mismatch")
    require(published.get("verifiedRun") == f"https://github.com/{config['githubRepository']}/actions/runs/{config['githubRunId']}", "Published image CI identity mismatch")
    require(valid_image(published.get("pinnedImage"), config["imageRepository"]), "Published image must be immutable")
    return published["pinnedImage"]


def verify(config):
    require(config.get("githubRunId") is not None, "Pin the CI run before publication verification")
    output = prepare_output(config)
    run, repository = config["githubRunId"], config["githubRepository"]
    state = {"run": run, "commit": config["candidateRevision"], "phase": "reading-CI", "status": "running"}

    def save(**fields):
        state.update(fields, updatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
        write_receipt(config, "publication", state)

    def command(args, name):
        with (output / name).open("w") as log:
            subprocess.run(args, cwd=config["repositoryRoot"], stdout=log, stderr=subprocess.STDOUT, check=True)

    save()
    try:
        metadata = json.loads(subprocess.check_output(["gh", "api", f"repos/{repository}/actions/runs/{run}"], text=True))
        require(metadata.get("head_sha") == config["candidateRevision"] and metadata.get("conclusion") == "success", "CI must finish successfully before verifying publication")
        attempt = metadata["run_attempt"]
        require(type(attempt) is int and attempt > 0, "Invalid CI attempt")
        evidence, image = output / f"ci-{run}-{attempt}", output / f"image-{run}-{attempt}"
        save(phase="downloading-evidence", attempt=attempt)
        for name, directory, log in [(f"release-checks-{config['candidateRevision']}-{attempt}", evidence, "ci-download.log"), (f"published-image-{config['candidateRevision']}-{attempt}", image, "image-download.log")]:
            command(["gh", "run", "download", run, "--repo", repository, "--name", name, "--dir", str(directory)], log)
        gate = json.loads((evidence / ".playwright/release-checks/result.json").read_text())
        published_file = image / "published-image.json"
        published = json.loads(published_file.read_text())
        candidate = validate_publication(config, metadata, gate, published)
        save(phase="verified-publication", status="passed", pinnedImage=candidate, evidence=str(evidence), publishedImage=str(published_file))
    except Exception as error:
        save(status="failed", failedPhase=state["phase"], error=str(error))
        raise
    return state


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    import os
    os.umask(0o077)
    print(json.dumps(verify(load_config(args.config))))


if __name__ == "__main__":
    main()
