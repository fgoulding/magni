"""Explicit private release configuration. Importing this module performs no I/O."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re

FIELDS = {
    "schemaVersion", "repositoryRoot", "outputDirectory", "sshHost", "deployDirectory",
    "appContainer", "updaterContainer", "composeService", "imageRepository",
    "baselineRevision", "baselineImage", "baselineImageId", "candidateRevision",
    "githubRepository", "githubRunId", "schemaRevision", "expectedTableCount",
    "resourcePrefix", "localPort", "remotePort", "browserFiles", "browserHelpers",
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def valid_image(image, repository):
    return isinstance(image, str) and re.fullmatch(re.escape(repository) + r"@sha256:[a-f0-9]{64}", image) is not None


def validate_config(value):
    require(isinstance(value, dict) and set(value) == FIELDS, "Configuration must contain exactly the documented fields")
    value = dict(value)
    require(type(value["schemaVersion"]) is int and value["schemaVersion"] == 1, "Unsupported configuration schema")
    for key in ("repositoryRoot", "outputDirectory"):
        require(isinstance(value[key], str) and Path(value[key]).is_absolute(), key + " must be absolute")
        value[key] = str(Path(value[key]).resolve())
    root, output = Path(value["repositoryRoot"]), Path(value["outputDirectory"])
    require(output != root, "Output cannot be the source checkout")
    if root in output.parents:
        relative = output.relative_to(root)
        require(len(relative.parts) > 1 and relative.parts[0] == ".playwright", "In-checkout output must be under .playwright")
    require(isinstance(value["sshHost"], str) and re.fullmatch(r"[A-Za-z0-9_.-]+@[A-Za-z0-9][A-Za-z0-9.-]*", value["sshHost"]), "Invalid SSH host")
    deploy = value["deployDirectory"]
    require(isinstance(deploy, str) and re.fullmatch(r"/[A-Za-z0-9_./-]+", deploy) and ".." not in PurePosixPath(deploy).parts and deploy != "/", "Unsafe deployment directory")
    value["deployDirectory"] = str(PurePosixPath(deploy))
    for key in ("appContainer", "updaterContainer", "composeService"):
        require(isinstance(value[key], str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}", value[key]), "Invalid " + key)
    require(value["appContainer"] != value["updaterContainer"], "App and updater must be different containers")
    require(isinstance(value["resourcePrefix"], str) and re.fullmatch(r"[a-z][a-z0-9-]{2,39}", value["resourcePrefix"]), "Invalid resource prefix")
    require(isinstance(value["imageRepository"], str) and re.fullmatch(r"[a-z0-9.-]+(?::[0-9]+)?/[a-z0-9_./-]+", value["imageRepository"]), "Invalid image repository")
    require(valid_image(value["baselineImage"], value["imageRepository"]), "Baseline must be an immutable image in the configured repository")
    require(isinstance(value["baselineImageId"], str) and re.fullmatch(r"sha256:[a-f0-9]{64}", value["baselineImageId"]), "Invalid baseline image ID")
    for key in ("baselineRevision", "candidateRevision"):
        require(isinstance(value[key], str) and re.fullmatch(r"[a-f0-9]{40}", value[key]), "Invalid " + key)
    require(isinstance(value["githubRepository"], str) and re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", value["githubRepository"]), "Invalid GitHub repository")
    require(value["githubRunId"] is None or isinstance(value["githubRunId"], str) and re.fullmatch(r"[1-9][0-9]*", value["githubRunId"]), "Invalid GitHub run ID")
    for key in ("schemaRevision", "expectedTableCount"):
        require(type(value[key]) is int and value[key] > 0, "Invalid " + key)
    for key in ("localPort", "remotePort"):
        require(type(value[key]) is int and 1024 <= value[key] <= 65535, "Invalid " + key)
    for key, suffix in (("browserFiles", r"\.spec\.ts"), ("browserHelpers", r"\.ts")):
        files = value[key]
        require(isinstance(files, list) and files and all(isinstance(file, str) and re.fullmatch(r"[A-Za-z0-9_-]+" + suffix, file) for file in files), "Invalid " + key)
        require(len(set(files)) == len(files), "Duplicate " + key)
    require("helpers.ts" in value["browserHelpers"], "Browser adapter requires helpers.ts")
    require(not set(value["browserHelpers"]) & set(value["browserFiles"]), "Browser helper/spec overlap")
    # The updater is paused before push, before GitHub allocates a run ID.
    # Publication/promotion bind that late-bound ID independently and exactly.
    identity = {key: item for key, item in value.items() if key != "githubRunId"}
    value["configHash"] = hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return value


def load_config(file):
    return validate_config(json.loads(Path(file).read_text()))


def main():
    parser = argparse.ArgumentParser(description="Validate private same-schema release configuration without remote access")
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    print(json.dumps(load_config(args.config), sort_keys=True))


if __name__ == "__main__":
    main()
