/** Current committed workflows against an isolated production image. No live access. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateBrowserInputs(config, candidate) {
  const expected = config.imageRepository + '@sha256:';
  assert(typeof candidate === 'string' && candidate.startsWith(expected) && /^[a-f0-9]{64}$/.test(candidate.slice(expected.length)), 'Expected immutable candidate in configured repository');
  assert.match(config.candidateRevision ?? '', /^[a-f0-9]{40}$/);
  assert.match(config.configHash ?? '', /^[a-f0-9]{64}$/);
  assert.match(config.githubRunId ?? '', /^[1-9][0-9]*$/, 'Pin the CI run before browser staging');
  assert.match(config.sshHost ?? '', /^[a-zA-Z0-9_.-]+@[a-zA-Z0-9][a-zA-Z0-9.-]*$/);
  assert.match(config.resourcePrefix ?? '', /^[a-z][a-z0-9-]{2,39}$/);
  for (const port of [config.localPort, config.remotePort]) assert(Number.isInteger(port) && port >= 1024 && port <= 65535);
  for (const [key, pattern] of [['browserFiles', /^[A-Za-z0-9_-]+\.spec\.ts$/], ['browserHelpers', /^[A-Za-z0-9_-]+\.ts$/]]) {
    assert(Array.isArray(config[key]) && config[key].length && config[key].every(name => pattern.test(name)));
    assert.equal(new Set(config[key]).size, config[key].length);
  }
  assert(config.browserHelpers.includes('helpers.ts'));
  assert(path.isAbsolute(config.repositoryRoot) && path.isAbsolute(config.outputDirectory));
}

export async function runBrowserStaging(settings, candidate) {
  validateBrowserInputs(settings, candidate);
  process.umask(0o077);
  const root = settings.repositoryRoot;
  const revision = settings.candidateRevision;
  const sshHost = settings.sshHost;
  const dockerHost = `ssh://${sshHost}`;
  const {localPort, remotePort} = settings;
  const projects = ['chromium', 'mobile-safari'];
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), revision, 'Browser source checkout must match image revision');
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), '', 'Browser source checkout must be clean');
  const files = settings.browserFiles;
  const helpers = settings.browserHelpers;
  fs.mkdirSync(settings.outputDirectory, {recursive:true, mode:0o700});
  fs.chmodSync(settings.outputDirectory, 0o700);
  const marker = path.join(settings.outputDirectory, '.release-owner.json');
  if (fs.existsSync(marker)) assert.deepEqual(JSON.parse(fs.readFileSync(marker, 'utf8')), {configHash:settings.configHash});
  else fs.writeFileSync(marker, JSON.stringify({configHash:settings.configHash}), {flag:'wx',mode:0o600});
  const owner = randomUUID();
  const directory = fs.mkdtempSync(path.join(settings.outputDirectory, 'browser-'));
  fs.chmodSync(directory, 0o700);
  // Private output can live outside the checkout; copied specs still resolve
  // exactly this checkout's installed Playwright and helper dependencies.
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
  const cases = path.join(directory, 'cases'); fs.mkdirSync(cases);
  const app = `${settings.resourcePrefix}-browser-${owner}`;
  const volume = `${settings.resourcePrefix}-browser-data-${owner}`;
  const ownerLabel = 'io.magni.release.owner';
  const baseURL = `http://127.0.0.1:${localPort}`;
  const docker = (...args) => execFileSync('docker', ['--host', dockerHost, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
  }).trim();
  let appCreated = false, volumeCreated = false, tunnel, browserProcess;
  let tunnelError;
  let interrupted = false;
  const result = {
    configHash: settings.configHash, status: 'running', startedAt: new Date().toISOString(), directory, owner,
    candidate, revision, projects, baseURL, dockerHost, sourceTests: {}, cleanupErrors: [],
    liveDataUsed: false, productionRuntime: true, physicalIPhone: false, releaseEvidence: true,
    authentication: 'Only register/registerViaApi fixture setup is adapted to pre-issued disposable accounts in the owned staging database; normal application auth/ownership checks remain active. Disposable account rounding/timezone preferences are configured through the real settings API to match the browser. Registration UI/routes are covered by the development-server CI suite; production allowlist and rate-limit policies have unit coverage. This rehearsal uses pre-issued fixture accounts.',
  };
  const save = () => fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  const hash = content => createHash('sha256').update(content).digest('hex');
  function currentCommitted(relative) {
    const disk = fs.readFileSync(path.join(root, relative));
    const committed = execFileSync('git', ['show', `HEAD:${relative}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    assert.deepEqual(disk, committed, `${relative} has uncommitted changes; image/source verification would be invalid`);
    return disk;
  }
  function ownedContainer() {
    assert(appCreated);
    const state = JSON.parse(docker('inspect', '--format', '{{json .}}', app));
    assert.equal(state.Config.Labels?.[ownerLabel], owner);
    return state;
  }
  function ownedVolume() {
    assert(volumeCreated);
    const state = JSON.parse(docker('volume', 'inspect', '--format', '{{json .}}', volume));
    assert.equal(state.Labels?.[ownerLabel], owner);
  }
  const abort = () => {
    interrupted = true;
    browserProcess?.kill('SIGTERM');
  };
  process.on('SIGINT', abort); process.on('SIGTERM', abort);
  async function ready() {
    for (let attempt = 0; attempt < 120; attempt++) {
      assert(!interrupted, 'Rehearsal interrupted');
      assert.equal(ownedContainer().State.Running, true);
      assert(!tunnelError, tunnelError);
      if (tunnel?.exitCode !== null) throw new Error('Owned SSH tunnel exited; check ssh-tunnel.log');
      let response;
      try { response = await fetch(baseURL + '/api/health', { signal: AbortSignal.timeout(1_000) }); } catch { /* starting */ }
      if (response?.ok) { assert.deepEqual(await response.json(), { status: 'ok', revision }); return; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('Production staging image did not become ready');
  }
  function stopProcess(child) {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise(resolve => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    });
  }
  save();
  try {
    for (const name of [...files, ...helpers]) {
      const content = currentCommitted(`tests/e2e/${name}`);
      result.sourceTests[name] = hash(content);
      fs.writeFileSync(path.join(cases, name), content);
    }
    for (const name of fs.readdirSync(path.join(root, 'examples/programs')).filter(name => name.endsWith('.magni.json'))) { const relative = 'examples/programs/' + name; result.sourceTests[relative] = hash(currentCommitted(relative)); }
    const sourceHelpers = fs.readFileSync(path.join(cases, 'helpers.ts'), 'utf8');
    const from = sourceHelpers.indexOf('export async function register(');
    const to = sourceHelpers.indexOf('export async function login(');
    assert(from >= 0 && to > from, 'Helper registration boundaries changed; inspect before adapting');
    assert(sourceHelpers.slice(from, to).includes('export async function registerViaApi('));
    // Accounts are created lazily per registration call, so added/renamed tests
    // do not depend on a hard-coded label list or test count. This helper refuses
    // every database target except this run's labelled disposable container.
    const seedCode = String.raw`
  const Database=require('better-sqlite3'),argon2=require('argon2');
  (async()=>{const db=new Database('/data/workouts.db');db.pragma('busy_timeout=5000');
  try {const input=JSON.parse(process.argv[1]);const passwordHash=await argon2.hash(input.password);
  const row=db.transaction(()=>{const user=db.prepare('INSERT INTO users(email,password_hash) VALUES (?,?)').run(input.email,passwordHash);
  db.prepare('INSERT INTO auth_sessions(user_id,token,expires_at) VALUES (?,?,?)').run(user.lastInsertRowid,input.token,input.expires);
  return {id:Number(user.lastInsertRowid),email:input.email};}).immediate();console.log(JSON.stringify(row));
  }finally{db.close();}})().catch(error=>{console.error(error.message);process.exitCode=1});`;
    const adaptedRegistration = `
  async function stagingAccount(page: Page, label: string) {
    const dockerHost = ${JSON.stringify(dockerHost)};
    const container = ${JSON.stringify(app)};
    const run = (...args: string[]) => execFileSync('docker', ['--host', dockerHost, ...args], { encoding: 'utf8', timeout: 30000, stdio: ['ignore','pipe','pipe'] }).trim();
    expect(run('inspect','--format','{{index .Config.Labels "${ownerLabel}"}}',container)).toBe(${JSON.stringify(owner)});
    const email = 'staging-' + randomUUID() + '@example.test';
    const password = 'disposable-' + randomUUID();
    const token = randomBytes(32).toString('hex');
    const expires = new Date(Date.now()+2*60*60*1000);
    const user = JSON.parse(run('exec',container,'node','-e',${JSON.stringify(seedCode)},JSON.stringify({email,password,token,expires:expires.toISOString().slice(0,19).replace('T',' ')})));
    await page.context().addCookies([{name:'auth_token',value:token,url:${JSON.stringify(baseURL)},httpOnly:true,sameSite:'Lax',expires:Math.floor(expires.getTime()/1000)}]);
    const response = await page.request.get('/api/auth/me');
    expect(response.ok(), 'Disposable fixture auth: '+label).toBe(true);
    expect(await response.json()).toEqual(user);
    // The server runs in UTC while this browser can be in another timezone.
    // Set the disposable account's training timezone through the real settings API.
    const timezone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect((await page.request.post('/api/settings', {data:{rounding:2.5,timezone}})).ok()).toBe(true);
    expect(await (await page.request.get('/api/settings')).json()).toMatchObject({timezone});
    return {email,password};
  }
  export async function register(page: Page, label: string): Promise<{email:string;password:string}> {
    const account = await stagingAccount(page,label);
    await page.goto('/today');
    await expect(page.getByRole('heading',{name:'Today',exact:true})).toBeVisible();
    return account;
  }
  export async function registerViaApi(page: Page, label: string): Promise<{email:string;password:string}> {
    return stagingAccount(page,label);
  }
  `;
    fs.writeFileSync(path.join(cases, 'helpers.ts'), `import { execFileSync } from 'node:child_process';\nimport { randomUUID, randomBytes } from 'node:crypto';\n` + sourceHelpers.slice(0, from) + adaptedRegistration + sourceHelpers.slice(to));
    const config = path.join(directory, 'playwright.config.ts');
    fs.writeFileSync(config, `import {defineConfig,devices} from '@playwright/test';
  export default defineConfig({testDir:'./cases',fullyParallel:false,workers:1,retries:0,forbidOnly:true,timeout:120000,
    outputDir:'./results',reporter:[['list'],['json',{outputFile:'./browser-result.json'}]],
    use:{baseURL:${JSON.stringify(baseURL)},trace:'retain-on-failure'},
    projects:[${projects.map(name => `{name:${JSON.stringify(name)},use:{...devices[${JSON.stringify(name === 'chromium' ? 'Desktop Chrome' : 'iPhone 15')}]}}`).join(',')}]
  });\n`);
    const cli = path.join(root, 'node_modules/@playwright/test/cli.js');
    const listed = JSON.parse(execFileSync(process.execPath, [cli, 'test', '--config', config, '--list', '--reporter=json'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
    assert.deepEqual(listed.errors, []);
    const listTests = suites => suites.flatMap(suite => [...(suite.specs ?? []).flatMap(spec => spec.tests.map(test => ({ file: spec.file, title: spec.title, project: test.projectName }))), ...listTests(suite.suites ?? [])]);
    const manifest = listTests(listed.suites);
    assert(manifest.length > 0);
    fs.writeFileSync(path.join(directory, 'workflow-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    result.expectedBrowserCases = manifest.length;
    const image = JSON.parse(docker('image', 'inspect', '--format', '{{json .}}', candidate));
    assert.equal(image.Config.Labels?.['org.opencontainers.image.revision'], revision);
    assert.equal(image.Os, 'linux');
    result.imageId = image.Id;
    docker('volume', 'create', '--label', `${ownerLabel}=${owner}`, volume); volumeCreated = true;
    ownedVolume();
    docker('create', '--name', app, '--label', `${ownerLabel}=${owner}`, '--label', 'com.centurylinklabs.watchtower.enable=false',
      '--mount', `type=volume,src=${volume},dst=/data`, '--publish', `127.0.0.1:${remotePort}:3000`, candidate);
    appCreated = true;
    docker('start', app);
    const tunnelLog = fs.openSync(path.join(directory, 'ssh-tunnel.log'), 'w', 0o600);
    tunnel = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-N', '-L', `${localPort}:127.0.0.1:${remotePort}`, sshHost], { stdio: ['ignore', tunnelLog, tunnelLog] });
    tunnel.once('error', error => { tunnelError = error.message; });
    fs.closeSync(tunnelLog);
    await ready();
    assert.equal(docker('exec', app, 'id', '-u'), '1000');
    assert.match(docker('exec', app, 'node', '--version'), /^v22\./);
    save();
    const browserLog = fs.openSync(path.join(directory, 'browser.log'), 'w', 0o600);
    const exitCode = await new Promise((resolve, reject) => {
      browserProcess = spawn(process.execPath, [cli, 'test', '--config', config, '--fail-on-flaky-tests'], {
        cwd: root, env: { ...process.env, E2E_NAV_DIAGNOSTICS: '1' }, stdio: ['ignore', browserLog, browserLog],
      });
      fs.closeSync(browserLog);
      browserProcess.once('error', reject); browserProcess.once('exit', (code, signal) => resolve(signal ? 1 : code));
    });
    assert.equal(exitCode, 0, 'Production browser workflows failed; inspect browser.log/results');
    assert(!interrupted, 'Rehearsal interrupted');
    const report = JSON.parse(fs.readFileSync(path.join(directory, 'browser-result.json'), 'utf8'));
    assert.equal(report.stats.expected, manifest.length);
    for (const name of ['unexpected', 'flaky', 'skipped']) assert.equal(report.stats[name], 0, `${name} browser cases are not acceptable`);
    assert.deepEqual(report.errors, []);
    // Detect edits made while tests ran: evidence must stay attached to the SHA.
    for (const [name, expectedHash] of Object.entries(result.sourceTests)) assert.equal(hash(currentCommitted(name.startsWith('examples/') ? name : `tests/e2e/${name}`)), expectedHash);
    result.browserCases = report.stats.expected;
    result.browserRetries = 0;
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed'; result.error = error instanceof Error ? error.message : String(error); process.exitCode = 1;
  } finally {
    await stopProcess(browserProcess); await stopProcess(tunnel);
    if (appCreated) {
      try {
        const state = ownedContainer();
        fs.writeFileSync(path.join(directory, 'server.log'), docker('logs', app) + '\n', { mode: 0o600 });
        if (state.State.Running) docker('stop', '--time', '15', app);
        ownedContainer(); docker('rm', app); appCreated = false;
      } catch (error) { result.cleanupErrors.push({ resource: app, error: error.message }); }
    }
    if (volumeCreated && !appCreated) {
      try { ownedVolume(); docker('volume', 'rm', volume); volumeCreated = false; }
      catch (error) { result.cleanupErrors.push({ resource: volume, error: error.message }); }
    }
    if (result.cleanupErrors.length) { result.status = 'failed'; process.exitCode = 1; }
    result.ownedStagingResourcesRemoved = !appCreated && !volumeCreated;
    result.finishedAt = new Date().toISOString(); save();
    process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort);
    console.log(JSON.stringify({ status: result.status, result: path.join(directory, 'result.json'), cases: result.browserCases, error: result.error, cleanupErrors: result.cleanupErrors }));
  }

  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 6, 'Usage: browser-staging.mjs --config FILE --candidate IMAGE');
  assert.equal(process.argv[2], '--config'); assert.equal(process.argv[4], '--candidate');
  const configScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'config.py');
  const settings = JSON.parse(execFileSync('python3', [configScript, '--config', process.argv[3]], {encoding:'utf8'}));
  await runBrowserStaging(settings, process.argv[5]);
}
