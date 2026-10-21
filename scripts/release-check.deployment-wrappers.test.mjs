import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const revision = "a".repeat(40);
const digest = "b".repeat(64);
const configHash = "c".repeat(64);
const candidate = `ghcr.io/example/magni@sha256:${digest}`;
const config = {
  repositoryRoot: process.cwd(), outputDirectory: path.join(process.cwd(), ".playwright/deployment-wrapper-test"),
  candidateRevision: revision, configHash, githubRunId: "123", imageRepository: "ghcr.io/example/magni",
  sshHost: "operator@example.test", resourcePrefix: "magni-test", localPort: 4123, remotePort: 4123,
  browserFiles: ["audit-recovery.spec.ts"], browserHelpers: ["helpers.ts"],
};

test("tracked browser adapter imports without starting work and rejects unpinned or mismatched inputs", async () => {
  assert.ok(fs.existsSync("scripts/deployment/browser-staging.mjs"), "Missing tracked browser staging adapter");
  const { validateBrowserInputs } = await import("./deployment/browser-staging.mjs");
  assert.equal(typeof validateBrowserInputs, "function");
  assert.doesNotThrow(() => validateBrowserInputs(config, candidate));
  for (const image of ["ghcr.io/example/magni:latest", candidate.replace("example/", "someone/"), candidate + "extra"]) {
    assert.throws(() => validateBrowserInputs(config, image));
  }
  for (const overrides of [{ candidateRevision: "main" }, { configHash: "" }, { githubRunId: null }, { githubRunId: undefined }, { browserFiles: [] },
    { browserFiles: ["../outside.spec.ts"] }, { browserHelpers: [] }, { localPort: 80 }, { sshHost: "-F other" }]) {
    assert.throws(() => validateBrowserInputs({ ...config, ...overrides }, candidate));
  }
});

test("publication and stage guards require exact clean CI, immutable image and matching configuration", () => {
  assert.ok(fs.existsSync("scripts/deployment/publication.py"), "Missing tracked publication verifier");
  const result = spawnSync("python3", ["-B", "-c", `
import sys
sys.path.insert(0, 'scripts/deployment')
from publication import validate_publication
from stage import validate_publication_receipt
c={'candidateRevision':'${revision}','configHash':'${configHash}','imageRepository':'ghcr.io/example/magni','githubRunId':'123','githubRepository':'example/magni'}
m={'id':123,'head_sha':'${revision}','conclusion':'success','run_attempt':2}
g={'status':'passed','source':{'commit':'${revision}','dirty':False,'runId':'123','runAttempt':'2'},'browser':{'expected':4,'passed':4,'projects':{'chromium':2,'mobile-safari':2}},'checks':[{'name':name,'status':'passed','exitCode':0,'command':['test','--fail-on-flaky-tests'] if name=='e2e' else ['test']} for name in ['gate-policy','dependency-audit','route-types','typecheck','lint','tests-and-coverage','production-build','e2e']]}
p={'commit':'${revision}','runAttempt':2,'pinnedImage':'${candidate}','verifiedRun':'https://github.com/example/magni/actions/runs/123'}
assert validate_publication(c,m,g,p)=='${candidate}'
def rejects(fn):
    try: fn()
    except (ValueError, RuntimeError, AssertionError): return
    raise AssertionError('Unsafe evidence accepted')
rejects(lambda:validate_publication(c,{**m,'head_sha':'0'*40},g,p))
rejects(lambda:validate_publication(c,m,{**g,'source':{**g['source'],'dirty':True}},p))
rejects(lambda:validate_publication(c,m,{**g,'checks':g['checks'][:-1]},p))
rejects(lambda:validate_publication(c,m,g,{**p,'runAttempt':1}))
rejects(lambda:validate_publication(c,m,{**g,'source':{**g['source'],'runId':'456'}},p))
rejects(lambda:validate_publication(c,m,{**g,'source':{**g['source'],'runAttempt':'1'}},p))
rejects(lambda:validate_publication(c,m,{**g,'browser':{**g['browser'],'passed':3}},p))
rejects(lambda:validate_publication(c,m,g,{**p,'verifiedRun':'https://github.com/other/repo/actions/runs/123'}))
rejects(lambda:validate_publication(c,m,g,{**p,'pinnedImage':'ghcr.io/example/magni:latest'}))
r={'status':'passed','phase':'verified-publication','configHash':'${configHash}','commit':'${revision}','pinnedImage':'${candidate}','run':'123'}
assert validate_publication_receipt(c,r,'${revision}',False)=='${candidate}'
rejects(lambda:validate_publication_receipt(c,r,'${revision}',True))
rejects(lambda:validate_publication_receipt(c,{**r,'configHash':'wrong'},'${revision}',False))
rejects(lambda:validate_publication_receipt(c,{**r,'status':'failed'},'${revision}',False))
rejects(lambda:validate_publication_receipt(c,{**r,'run':'456'},'${revision}',False))
rejects(lambda:validate_publication_receipt({**c,'githubRunId':None},r,'${revision}',False))
rejects(lambda:validate_publication({**c,'githubRunId':None},m,g,p))
`], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
