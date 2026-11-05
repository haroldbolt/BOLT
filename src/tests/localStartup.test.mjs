import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { BOLT_APP_ID, probeBoltHealth, trackStartup, waitForReady } from '../../scripts/local-startup.mjs';

const url = 'http://127.0.0.1:4327';
let passed = 0;
async function check(label, run) { await run(); passed++; console.log(`PASS: ${label}`); }
function clock() {
  let time = 0;
  return { now: () => time, wait: async ms => { time += ms; } };
}
function child(pid = 1234) { const result = new EventEmitter(); result.pid = pid; return result; }
const response = payload => ({ ok: true, json: async () => payload });

await check('solo acepta la identidad y el estado de Bolt Pets', async () => {
  assert.equal((await probeBoltHealth(url, { fetchImpl: async () => response({ appId: BOLT_APP_ID, status: 'ok' }) })).status, 'ready');
  assert.equal((await probeBoltHealth(url, { fetchImpl: async () => response({ appId: BOLT_APP_ID, status: 'starting' }) })).status, 'offline');
  assert.equal((await probeBoltHealth(url, { fetchImpl: async () => response({ appId: 'otra-app', status: 'ok' }) })).status, 'foreign');
});
await check('una conexión rechazada es falta de servidor y no una aplicación ajena', async () => {
  assert.equal((await probeBoltHealth(url, { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } })).status, 'offline');
});
await check('una respuesta HTML o HTTP inválida identifica un servicio diferente', async () => {
  assert.equal((await probeBoltHealth(url, { fetchImpl: async () => ({ ok: false }) })).status, 'foreign');
  assert.equal((await probeBoltHealth(url, { fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError('HTML'); } }) })).status, 'foreign');
});
await check('un inicio de 35 segundos supera el límite antiguo sin informar un fallo falso', async () => {
  const timer = clock(), progress = [];
  await waitForReady({ url, ...timer, probe: async () => ({ status: timer.now() >= 35_000 ? 'ready' : 'offline' }), onProgress: elapsed => progress.push(elapsed) });
  assert.equal(timer.now(), 35_000);
  assert.deepEqual(progress, [10, 20, 30]);
});
await check('guarda primero el PID nuevo y lo conserva cuando el servidor está listo', async () => {
  const timer = clock(), process = child(), records = [];
  await trackStartup({ child: process, url, root: 'PROYECTO-DE-PRUEBA', ...timer, writeMetadata: record => records.push(record), probe: async () => {
    assert.equal(records[0].status, 'starting'); assert.equal(records[0].pid, process.pid);
    return { status: timer.now() >= 20_000 ? 'ready' : 'offline' };
  } });
  assert.equal(records.at(-1).status, 'ready'); assert.equal(records.at(-1).pid, process.pid);
});
await check('si el proceso termina al iniciar informa el error sin esperar 90 segundos', async () => {
  const timer = clock(), process = child(), records = [];
  await assert.rejects(trackStartup({ child: process, url, root: 'PRUEBA', ...timer, writeMetadata: record => records.push(record), probe: async () => {
    if (timer.now() >= 1000) process.emit('exit', 1, null);
    return { status: 'offline' };
  } }), /terminó durante el inicio.*código 1/);
  assert.equal(timer.now(), 1000); assert.equal(records.at(-1).status, 'failed'); assert.equal(records.at(-1).pid, process.pid);
});
await check('un fallo de creación del proceso queda registrado sin un PID anterior', async () => {
  const timer = clock(), process = child(undefined), records = [];
  process.pid = undefined;
  await assert.rejects(trackStartup({ child: process, url, root: 'PRUEBA', ...timer, writeMetadata: record => records.push(record), probe: async () => {
    process.emit('error', new Error('ENOENT'));
    return { status: 'offline' };
  } }), /ENOENT/);
  assert.equal(records[0].pid, null); assert.equal(records.at(-1).status, 'failed');
});
await check('el vencimiento conserva el proceso nuevo como posiblemente iniciándose', async () => {
  const timer = clock(), process = child(), records = [];
  await assert.rejects(trackStartup({ child: process, url, root: 'PRUEBA', ...timer, writeMetadata: record => records.push(record), probe: async () => ({ status: 'offline' }) }), error => error.code === 'BOLT_START_TIMEOUT');
  assert.equal(timer.now(), 90_000); assert.equal(records.at(-1).pid, process.pid); assert.equal(records.at(-1).status, 'starting');
  assert.match(records.at(-1).lastError, /Puede seguir iniciándose/);
});
await check('un puerto ocupado se informa inmediatamente sin cerrar ningún proceso', async () => {
  const timer = clock();
  await assert.rejects(waitForReady({ url, ...timer, probe: async () => ({ status: 'foreign' }) }), error => error.code === 'BOLT_PORT_BUSY');
  assert.equal(timer.now(), 0);
});
await check('dos aperturas simultáneas pueden reutilizar Bolt sin conservar un PID terminado', async () => {
  const timer = clock(), process = child(), records = [];
  await trackStartup({ child: process, url, root: 'PRUEBA', ...timer, writeMetadata: record => records.push(record), probe: async () => {
    process.emit('exit', 1, null);
    return { status: 'ready' };
  } });
  assert.equal(records.at(-1).status, 'ready'); assert.equal(records.at(-1).reused, true); assert.equal(records.at(-1).pid, null);
});
console.log(`ARRANQUE LOCAL: ${passed} comprobaciones aprobadas.`);
