/** Single-writer, durable demo launcher; no changes to production endpoints or data. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { createDemoGateway } from './demo-gateway.mjs';
import { demoCustomerEnvironment } from './customer-environment.mjs';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(process.env.BOLT_DEMO_VOLUME || '/data');
const runtime = path.join(root, 'bolt-dispatch-simulation-meeting');
const data = path.join(runtime, '.bolt-private/orders');
const localTest = process.argv.includes('--local-test') && process.env.NODE_ENV !== 'production';
const origin = process.env.BOLT_DEMO_PUBLIC_ORIGIN || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
const password = process.env.BOLT_DEMO_PASSWORD;
const port = Number(process.env.PORT || 8080);
const upstreamPort = Number(process.env.BOLT_DEMO_INTERNAL_PORT || 3030);
if (!origin || !password || password.length < 16 || !Number.isInteger(port) || port === upstreamPort)
  throw Error('Configure BOLT_DEMO_PUBLIC_ORIGIN, a private BOLT_DEMO_PASSWORD (16+ characters), and distinct ports.');
if (root === source || root.startsWith(source + path.sep)) throw Error('Use an independent persistent demo volume.');
fs.mkdirSync(root, { recursive: true });
// The exclusive runtime writer lock is acquired by the unchanged BOLT server.
if (!fs.existsSync(runtime)) {
  const staging = path.join(root, 'bolt-dispatch-simulation-initializing');
  if (fs.existsSync(staging)) throw Error('Interrupted initialization detected. Inspect the isolated staging directory before retrying; no files were deleted.');
  execFileSync(process.execPath, ['--import', 'tsx', 'src/tests/createIntegrationReview.ts', staging], { cwd: source, stdio: 'pipe' });
  fs.writeFileSync(path.join(staging, '.bolt-private/hosted-demo.json'), JSON.stringify({ version: 1, kind: 'BOLT_MEETING_DEMO', base: 'f02f688205745021c473f7237b04c499488ef63b', createdAt: new Date().toISOString() }), { mode: 0o600 });
  fs.renameSync(staging, runtime);
}
const marker = JSON.parse(fs.readFileSync(path.join(runtime, '.bolt-private/hosted-demo.json'), 'utf8'));
if (marker.version !== 1 || marker.kind !== 'BOLT_MEETING_DEMO') throw Error('This is not a supported demo volume.');
// Reject incompatible storage readers before refreshing code, preserving all current business files.
execFileSync(process.execPath, ['--import', 'tsx', 'scripts/fulfillment-storage.ts', 'check', data, source], { cwd: source, stdio: 'pipe' });
for (const name of ['server.js', 'storage-contract.json', 'dist', 'src', 'scripts', 'package.json']) {
  fs.cpSync(path.join(source, name), path.join(runtime, name), {
    recursive: true,
    filter: p => !path.basename(p).startsWith('persisted-') && !['.bolt-private', '.bolt-storage'].includes(path.basename(p)),
  });
}
const signingFile = path.join(runtime, '.bolt-private/demo-session-key');
if (!fs.existsSync(signingFile)) fs.writeFileSync(signingFile, crypto.randomBytes(48).toString('base64url'), { mode: 0o600, flag: 'wx' });
const customer = demoCustomerEnvironment(process.env, origin);
const gateway = createDemoGateway({ customerAuth: customer, origin, password, sessionKey: fs.readFileSync(signingFile, 'utf8'), upstreamPort, allowLocalHttp: localTest });
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(BOLT_|SHOPIFY_|RAILWAY_)/.test(name)));
Object.assign(childEnv, customer.env, { NODE_ENV: 'production', PORT: String(upstreamPort), BOLT_DISPATCH_SIMULATION: '1', BOLT_DATA_DIR: data });
// The compatible storage check above is the same check used by the normal launcher.
// Own the actual server PID so graceful container restarts can release only its locks.
const child = spawn(process.execPath, [path.join(runtime, 'server.js')], { cwd: runtime, env: childEnv, stdio: ['ignore', 'inherit', 'inherit'] });
let stopping = false;
function stop() { if (stopping) return; stopping = true; gateway.close(); child.kill('SIGTERM'); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
child.on('error', () => { console.error('Demo process could not start.'); stop(); process.exitCode = 1; });
child.on('exit', code => {
  for (const directory of [runtime, data]) {
    const lock = path.join(directory, '.bolt-private/catalog-writer.lock');
    if (fs.existsSync(lock) && fs.readFileSync(lock, 'utf8') === String(child.pid)) fs.unlinkSync(lock);
  }
  gateway.close(); process.exitCode = stopping ? 0 : code || 1;
});
gateway.listen(port, localTest ? '127.0.0.1' : '0.0.0.0', () => console.log('Private BOLT demo gateway started. Waiting for backend health.'));
