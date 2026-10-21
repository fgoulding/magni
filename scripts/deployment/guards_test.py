"""Offline release guard regressions; no network, Docker or application runtime."""
import copy
import importlib
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


def configuration(root):
    return {
        "schemaVersion": 1, "repositoryRoot": str(root),
        "outputDirectory": str(root / ".playwright" / "release-fixture"),
        "sshHost": "operator@example.test", "deployDirectory": "/srv/example",
        "appContainer": "example-app-1", "updaterContainer": "example-updater-1",
        "composeService": "app", "imageRepository": "ghcr.io/example/app",
        "baselineRevision": "a" * 40,
        "baselineImage": "ghcr.io/example/app@sha256:" + "1" * 64,
        "baselineImageId": "sha256:" + "2" * 64,
        "candidateRevision": "b" * 40, "githubRepository": "example/app",
        "githubRunId": "123", "schemaRevision": 7, "expectedTableCount": 44,
        "resourcePrefix": "example-release", "localPort": 4123, "remotePort": 4123,
        "browserFiles": ["workout-save-toggle.spec.ts"],
        "browserHelpers": ["helpers.ts"],
    }


class ConfigurationTests(unittest.TestCase):
    def test_explicit_config_has_stable_identity_and_no_output_side_effect(self):
        from config import validate_config
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw = configuration(root)
            valid = validate_config(raw)
            self.assertRegex(valid["configHash"], r"^[a-f0-9]{64}$")
            self.assertEqual(valid, validate_config(copy.deepcopy(raw)))
            self.assertFalse(Path(valid["outputDirectory"]).exists())
            changed = copy.deepcopy(raw)
            changed["appContainer"] = "other-app"
            self.assertNotEqual(valid["configHash"], validate_config(changed)["configHash"])
            pending = {**raw, "githubRunId": None}
            self.assertEqual(valid["configHash"], validate_config(pending)["configHash"])

    def test_config_fails_closed_for_missing_unsafe_or_ambiguous_targets(self):
        from config import validate_config
        with tempfile.TemporaryDirectory() as temporary:
            raw = configuration(Path(temporary))
            for key in raw:
                incomplete = copy.deepcopy(raw)
                del incomplete[key]
                with self.subTest(missing=key), self.assertRaises((ValueError, RuntimeError)):
                    validate_config(incomplete)
            for key, value in [
                ("credentials", "never commit this"), ("sshHost", "-oProxyCommand=bad"),
                ("baselineImage", "ghcr.io/example/app:latest"), ("baselineRevision", "main"),
                ("baselineImageId", "latest"), ("schemaRevision", True),
                ("expectedTableCount", 0), ("resourcePrefix", "../../live"),
                ("deployDirectory", "/srv/../other"), ("localPort", 80),
                ("browserFiles", ["../escape.spec.ts"]), ("browserHelpers", []),
                ("updaterContainer", raw["appContainer"]),
                ("outputDirectory", str(Path(temporary) / "tracked-output")),
            ]:
                invalid = {**raw, key: value}
                with self.subTest(key=key, value=value), self.assertRaises((ValueError, RuntimeError)):
                    validate_config(invalid)


def fingerprint(schema=7):
    tables = {"session_sets": {"rows": 1, "columns": ["id"], "sha256": "a" * 64}}
    for name in ("exercise_sources", "exercise_set_sources"):
        tables[name] = {"rows": 1, "columns": ["id", "exercise_id"], "sha256": "b" * 64,
                        "protectedColumns": ["id"], "protectedSha256": "c" * 64}
    for index in range(41):
        tables["saved_table_" + str(index)] = {"rows": 1, "columns": ["id"], "sha256": "d" * 64}
    return {"schemaRevision": schema, "integrity": "ok", "foreignKeys": 0, "tables": tables,
            "identityCoverage": {"sessionSets": 1, "linkedSessionSets": 1, "missingSetMappings": 0, "missingSourceMappings": 0},
            "catalog": [{"type": "table", "name": "session_sets", "sql": "CREATE TABLE session_sets(id)"}], "deletionMarkers": 2}


class PreservationTests(unittest.TestCase):
    def test_exact_contract_rejects_each_changed_persisted_dimension(self):
        from preservation import checked_fingerprint, exact_preserved
        original = fingerprint()
        self.assertEqual(checked_fingerprint(original, 7), original)
        self.assertTrue(exact_preserved(copy.deepcopy(original), original, 7))
        variants = []
        for field, value in [("schemaRevision", 8), ("foreignKeys", 1), ("integrity", "corrupt"), ("deletionMarkers", 1)]:
            variants.append({**copy.deepcopy(original), field: value})
        changed = copy.deepcopy(original); changed["catalog"][0]["sql"] += " changed"; variants.append(changed)
        changed = copy.deepcopy(original); changed["tables"]["saved_table_1"]["sha256"] = "e" * 64; variants.append(changed)
        changed = copy.deepcopy(original); changed["identityCoverage"]["missingSetMappings"] = 1; variants.append(changed)
        changed = copy.deepcopy(original); del changed["tables"]["saved_table_1"]; variants.append(changed)
        changed = copy.deepcopy(original); changed["tables"]["exercise_sources"]["protectedColumns"] = []; variants.append(changed)
        for value in variants:
            with self.assertRaises(RuntimeError): exact_preserved(value, original, 7)

    def test_private_output_belongs_to_one_config_and_receipts_are_private(self):
        from config import validate_config
        from operations import prepare_output, write_receipt
        with tempfile.TemporaryDirectory() as temporary:
            config = validate_config(configuration(Path(temporary)))
            output = prepare_output(config)
            write_receipt(config, "example", {"status": "passed"})
            saved = json.loads((output / "example.json").read_text())
            self.assertEqual(saved["configHash"], config["configHash"])
            self.assertEqual((output / "example.json").stat().st_mode & 0o777, 0o600)
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            with self.assertRaises(RuntimeError): prepare_output({**config, "configHash": "f" * 64})
            with self.assertRaises(RuntimeError): write_receipt(config, "../escape", {})


def evidence(config):
    candidate = config["imageRepository"] + "@sha256:" + "3" * 64
    revision = config["candidateRevision"]
    shared = {"configHash": config["configHash"], "status": "passed", "candidate": candidate, "revision": revision,
              "ownedStagingResourcesRemoved": True, "cleanupErrors": [], "releaseEvidence": True, "imageId": "sha256:" + "4" * 64}
    pub = {"configHash": config["configHash"], "status": "passed", "phase": "verified-publication", "commit": revision,
           "pinnedImage": candidate, "run": config["githubRunId"], "attempt": 1}
    names = ["gate-policy", "dependency-audit", "route-types", "typecheck", "lint", "tests-and-coverage", "production-build", "e2e"]
    gate = {"status": "passed", "source": {"commit": revision, "dirty": False, "runId": config["githubRunId"], "runAttempt": "1"},
            "checks": [{"name": name, "status": "passed", "exitCode": 0, "command": ["--fail-on-flaky-tests"]} for name in names],
            "browser": {"expected": 250, "passed": 250, "projects": {"chromium": 125, "mobile-safari": 125}}}
    published = {"commit": revision, "pinnedImage": candidate, "runAttempt": "1", "verifiedRun": "https://github.com/" + config["githubRepository"] + "/actions/runs/" + config["githubRunId"]}
    labels = ["candidate startup", "candidate restart", "backup preserved", "baseline rollback after backup restore", "candidate after rollback"]
    pop = {**shared, "baseline": config["baselineRevision"], "baselineImage": config["baselineImage"], "baselineImageId": config["baselineImageId"],
           "schemaRevision": config["schemaRevision"], "sourceFingerprint": fingerprint(),
           "checks": [{"label": label, "schema": 7, "allTablesUnchanged": 44, "integrity": "ok"} for label in labels]}
    web = {**shared, "dockerHost": "ssh://" + config["sshHost"], "projects": ["chromium", "mobile-safari"], "expectedBrowserCases": 2,
           "browserCases": 2, "browserRetries": 0, "sourceTests": {name: "a" * 64 for name in config["browserFiles"] + config["browserHelpers"]}}
    return [candidate, pub, gate, published, pop, web]


class PromotionTests(unittest.TestCase):
    def test_all_original_gates_and_exact_config_are_required(self):
        from config import validate_config
        from release import validate_evidence
        with tempfile.TemporaryDirectory() as temporary:
            config = validate_config(configuration(Path(temporary)))
            good = evidence(config)
            self.assertEqual(validate_evidence(config, *good), good[-1]["imageId"])
            with self.assertRaises(RuntimeError): validate_evidence({**config, "githubRunId": None}, *good)
            changes = [
                (1, "configHash", "wrong"), (1, "phase", "waiting"), (1, "attempt", 2),
                (1, "run", "456"), (2, "status", "failed"), (3, "pinnedImage", config["baselineImage"]),
                (3, "verifiedRun", "https://github.com/other/app/actions/runs/123"),
                (4, "baseline", "c" * 40), (4, "baselineImageId", "sha256:" + "f" * 64),
                (4, "schemaRevision", 8), (4, "releaseEvidence", False), (4, "checks", []),
                (5, "projects", ["chromium"]), (5, "browserRetries", 1), (5, "browserCases", 1),
                (5, "ownedStagingResourcesRemoved", False), (5, "cleanupErrors", ["failed"]),
                (5, "candidate", config["baselineImage"]), (5, "imageId", "sha256:" + "f" * 64),
                (5, "dockerHost", "ssh://elsewhere"), (5, "sourceTests", {}),
            ]
            for index, key, value in changes:
                invalid = copy.deepcopy(good); invalid[index][key] = value
                with self.subTest(index=index, key=key), self.assertRaises(RuntimeError):
                    validate_evidence(config, *invalid)
            for mutate in [
                lambda value: value[2]["source"].update(dirty=True),
                lambda value: value[2]["checks"][0].update(name="unknown"),
                lambda value: value[2]["checks"][0].update(exitCode=1),
                lambda value: value[2]["checks"][-1].update(command=[]),
                lambda value: value[2]["browser"].update(passed=249),
                lambda value: value[4]["checks"][0].update(allTablesUnchanged=43),
                lambda value: value[4]["sourceFingerprint"]["tables"].pop("saved_table_1"),
            ]:
                invalid = copy.deepcopy(good); mutate(invalid)
                with self.assertRaises(RuntimeError): validate_evidence(config, *invalid)


class FakeOperations:
    """Stateful fake; assertions enforce writer/ownership ordering offline."""
    from operations import OWNER_LABEL, HEALTH_JS, BACKUP_JS

    def __init__(self, config, foreign=False):
        self.config = config
        self.APP, self.WATCHTOWER = config["appContainer"], config["updaterContainer"]
        self.DEPLOY, self.LATEST = config["deployDirectory"], config["imageRepository"] + ":latest"
        self.app = None
        self.volume = None
        self.running = False
        self.owner = None
        self.foreign = foreign
        self.events = []

    def inspect(self, name):
        if name == self.WATCHTOWER:
            return {"Id": "updater-id", "Image": "updater-image", "State": {"Running": False}}
        assert name == self.app
        return {"Config": {"Labels": {self.OWNER_LABEL: "foreign" if self.foreign else self.owner}}, "State": {"Running": self.running}}

    def live_identity(self, image):
        assert image == self.config["baselineImageId"]

    def image_id(self, image, revision):
        if image == self.config["baselineImage"]:
            assert revision == self.config["baselineRevision"]
            return self.config["baselineImageId"]
        assert revision == self.config["candidateRevision"]
        return "sha256:" + "4" * 64

    def no_volume_writers(self, volume):
        assert volume == self.volume
        assert self.app is None, "restore attempted before removing the writer"
        self.events.append("no-writers")

    def remote(self, args, **kwargs):
        if args[0] == "sha256sum": return "a" * 64 + " backup"
        assert args[0] == "docker"
        if args[1:3] == ["volume", "create"]:
            self.volume = args[-1]
            self.owner = args[args.index("--label") + 1].split("=", 1)[1]
            return self.volume
        if args[1:3] == ["volume", "inspect"]:
            return json.dumps({"Labels": {self.OWNER_LABEL: self.owner}})
        if args[1:3] == ["volume", "rm"]:
            assert self.app is None
            self.events.append("remove-volume"); self.volume = None; return ""
        if args[1] == "run":
            assert self.app is None
            assert self.events[-1] == "no-writers"
            self.events.append("restore" if "unlinkSync" in args[-1] else "copy")
            return ""
        if args[1] == "create":
            assert self.app is None
            self.app = args[args.index("--name") + 1]
            self.image = args[-1]
            self.events.append("create:" + self.image)
            return self.app
        if args[1] in ("start", "restart"):
            self.running = True; return ""
        if args[1] == "stop":
            self.running = False; self.events.append("stop"); return ""
        if args[1] == "rm":
            assert not self.running
            self.app = None; self.events.append("remove-app"); return ""
        if args[1] == "exec":
            assert self.running
            if self.HEALTH_JS in args:
                revision = self.config["baselineRevision"] if self.image == self.config["baselineImage"] else self.config["candidateRevision"]
                return json.dumps({"status": 200, "body": {"status": "ok", "revision": revision}})
            if self.BACKUP_JS in args: return json.dumps({"applicationRevision": self.config["candidateRevision"]})
            return json.dumps(fingerprint())
        raise AssertionError(args)


class OrchestrationTests(unittest.TestCase):
    def setup_release(self, temporary, foreign=False):
        from config import validate_config
        from release import Release
        config = validate_config(configuration(Path(temporary)))
        ops = FakeOperations(config, foreign)
        release = Release(config, ops)
        release.save("pause", {"status": "paused", "wasRunning": True, "baseline": config["baselineRevision"], "baselineImage": config["baselineImage"], "updaterId": "updater-id", "updaterImageId": "updater-image"})
        release.save("baseline-backup", {"status": "passed", "revision": config["baselineRevision"], "imageId": config["baselineImageId"], "fingerprint": fingerprint(),
                     "remoteDirectory": config["deployDirectory"] + "/backups/" + config["resourcePrefix"] + "-baseline-test", "localDirectory": temporary, "sha256": "a" * 64})
        return config, release, ops

    def test_rehearsal_stops_writer_before_restore_and_proves_all_five_checks(self):
        with tempfile.TemporaryDirectory() as temporary:
            config, release, ops = self.setup_release(temporary)
            candidate = config["imageRepository"] + "@sha256:" + "3" * 64
            release.rehearsal(candidate)
            result = release.read("populated")
            self.assertEqual(result["status"], "passed")
            self.assertEqual(len(result["checks"]), 5)
            self.assertTrue(result["ownedStagingResourcesRemoved"])
            self.assertEqual(result["cleanupErrors"], [])
            restore = ops.events.index("restore")
            self.assertEqual(ops.events[restore - 3:restore], ["stop", "remove-app", "no-writers"])
            self.assertEqual([item for item in ops.events if item.startswith("create:")], ["create:" + candidate, "create:" + config["baselineImage"], "create:" + candidate])
            self.assertEqual(ops.events[-3:], ["stop", "remove-app", "remove-volume"])

    def test_cleanup_refuses_foreign_container_and_never_drops_its_volume(self):
        with tempfile.TemporaryDirectory() as temporary:
            config, release, ops = self.setup_release(temporary, foreign=True)
            with self.assertRaisesRegex(RuntimeError, "ownership"):
                release.rehearsal(config["imageRepository"] + "@sha256:" + "3" * 64)
            result = release.read("populated")
            self.assertEqual(result["status"], "failed")
            self.assertFalse(result["ownedStagingResourcesRemoved"])
            self.assertTrue(result["cleanupErrors"])
            self.assertNotIn("remove-volume", ops.events)
            self.assertNotIn("remove-app", ops.events)

    def test_imports_and_constructors_perform_no_operations(self):
        import config, operations, preservation, release
        with patch("subprocess.check_output", side_effect=AssertionError("import started a process")), patch("subprocess.run", side_effect=AssertionError("import started a process")), patch("pathlib.Path.mkdir", side_effect=AssertionError("import wrote output")):
            for module in (config, operations, preservation, release): importlib.reload(module)
            settings = config.validate_config(configuration(Path("/private/tmp/example-repository")))
            operations.Operations(settings)
            release.Release(settings)


class PromotionOperations(FakeOperations):
    from operations import Operations
    data_mount = staticmethod(Operations.data_mount)

    def __init__(self, config, fault=None):
        super().__init__(config)
        self.fault = fault
        self.live = config["baselineImageId"]
        self.updater_running = False
        self.mount = {"Type": "volume", "Source": "/volumes/live/_data", "Destination": "/data", "Name": "live-data"}

    def inspect(self, name):
        if name == self.WATCHTOWER:
            identity = "replacement" if self.fault == "replaced-updater" and "deploy" in self.events else "updater-id"
            return {"Id": identity, "Image": "updater-image", "State": {"Running": self.updater_running}}
        assert name == self.APP
        return {"Image": self.live, "State": {"Running": True}, "Mounts": [{**self.mount, "RW": True}]}

    def healthy(self, image_id, revision, mount=None):
        assert self.live == image_id
        if mount: self.same_mount(self.inspect(self.APP), mount)
        return {"status": 200, "body": {"status": "ok", "revision": revision}}

    def same_mount(self, info, expected):
        assert self.data_mount(info) == expected

    def live_identity(self, image_id):
        assert self.live == image_id
        return self.inspect(self.APP)

    def image_id(self, image, revision):
        if image == self.LATEST and self.fault == "moved-latest": return "sha256:" + "9" * 64
        return super().image_id(image, revision)

    def online_backup(self, kind, expected_id, revision, schema):
        assert self.live == expected_id and not self.updater_running
        self.events.append("backup:" + kind)
        if self.fault == "post-backup" and kind == "after-promotion": raise RuntimeError("post backup unavailable")
        mount = {**self.mount, "Name": "unexpected"} if self.fault == "fresh-mount" else self.mount
        return {"status": "passed", "configHash": self.config["configHash"], "fingerprint": fingerprint(schema), "localDirectory": "/private/disposable-backup", "dataMount": mount}

    def remote(self, args, **kwargs):
        if args[:2] == ["docker", "pull"]:
            self.events.append("pull"); return ""
        if args[:2] == ["docker", "start"]:
            assert args[-1] == self.WATCHTOWER
            self.updater_running = True; self.events.append("resume-updater"); return ""
        if args[:2] == ["sh", "-c"]:
            if "config --format json" in args[2]:
                return json.dumps({"services": {self.config["composeService"]: {"image": self.LATEST, "environment": {"DB_PATH": "/data/workouts.db"}, "volumes": [{"type": "volume", "source": "data", "target": "/data"}]}}, "volumes": {"data": {"name": "live-data"}}})
            assert "up -d --no-deps --pull never" in args[2]
            self.events.append("deploy"); self.live = "sha256:" + "4" * 64; return ""
        raise AssertionError(args)


class PromotionOrderingTests(unittest.TestCase):
    def run_promotion(self, temporary, fault=None):
        from config import validate_config
        from operations import write_json
        from release import Release
        config = validate_config(configuration(Path(temporary)))
        ops = PromotionOperations(config, fault)
        release = Release(config, ops)
        candidate, pub, gate, published, pop, web = evidence(config)
        pub["evidence"] = str(release.output / "ci")
        pub["publishedImage"] = str(release.output / "published-image.json")
        source = b"committed source"
        web["sourceTests"] = {name: hashlib.sha256(source).hexdigest() for name in web["sourceTests"]}
        release.save("pause", {"status": "paused", "wasRunning": True, "baseline": config["baselineRevision"], "baselineImage": config["baselineImage"], "updaterId": "updater-id", "updaterImageId": "updater-image", "appMount": ops.mount})
        release.save("publication", pub); release.save("populated", pop); release.save("browser", web)
        gate_path = Path(pub["evidence"]) / ".playwright/release-checks/result.json"
        gate_path.parent.mkdir(parents=True)
        write_json(gate_path, gate); write_json(pub["publishedImage"], published)

        def git(args, **kwargs):
            assert args[0] == "git"
            if args[1] == "rev-parse": return config["candidateRevision"] + "\n"
            if args[1] == "status": return ""
            if args[1] == "show": return source
            raise AssertionError(args)

        with patch("subprocess.check_output", side_effect=git):
            if fault:
                with self.assertRaises(RuntimeError): release.promote(candidate, release.output / "browser.json")
            else:
                release.promote(candidate, release.output / "browser.json")
        return release, ops

    def test_fresh_backup_precedes_deployment_and_updater_follows_verified_post_backup(self):
        with tempfile.TemporaryDirectory() as temporary:
            release, ops = self.run_promotion(temporary)
            self.assertEqual(ops.events, ["backup:before-promotion", "pull", "deploy", "backup:after-promotion", "pull", "resume-updater"])
            self.assertTrue(ops.updater_running)
            receipt = release.read("promotion")
            self.assertEqual(receipt["status"], "passed")
            self.assertTrue(receipt["updaterRestored"])
            self.assertFalse(receipt["liveDatabaseRestored"])

    def test_fresh_mount_or_latest_mismatch_blocks_deploy_and_later_failure_leaves_updater_paused(self):
        for fault in ("fresh-mount", "moved-latest", "post-backup", "replaced-updater"):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as temporary:
                _, ops = self.run_promotion(temporary, fault)
                self.assertFalse(ops.updater_running)
                if fault in ("fresh-mount", "moved-latest"): self.assertNotIn("deploy", ops.events)


if __name__ == "__main__":
    unittest.main()
