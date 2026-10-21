"""Guarded release operations. Constructors/imports perform no I/O."""
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

from config import require, valid_image
from preservation import FINGERPRINT_JS, checked_fingerprint

OWNER_LABEL = "io.magni.release.owner"
BACKUP_JS = "process.umask(0o077);const {backupDatabase}=await import('./scripts/database-maintenance.mjs');console.log(JSON.stringify(await backupDatabase({databasePath:'/data/workouts.db',outputPath:process.argv[1]})));"
HEALTH_JS = "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(3000)}).then(async r=>console.log(JSON.stringify({status:r.status,body:await r.json()}))).catch(e=>{console.error(e.message);process.exitCode=1})"


def write_json(file, value):
    file = Path(file)
    temporary = file.with_name(file.name + ".tmp-" + uuid.uuid4().hex)
    with open(temporary, "x", opener=lambda name, flags: os.open(name, flags, 0o600)) as output:
        output.write(json.dumps(value, indent=2) + "\n")
    temporary.replace(file)


def read_json(file):
    return json.loads(Path(file).read_text())


def prepare_output(config):
    output = Path(config["outputDirectory"])
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    output.chmod(0o700)
    marker = output / ".release-owner.json"
    if marker.exists():
        require(read_json(marker) == {"configHash": config["configHash"]}, "Output belongs to a different release configuration")
    else:
        # Exclusive creation protects against two different coordinators.
        with open(marker, "x", opener=lambda name, flags: os.open(name, flags, 0o600)) as destination:
            json.dump({"configHash": config["configHash"]}, destination)
    return output


def write_receipt(config, name, value):
    require(re.fullmatch(r"[a-z][a-z0-9-]*", name), "Invalid receipt name")
    output = prepare_output(config)
    file = output / (name + ".json")
    if file.exists():
        require(read_json(file).get("configHash") == config["configHash"], "Existing receipt belongs to another configuration")
    require(value.get("configHash", config["configHash"]) == config["configHash"], "Receipt configuration mismatch")
    write_json(file, {**value, "configHash": config["configHash"]})


class Operations:
    OWNER_LABEL = OWNER_LABEL
    HEALTH_JS = HEALTH_JS
    BACKUP_JS = BACKUP_JS

    def __init__(self, config):
        self.config = config
        self.HOST = config["sshHost"]
        self.DEPLOY = config["deployDirectory"]
        self.APP = config["appContainer"]
        self.WATCHTOWER = config["updaterContainer"]
        self.LATEST = config["imageRepository"] + ":latest"

    def remote(self, args, input=None, timeout=120):
        return subprocess.check_output(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", self.HOST, shlex.join(args)], input=input, text=True, timeout=timeout, stderr=subprocess.PIPE).strip()

    def inspect(self, name, image=False):
        return json.loads(self.remote(["docker"] + (["image"] if image else []) + ["inspect", "--format", "{{json .}}", name]))

    def image_id(self, image, revision):
        require(valid_image(image, self.config["imageRepository"]) or image == self.LATEST, "Image outside configured repository")
        info = self.inspect(image, image=True)
        require(info["Os"] == "linux", "Expected a Linux image")
        require(info["Config"].get("Labels", {}).get("org.opencontainers.image.revision") == revision, "Image OCI revision mismatch")
        return info["Id"]

    def watchtower_stopped(self):
        require(self.inspect(self.WATCHTOWER)["State"]["Running"] is False, "Updater must remain stopped during release operations")

    def live_identity(self, expected_id, running=True):
        info = self.inspect(self.APP)
        require(info["Image"] == expected_id, "Unexpected live image; no action taken")
        require(info["State"]["Running"] is running, "Unexpected live running state")
        return info

    @staticmethod
    def data_mount(info):
        mounts = [mount for mount in info["Mounts"] if mount["Destination"] == "/data"]
        require(len(mounts) == 1 and mounts[0]["RW"], "Expected one writable /data mount")
        mount = mounts[0]
        require(mount["Type"] in ("bind", "volume"), "Unsupported /data mount")
        source = mount.get("Name") if mount["Type"] == "volume" else mount["Source"]
        require(bool(source) and "," not in source and "\n" not in source, "Unsafe mount source")
        return {key: mount[key] for key in ("Type", "Source", "Destination")} | ({"Name": mount["Name"]} if mount["Type"] == "volume" else {})

    def same_mount(self, info, expected):
        require(self.data_mount(info) == expected, "Live /data mount changed")

    def healthy(self, expected_id, revision, mount=None):
        for _ in range(45):
            info = self.live_identity(expected_id)
            if mount:
                self.same_mount(info, mount)
            try:
                response = json.loads(self.remote(["docker", "exec", self.APP, "node", "-e", HEALTH_JS], timeout=15))
                if response == {"status": 200, "body": {"status": "ok", "revision": revision}}:
                    return response
            except (subprocess.SubprocessError, json.JSONDecodeError):
                pass
            time.sleep(1)
        raise RuntimeError("Live application did not become healthy at expected revision")

    def no_volume_writers(self, volume):
        # Restore is restricted to a unique owned staging volume. Check every
        # running container, not merely the one this process started.
        for container in self.remote(["docker", "ps", "--format", "{{.ID}}"]).splitlines():
            info = self.inspect(container)
            require(not any(mount.get("Name") == volume and mount.get("RW") for mount in info["Mounts"]), "A running container still writes the staging volume")

    def online_backup(self, kind, expected_id, revision, schema):
        require(re.fullmatch(r"[a-z][a-z0-9-]*", kind), "Unsafe backup kind")
        self.watchtower_stopped()
        mount = self.data_mount(self.live_identity(expected_id))
        self.healthy(expected_id, revision, mount)
        output = prepare_output(self.config)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:12]
        folder = output / (kind + "-" + stamp)
        folder.mkdir(mode=0o700)
        remote_folder = self.DEPLOY + "/backups/" + self.config["resourcePrefix"] + "-" + kind + "-" + stamp
        self.remote(["mkdir", "-m", "700", remote_folder])
        temporary = "/tmp/" + self.config["resourcePrefix"] + "-backup-" + uuid.uuid4().hex + ".sqlite"
        receipt = json.loads(self.remote(["docker", "exec", self.APP, "node", "--input-type=module", "-e", BACKUP_JS, temporary]))
        require(receipt["applicationRevision"] == revision, "Backup application revision mismatch")
        fingerprint = checked_fingerprint(json.loads(self.remote(["docker", "exec", self.APP, "node", "-e", FINGERPRINT_JS, temporary])), schema)
        for suffix in ("", ".json"):
            destination = remote_folder + "/workouts.sqlite" + suffix
            self.remote(["docker", "cp", self.APP + ":" + temporary + suffix, destination])
            self.remote(["chmod", "600", destination])
            subprocess.run(["scp", "-q", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", self.HOST + ":" + destination, str(folder / ("workouts.sqlite" + suffix))], check=True, timeout=120, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            (folder / ("workouts.sqlite" + suffix)).chmod(0o600)
        checksum = hashlib.sha256((folder / "workouts.sqlite").read_bytes()).hexdigest()
        require(checksum == receipt["sha256"], "Local backup checksum differs from receipt")
        require(self.remote(["sha256sum", remote_folder + "/workouts.sqlite"]).split()[0] == checksum, "Durable server backup checksum mismatch")
        require(read_json(folder / "workouts.sqlite.json") == receipt, "Copied backup receipt mismatch")
        self.same_mount(self.live_identity(expected_id), mount)
        self.watchtower_stopped()
        result = {"status": "passed", "configHash": self.config["configHash"], "localDirectory": str(folder), "remoteDirectory": remote_folder,
                  "sha256": checksum, "receipt": receipt, "fingerprint": fingerprint, "imageId": expected_id, "revision": revision,
                  "dataMount": mount, "remoteTemporaryBackup": temporary}
        write_json(folder / "backup-result.json", result)
        return result
