"""Guarded same-schema release coordinator. Importing performs no I/O.

Schema-changing releases require their own reviewed preservation/refusal policy;
this tool deliberately permits only exact preservation of the configured schema.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import time
import uuid

from config import load_config, require, valid_image
from operations import Operations, read_json, write_receipt
from preservation import FINGERPRINT_JS, checked_fingerprint, exact_preserved

GATES = ["gate-policy", "dependency-audit", "route-types", "typecheck", "lint", "tests-and-coverage", "production-build", "e2e"]
CHECKS = {"candidate startup", "candidate restart", "backup preserved", "baseline rollback after backup restore", "candidate after rollback"}


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def validate_evidence(config, candidate, publication, gate, published, populated, browser):
    """Pure preflight shared by promotion and offline negative tests."""
    revision, schema = config["candidateRevision"], config["schemaRevision"]
    require(isinstance(config["githubRunId"], str), "Promotion requires a pinned GitHub run ID")
    require(valid_image(candidate, config["imageRepository"]), "Candidate must be an immutable configured image")
    require(publication["configHash"] == config["configHash"] and publication["commit"] == revision and publication["pinnedImage"] == candidate
            and publication["status"] == "passed" and publication["phase"] == "verified-publication", "Publication not verified for this configuration")
    require(str(publication["run"]) == config["githubRunId"] and type(publication["attempt"]) is int and publication["attempt"] > 0, "Publication CI identity differs")
    source = gate["source"]
    require(gate["status"] == "passed" and source["commit"] == revision and source["dirty"] is False, "CI checkout not clean/passed")
    require(str(source["runId"]) == config["githubRunId"] and str(source["runAttempt"]) == str(publication["attempt"]), "CI run/attempt differs")
    require([check["name"] for check in gate["checks"]] == GATES
            and all(check["status"] == "passed" and check["exitCode"] == 0 for check in gate["checks"]), "Not every fixed CI gate passed")
    require("--fail-on-flaky-tests" in gate["checks"][-1]["command"], "CI flake gate missing")
    ci_browser = gate["browser"]
    require(ci_browser["expected"] == ci_browser["passed"] > 0 and set(ci_browser["projects"]) == {"chromium", "mobile-safari"}
            and all(count > 0 for count in ci_browser["projects"].values())
            and sum(ci_browser["projects"].values()) == ci_browser["expected"], "CI browser coverage incomplete")
    require(published["commit"] == revision and published["pinnedImage"] == candidate
            and str(published["runAttempt"]) == str(publication["attempt"])
            and published["verifiedRun"] == "https://github.com/" + config["githubRepository"] + "/actions/runs/" + config["githubRunId"], "Published image artifact differs")
    require(populated["baseline"] == config["baselineRevision"] and populated["baselineImage"] == config["baselineImage"]
            and populated["baselineImageId"] == config["baselineImageId"] and populated["schemaRevision"] == schema, "Populated baseline/schema differs")
    original = checked_fingerprint(populated["sourceFingerprint"], schema)
    require(len(original["tables"]) == config["expectedTableCount"], "Populated source table count differs")
    checks = populated["checks"]
    require(len(checks) == len(CHECKS) and {check["label"] for check in checks} == CHECKS
            and all(check["schema"] == schema and check["integrity"] == "ok" and check["allTablesUnchanged"] == len(original["tables"]) for check in checks), "Populated checks incomplete")
    for receipt in (populated, browser):
        require(receipt["configHash"] == config["configHash"] and receipt["status"] == "passed" and receipt["revision"] == revision
                and receipt["candidate"] == candidate and receipt.get("releaseEvidence") is True, "Staging receipt differs")
        require(receipt["ownedStagingResourcesRemoved"] is True and not receipt["cleanupErrors"], "Staging cleanup pending")
    require(browser["dockerHost"] == "ssh://" + config["sshHost"] and set(browser["projects"]) == {"chromium", "mobile-safari"}, "Both target-host browser engines required")
    require(browser["browserCases"] == browser["expectedBrowserCases"] > 0 and browser["browserRetries"] == 0, "Incomplete browser checks")
    require(browser["imageId"] == populated["imageId"] and re.fullmatch(r"sha256:[a-f0-9]{64}", browser["imageId"]), "Staging image differs")
    hashes = browser["sourceTests"]
    require(set(config["browserFiles"] + config["browserHelpers"]).issubset(hashes)
            and all(re.fullmatch(r"[a-f0-9]{64}", value) for value in hashes.values()), "Missing committed browser source hashes")
    return browser["imageId"]


class Release:
    def __init__(self, config, operations=None):
        self.config = config
        self.ops = operations or Operations(config)
        self.output = Path(config["outputDirectory"])
        self.root = Path(config["repositoryRoot"])
        self.revision = config["candidateRevision"]
        self.schema = config["schemaRevision"]

    def save(self, name, value):
        write_receipt(self.config, name, value)

    def read(self, name):
        value = read_json(self.output / (name + ".json"))
        require(value["configHash"] == self.config["configHash"], "Receipt configuration differs")
        return value

    def paused(self):
        state = self.read("pause")
        require(state["status"] == "paused" and state["wasRunning"] is True
                and state["baseline"] == self.config["baselineRevision"] and state["baselineImage"] == self.config["baselineImage"], "No owned updater pause for baseline")
        updater = self.ops.inspect(self.ops.WATCHTOWER)
        require(updater["Id"] == state["updaterId"] and updater["Image"] == state["updaterImageId"] and updater["State"]["Running"] is False, "Updater pause ownership changed")
        return state

    def pause(self):
        baseline, image_id = self.config["baselineRevision"], self.config["baselineImageId"]
        require(self.ops.image_id(self.config["baselineImage"], baseline) == image_id, "Baseline image identity differs")
        self.ops.healthy(image_id, baseline)
        updater = self.ops.inspect(self.ops.WATCHTOWER)
        require(updater["State"]["Running"] is True, "Updater already stopped; inspect ownership before continuing")
        state = {"status": "pausing", "startedAt": stamp(), "baseline": baseline, "baselineImage": self.config["baselineImage"],
                 "appMount": self.ops.data_mount(self.ops.inspect(self.ops.APP)), "updaterId": updater["Id"], "updaterImageId": updater["Image"], "wasRunning": True}
        self.save("pause", state)
        self.ops.remote(["docker", "stop", "--time", "20", self.ops.WATCHTOWER])
        self.ops.watchtower_stopped()
        state["status"] = "paused"
        self.save("pause", state)
        self.save("baseline-backup", self.ops.online_backup("baseline", image_id, baseline, self.schema))

    def rehearsal(self, candidate):
        require(isinstance(self.config["githubRunId"], str), "Rehearsal requires a pinned GitHub run ID")
        require(valid_image(candidate, self.config["imageRepository"]), "Candidate must be an immutable configured image")
        self.paused()
        self.ops.live_identity(self.config["baselineImageId"])
        image_id = self.ops.image_id(candidate, self.revision)
        require(self.ops.image_id(self.config["baselineImage"], self.config["baselineRevision"]) == self.config["baselineImageId"], "Baseline image differs")
        backup = self.read("baseline-backup")
        require(backup["status"] == "passed" and backup["revision"] == self.config["baselineRevision"] and backup["imageId"] == self.config["baselineImageId"], "Baseline backup identity differs")
        source = checked_fingerprint(backup["fingerprint"], self.schema)
        require(len(source["tables"]) == self.config["expectedTableCount"], "Unexpected baseline table count")
        prefix = self.config["deployDirectory"] + "/backups/" + self.config["resourcePrefix"] + "-baseline-"
        require(backup["remoteDirectory"].startswith(prefix), "Backup outside owned remote prefix")
        require(self.ops.remote(["sha256sum", backup["remoteDirectory"] + "/workouts.sqlite"]).split()[0] == backup["sha256"], "Baseline backup checksum changed")
        owner = uuid.uuid4().hex
        app = self.config["resourcePrefix"] + "-populated-" + owner
        volume = app + "-data"
        created = False
        volume_created = False
        result = {"status": "running", "startedAt": stamp(), "revision": self.revision, "candidate": candidate, "imageId": image_id,
                  "baseline": self.config["baselineRevision"], "baselineImage": self.config["baselineImage"], "baselineImageId": self.config["baselineImageId"],
                  "schemaRevision": self.schema, "checks": [], "cleanupErrors": [], "owner": owner, "container": app, "volume": volume,
                  "sourceBackup": backup["localDirectory"], "sourceFingerprint": source, "releaseEvidence": True}
        self.save("populated", result)

        def owned():
            info = self.ops.inspect(app)
            require(info["Config"]["Labels"].get(self.ops.OWNER_LABEL) == owner, "Staging app ownership mismatch")
            return info

        def owned_volume():
            info = json.loads(self.ops.remote(["docker", "volume", "inspect", "--format", "{{json .}}", volume]))
            require(info["Labels"].get(self.ops.OWNER_LABEL) == owner, "Staging volume ownership mismatch")

        def check(label):
            owned()
            observed = checked_fingerprint(json.loads(self.ops.remote(["docker", "exec", app, "node", "-e", FINGERPRINT_JS, "/data/workouts.db"])), self.schema)
            exact_preserved(observed, source, self.schema)
            result["checks"].append({"label": label, "schema": self.schema, "allTablesUnchanged": len(source["tables"]), "integrity": "ok"})
            self.save("populated", result)

        def ready(expected):
            for _ in range(45):
                require(owned()["State"]["Running"] is True, "Staged image stopped before readiness")
                try:
                    response = json.loads(self.ops.remote(["docker", "exec", app, "node", "-e", self.ops.HEALTH_JS], timeout=15))
                    if response == {"status": 200, "body": {"status": "ok", "revision": expected}}:
                        return
                except (subprocess.SubprocessError, json.JSONDecodeError):
                    pass
                time.sleep(1)
            raise RuntimeError("Staged image never became healthy")

        def create(image):
            nonlocal created
            owned_volume()
            self.ops.remote(["docker", "create", "--name", app, "--label", self.ops.OWNER_LABEL + "=" + owner,
                             "--label", "com.centurylinklabs.watchtower.enable=false", "--network", "none",
                             "--mount", "type=volume,src=" + volume + ",dst=/data", image])
            created = True
            self.ops.remote(["docker", "start", app])

        def stop_remove():
            nonlocal created
            if owned()["State"]["Running"]:
                self.ops.remote(["docker", "stop", app])
            require(owned()["State"]["Running"] is False, "Staging writer did not stop")
            self.ops.remote(["docker", "rm", app])
            created = False

        def helper(code, mount_backup=False):
            owned_volume()
            self.ops.no_volume_writers(volume)
            args = ["docker", "run", "--rm", "--label", self.ops.OWNER_LABEL + "=" + owner,
                    "--label", "com.centurylinklabs.watchtower.enable=false", "--network", "none", "--user", "root",
                    "--mount", "type=volume,src=" + volume + ",dst=/data"]
            if mount_backup:
                args += ["--mount", "type=bind,src=" + backup["remoteDirectory"] + ",dst=/backup,readonly"]
            self.ops.remote(args + [candidate, "node", "-e", code])

        try:
            self.ops.remote(["docker", "volume", "create", "--label", self.ops.OWNER_LABEL + "=" + owner, volume])
            volume_created = True
            helper("const fs=require('fs');fs.copyFileSync('/backup/workouts.sqlite','/data/workouts.db');fs.chownSync('/data/workouts.db',1000,1000);fs.chmodSync('/data/workouts.db',0o600)", True)
            create(candidate); ready(self.revision); check("candidate startup")
            owned(); self.ops.remote(["docker", "restart", app]); ready(self.revision); check("candidate restart")
            receipt = json.loads(self.ops.remote(["docker", "exec", app, "node", "--input-type=module", "-e", self.ops.BACKUP_JS, "/data/rehearsal-backup.sqlite"]))
            require(receipt["applicationRevision"] == self.revision, "Staged backup revision differs")
            backed = checked_fingerprint(json.loads(self.ops.remote(["docker", "exec", app, "node", "-e", FINGERPRINT_JS, "/data/rehearsal-backup.sqlite"])), self.schema)
            exact_preserved(backed, source, self.schema); check("backup preserved")
            stop_remove()
            helper("const fs=require('fs');for(const suffix of ['-wal','-shm']){try{fs.unlinkSync('/data/workouts.db'+suffix)}catch(e){if(e.code!=='ENOENT')throw e}}fs.copyFileSync('/data/rehearsal-backup.sqlite','/data/workouts.db');fs.chownSync('/data/workouts.db',1000,1000);fs.chmodSync('/data/workouts.db',0o600)")
            create(self.config["baselineImage"]); ready(self.config["baselineRevision"]); check("baseline rollback after backup restore")
            stop_remove()
            create(candidate); ready(self.revision); check("candidate after rollback")
            result["status"] = "passed"
        except BaseException as error:
            result.update(status="failed", error=str(error))
            raise
        finally:
            if created:
                try:
                    stop_remove()
                except Exception as error:
                    result["cleanupErrors"].append(str(error))
            if volume_created and not created:
                try:
                    owned_volume()
                    self.ops.remote(["docker", "volume", "rm", volume])
                    volume_created = False
                except Exception as error:
                    result["cleanupErrors"].append(str(error))
            result.update(ownedStagingResourcesRemoved=not created and not volume_created, finishedAt=stamp())
            if result["cleanupErrors"]:
                result["status"] = "failed"
            self.save("populated", result)
        require(result["status"] == "passed" and result["ownedStagingResourcesRemoved"], "Rehearsal or cleanup failed")

    def promote(self, candidate, browser_file):
        require(isinstance(self.config["githubRunId"], str), "Promotion requires a pinned GitHub run ID")
        self.save("promotion", {"status": "preflight", "candidate": candidate, "revision": self.revision, "startedAt": stamp()})
        pause = self.paused()
        self.ops.healthy(self.config["baselineImageId"], self.config["baselineRevision"])
        publication, populated, browser = self.read("publication"), self.read("populated"), read_json(browser_file)
        gate = read_json(Path(publication["evidence"]) / ".playwright/release-checks/result.json")
        published = read_json(publication["publishedImage"])
        target_id = validate_evidence(self.config, candidate, publication, gate, published, populated, browser)
        require(self.ops.image_id(candidate, self.revision) == target_id, "Candidate image changed")
        require(subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=self.root, text=True).strip() == self.revision, "Checkout differs")
        require(not subprocess.check_output(["git", "status", "--porcelain"], cwd=self.root, text=True).strip(), "Checkout is dirty")
        for name, expected in browser["sourceTests"].items():
            relative = name if name.startswith("examples/programs/") else "tests/e2e/" + name
            require(".." not in Path(relative).parts and not Path(relative).is_absolute(), "Unsafe source receipt path")
            content = subprocess.check_output(["git", "show", "HEAD:" + relative], cwd=self.root)
            require(hashlib.sha256(content).hexdigest() == expected, "Browser source receipt changed")
        fresh = self.ops.online_backup("before-promotion", self.config["baselineImageId"], self.config["baselineRevision"], self.schema)
        self.save("fresh-backup", fresh)
        require(len(checked_fingerprint(fresh["fingerprint"], self.schema)["tables"]) == self.config["expectedTableCount"], "Fresh database shape differs")
        mount = self.ops.data_mount(self.ops.inspect(self.ops.APP))
        require(mount == pause["appMount"] == fresh["dataMount"], "Live mount changed")

        def compose_args(*args):
            return ["sh", "-c", "cd " + shlex.quote(self.ops.DEPLOY) + " && " + shlex.join(["env", "IMAGE=" + self.ops.LATEST, "docker", "compose", *args])]

        # The compose output may contain credentials: validate in memory only.
        compose = json.loads(self.ops.remote(compose_args("config", "--format", "json")))
        app = compose["services"][self.config["composeService"]]
        require(app["image"] == self.ops.LATEST and app["environment"]["DB_PATH"] == "/data/workouts.db", "Compose target differs")
        mounts = [item for item in app["volumes"] if item["target"] == "/data"]
        require(len(mounts) == 1, "Expected single data mount")
        configured = mounts[0]
        source = compose["volumes"][configured["source"]]["name"] if configured["type"] == "volume" else configured["source"]
        require(configured["type"] == mount["Type"] and source == mount.get("Name", mount["Source"]) and not configured.get("read_only", False), "Compose would change data volume")
        self.ops.remote(["docker", "pull", self.ops.LATEST])
        require(self.ops.image_id(self.ops.LATEST, self.revision) == target_id, "latest moved; refuse deployment")
        self.paused()
        self.ops.same_mount(self.ops.live_identity(self.config["baselineImageId"]), mount)
        result = {"status": "promoting", "candidate": candidate, "revision": self.revision, "imageId": target_id, "schemaRevision": self.schema,
                  "startedAt": stamp(), "browserReceipt": str(browser_file), "freshBackup": fresh["localDirectory"], "dataMount": mount, "liveDatabaseRestored": False}
        self.save("promotion", result)
        self.ops.remote(compose_args("up", "-d", "--no-deps", "--pull", "never", self.config["composeService"]))
        result["health"] = self.ops.healthy(target_id, self.revision, mount)
        post = self.ops.online_backup("after-promotion", target_id, self.revision, self.schema)
        self.save("post-backup", post)
        require(len(checked_fingerprint(post["fingerprint"], self.schema)["tables"]) == self.config["expectedTableCount"], "Post-promotion database shape differs")
        result.update(status="restoring-updater", postSchema=post["fingerprint"]["schemaRevision"])
        self.save("promotion", result)
        self.ops.remote(["docker", "pull", self.ops.LATEST])
        require(self.ops.image_id(self.ops.LATEST, self.revision) == target_id, "Registry latest moved; leave updater paused")
        self.paused()
        self.ops.healthy(target_id, self.revision, mount)
        self.ops.remote(["docker", "start", self.ops.WATCHTOWER])
        require(self.ops.inspect(self.ops.WATCHTOWER)["State"]["Running"] is True, "Updater failed to restart")
        result.update(status="passed", finishedAt=stamp(), updaterRestored=True)
        self.save("promotion", result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("action", choices=["pause", "rehearse", "promote"])
    parser.add_argument("--candidate")
    parser.add_argument("--browser-result")
    args = parser.parse_args()
    config = load_config(args.config)
    if args.action != "pause":
        require(valid_image(args.candidate, config["imageRepository"]), "An immutable --candidate is required")
    if args.action == "promote":
        require(args.browser_result, "--browser-result is required")
    os.umask(0o077)
    release = Release(config)
    try:
        if args.action == "pause": release.pause()
        elif args.action == "rehearse": release.rehearsal(args.candidate)
        else: release.promote(args.candidate, args.browser_result)
    except BaseException as error:
        if args.action == "promote":
            state = release.read("promotion") if (release.output / "promotion.json").exists() else {"status": "preflight"}
            state.update(status="failed", failedPhase=state["status"], error=str(error), finishedAt=stamp())
            release.save("promotion", state)
        raise
    print(json.dumps({"status": "passed", "action": args.action, "outputDirectory": config["outputDirectory"]}))


if __name__ == "__main__":
    main()
