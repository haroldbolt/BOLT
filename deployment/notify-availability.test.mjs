import assert from 'node:assert/strict';
import { execFile, fork, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const filename = fileURLToPath(import.meta.url);
const cli = fileURLToPath(new URL('./notify-availability.mjs', import.meta.url));

async function listen(server, port) {
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

if (process.argv[2] === 'fixture') {
  const tls = { key: await fs.readFile(process.argv[3]), cert: await fs.readFile(process.argv[4]) };
  const fixture = https.createServer(tls, (req, res) => {
    if (req.method !== 'GET' || !['/api/v1/health', '/api/v1/stores'].includes(req.url)) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    const ids = ['HUB_ALAMOS', 'HUB_KENNEDY', 'HUB_SUBA'];
    res.end(JSON.stringify(req.url.endsWith('/health')
      ? {status: 'ok', service: 'Bolt Pets Authoritative Backend', timezone: 'America/Bogota', storesCount: ids.length, timestamp: new Date().toISOString()}
      : ids.map(id => ({ id, isActive: true, name: id }))));
  });
  process.send(await listen(fixture, Number(process.argv[5])));
} else {
  test('receptor independiente recibe caída y recuperación, incluso si se pierde la confirmación del primer aviso', {timeout: 30_000}, async t => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bolt-monitor-'));
    t.after(() => fs.rm(tmp, {recursive: true, force: true}));
    const key = path.join(tmp, 'tls.key'), cert = path.join(tmp, 'tls.pem');
    const tls = spawnSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=127.0.0.1',
      '-addext','subjectAltName=IP:127.0.0.1','-keyout',key,'-out',cert]);
    assert.equal(tls.status, 0, 'OpenSSL debe poder crear una CA temporal de loopback.');
    let fixture, port = 0;
    async function startApp() {
      fixture = fork(filename, ['fixture', key, cert, String(port)], {execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
      port = (await once(fixture, 'message'))[0];
    }
    async function stopApp() {
      if (!fixture) return;
      const exited = once(fixture, 'exit');
      fixture.kill('SIGTERM');
      await exited;
      fixture = undefined;
    }
    t.after(stopApp);

    const attempts = [], delivered = new Map();
    const receiver = https.createServer({key: await fs.readFile(key), cert: await fs.readFile(cert)}, async (req, res) => {
      assert.equal(req.method, 'POST');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const event = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(req.headers['idempotency-key'], event.id);
      assert.deepEqual(Object.keys(event).sort(), ['id', 'service', 'signal', 'timestamp']);
      attempts.push(event.id);
      delivered.set(event.id, event.signal);
      if (attempts.length === 1) return; // Receiver accepted the event but did not acknowledge before timeout.
      res.writeHead(204).end();
    });
    const receiverPort = await listen(receiver, 0);
    t.after(async () => {
      const closed = once(receiver, 'close');
      receiver.close();
      receiver.closeAllConnections();
      await closed;
    });
    await startApp();
    const env = {
      NODE_EXTRA_CA_CERTS: cert,
      BOLT_MONITOR_ORIGIN: 'https://127.0.0.1:' + port,
      BOLT_MONITOR_WEBHOOK_URL: 'https://127.0.0.1:' + receiverPort + '/private-fixture?token=synthetic-test-marker',
      BOLT_MONITOR_STATE_FILE: path.join(tmp, 'state.json'),
      BOLT_MONITOR_TIMEOUT_MS: '650',
    };
    async function sample() {
      try {
        const {stdout} = await promisify(execFile)(process.execPath, [cli], {env});
        return {code: 0, report: JSON.parse(stdout)};
      } catch (error) {
        return {code: error.code, report: JSON.parse(error.stdout)};
      }
    }
    assert.equal((await sample()).code, 0);
    assert.equal(attempts.length, 0);
    await stopApp();
    const timeout = await sample();
    assert.equal(timeout.code, 3);
    assert.equal(timeout.report.notification, 'PENDING');
    const timeoutState = await fs.readFile(env.BOLT_MONITOR_STATE_FILE, 'utf8');
    assert.ok(!timeoutState.includes(env.BOLT_MONITOR_WEBHOOK_URL));
    assert.doesNotMatch(timeoutState + JSON.stringify(timeout.report), /private-fixture|synthetic-test-marker/);
    assert.equal(attempts.length, 1);
    assert.equal((await sample()).code, 1);
    assert.equal((await sample()).code, 1);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0], attempts[1]);
    await startApp();
    assert.equal((await sample()).code, 0);
    assert.equal((await sample()).code, 0);
    assert.deepEqual([...delivered.values()], ['down', 'recovered']);
    assert.equal(attempts.length, 3);
    assert.deepEqual(JSON.parse(await fs.readFile(env.BOLT_MONITOR_STATE_FILE, 'utf8')).pending, []);
  });
}
