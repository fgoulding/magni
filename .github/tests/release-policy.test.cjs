const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');

const root = path.resolve(__dirname, '../..');
const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/docker-publish.yml'), 'utf8'));

test('the fixed release gate includes the template operator CLI regression', async () => {
  const { RELEASE_CHECKS, NODE_POLICY_TESTS } = await import('../../scripts/release-check.mjs');
  const policy = RELEASE_CHECKS.find(check => check.name === 'gate-policy');
  assert.equal(policy.command, process.execPath);
  assert.equal(policy.args[0], '--test');
  assert.ok(policy.args.includes('scripts/program-template.test.mjs'));
  const scriptTests = fs.readdirSync(path.join(root, 'scripts'), { recursive: true })
    .filter(file => /\.test\.(mjs|cjs)$/.test(file)).map(file => `scripts/${file}`);
  assert.deepEqual([...NODE_POLICY_TESTS].sort(), ['.github/tests/release-policy.test.cjs', ...scriptTests].sort(), 'Every script regression must run in the fixed gate');
  assert.deepEqual(policy.args, ['--test', ...NODE_POLICY_TESTS]);
});

test('publication requires successful release verification on the same checkout', () => {
  assert.equal(workflow.jobs['build-and-push'].needs, 'verify');
  assert.ok(workflow.jobs.verify);
  assert.ok(Object.hasOwn(workflow.on, 'pull_request'));
  assert.match(workflow.jobs['build-and-push'].if, /github\.event_name != 'pull_request'/);
  assert.doesNotMatch(workflow.jobs['build-and-push'].if, /always\(|failure\(/);
  for (const job of Object.values(workflow.jobs)) {
    assert.notEqual(job['continue-on-error'], true);
    for (const step of job.steps) assert.notEqual(step['continue-on-error'], true);
  }
});

test('verification requires core checks and all four isolated browser shards', () => {
  assert.deepEqual(workflow.jobs.verify.needs, ['core', 'browser']);
  assert.equal(workflow.jobs.verify.env.RELEASE_CORE_RESULT, '${{ needs.core.result }}');
  assert.equal(workflow.jobs.verify.env.RELEASE_BROWSER_RESULT, '${{ needs.browser.result }}');
  const coreCommands = workflow.jobs.core.steps.map(step => step.run ?? '').join('\n');
  assert.match(coreCommands, /npm ci/);
  assert.match(coreCommands, /node scripts\/release-check\.core\.mjs/);
  assert.equal(workflow.jobs.core.needs, undefined);
  assert.equal(workflow.jobs.browser.needs, undefined);
  assert.equal(workflow.jobs.browser.strategy['fail-fast'], false);
  assert.deepEqual(workflow.jobs.browser.strategy.matrix.include, [
    { project: 'chromium', engine: 'chromium', shard: 1 },
    { project: 'chromium', engine: 'chromium', shard: 2 },
    { project: 'mobile-safari', engine: 'webkit', shard: 1 },
    { project: 'mobile-safari', engine: 'webkit', shard: 2 },
  ]);
  const commands = workflow.jobs.browser.steps.map(step => step.run ?? '').join('\n');
  assert.match(commands, /npm ci/);
  assert.doesNotMatch(commands, /playwright install|apt-get|apt update/);
  assert.equal(workflow.jobs.browser.steps.find(step => step.name === 'Run the assigned browser shard').run, 'node scripts/release-check.browser.mjs --project=${{ matrix.project }} --shard=${{ matrix.shard }}/2');
  assert.match(workflow.jobs.verify.steps.map(step => step.run ?? '').join('\n'), /node scripts\/release-check\.aggregate\.mjs/);
});

test('browser dependencies are preinstalled in the matching immutable Playwright image', () => {
  const browser = workflow.jobs.browser;
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const playwrightVersion = lock.packages['node_modules/@playwright/test'].version;
  assert.equal(playwrightVersion, '1.60.0');
  assert.equal(lock.packages['node_modules/playwright'].version, playwrightVersion);
  assert.equal(lock.packages['node_modules/playwright-core'].version, playwrightVersion);
  assert.equal(browser.container?.image, `mcr.microsoft.com/playwright:v${playwrightVersion}-noble@sha256:9bd26ad900bb5e0f4dee75839e957a89ae89c2b7ab1e76050e559790e946b948`);
  assert.equal(browser.container.options, '--init --ipc=host');
  assert.equal(browser.env.PLAYWRIGHT_BROWSERS_PATH, '/ms-playwright');
  assert.equal(browser.defaults.run.shell, 'bash');
  assert.equal(browser['timeout-minutes'], 35);
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (name !== 'browser') assert.equal(job.container, undefined, 'Only browser dependency setup moves into the image');
  }
  const nodeIndex = browser.steps.findIndex(step => step.uses?.startsWith('actions/setup-node@'));
  const installIndex = browser.steps.findIndex(step => step.run === 'npm ci');
  const runtimeIndex = browser.steps.findIndex(step => step.name === 'Verify preinstalled browser runtime');
  const shardIndex = browser.steps.findIndex(step => step.name === 'Run the assigned browser shard');
  assert.equal(browser.steps[nodeIndex].with['node-version'], '22');
  assert.ok(nodeIndex < installIndex && installIndex < runtimeIndex && runtimeIndex < shardIndex);
  const runtime = browser.steps[runtimeIndex];
  assert.equal(runtime.env.PLAYWRIGHT_ENGINE, '${{ matrix.engine }}');
  assert.match(runtime.run, /assert.equal\(process.versions.node.split\('\.'\)\[0\], '22'\)/);
  assert.match(runtime.run, /assert.equal\(require\('@playwright\/test\/package.json'\).version, '1.60.0'\)/);
  assert.match(runtime.run, /accessSync\(browser.executablePath\(\), constants.X_OK\)/);
  assert.match(runtime.run, /require\('better-sqlite3'\)/);
  assert.match(runtime.run, /SELECT 1 AS ready/);
  const configuration = fs.readFileSync(path.join(root, 'playwright.config.ts'), 'utf8');
  assert.match(configuration, /workers: 1,/);
  const shardRunner = fs.readFileSync(path.join(root, 'scripts/release-check.browser.mjs'), 'utf8');
  assert.match(shardRunner, /--fail-on-flaky-tests/);
  assert.match(shardRunner, /sourceIdentity\(cwd, process.env\), result.source/);
});

test('release receipts remain small and compatible while diagnostics stay separately downloadable', () => {
  const uploads = Object.values(workflow.jobs).flatMap(job => job.steps).filter(step => step.uses?.startsWith('actions/upload-artifact@'));
  const receipt = uploads.find(step => step.with.name === 'release-checks-${{ github.sha }}-${{ github.run_attempt }}');
  assert.equal(receipt.with['include-hidden-files'], true);
  assert.match(receipt.with.path, /\.playwright\/release-checks\/\*\.json/);
  assert.match(receipt.with.path, /coverage\/coverage-summary\.json/);
  assert.doesNotMatch(receipt.with.path, /\.log|e2e-report|test-results/);
  const diagnostics = uploads.filter(step => step.with.name.startsWith('release-diagnostics-'));
  assert.equal(diagnostics.length, 2);
  assert.ok(diagnostics.some(step => step.with.path.includes('e2e-report/')));
  assert.ok(diagnostics.some(step => step.with.path.includes('*.log')));
});

test('publication records full commit identity and immutable image digest', () => {
  const steps = workflow.jobs['build-and-push'].steps;
  const metadata = steps.find(step => step.uses?.startsWith('docker/metadata-action@'));
  assert.equal(metadata.with.flavor, 'latest=false');
  assert.match(metadata.with.tags, /type=sha,format=long/);
  assert.match(metadata.with.labels, /org\.opencontainers\.image\.revision=\$\{\{ github\.sha \}\}/);
  const provenance = steps.find(step => step.name === 'Record published image');
  assert.equal(provenance.env.IMAGE_DIGEST, '${{ steps.publish.outputs.digest }}');
  assert.ok(steps.some(step => step.uses?.startsWith('actions/upload-artifact@') && step.with.path.includes('published-image.json')));
});
