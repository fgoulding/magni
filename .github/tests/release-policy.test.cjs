const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');

const root = path.resolve(__dirname, '../..');
const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/docker-publish.yml'), 'utf8'));

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

test('verification installs both browser engines and runs the complete release runner', () => {
  const commands = workflow.jobs.verify.steps.map(step => step.run ?? '').join('\n');
  assert.match(commands, /npm ci/);
  assert.match(commands, /playwright install --with-deps chromium webkit/);
  assert.match(commands, /node scripts\/release-check\.mjs/);
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
