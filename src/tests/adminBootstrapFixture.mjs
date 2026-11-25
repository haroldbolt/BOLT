import { randomUUID, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../', import.meta.url));

// Exercise the same out-of-band authorization used by operations, inside disposable directories.
export function adminBootstrapFixture(volume, email, runtime = volume) {
  const control = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-admin-control-test-'));
  const env = {
    BOLT_ADMIN_CONTROL_DIR: control, BOLT_ADMIN_VOLUME_DIR: volume,
    BOLT_ADMIN_INSTALLATION_ID: randomUUID(), BOLT_ADMIN_SETUP_TOKEN: randomBytes(32).toString('hex'),
  };
  const dispose = () => fs.rmSync(control, { recursive: true, force: true });
  try {
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/admin-bootstrap.ts', 'prepare',
      path.join(runtime, 'src/data/persisted-admin-auth.json')], {
      cwd: source, env: { PATH: process.env.PATH, ...env, BOLT_ADMIN_BOOTSTRAP_EMAIL: email }, stdio: 'pipe',
    });
    return { env, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

export async function establishFixtureAdmin(origin, email, password, setupToken) {
  const url = new URL(origin);
  if (url.origin !== origin || url.hostname !== '127.0.0.1') throw Error('El fixture requiere un servidor local.');
  const status = await fetch(origin + '/api/v1/auth/status').then(r => r.json());
  if (status.setupState === 'closed') return;
  const result = await fetch(origin + '/api/v1/auth/setup-admin', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bolt-Admin-Setup-Token': setupToken },
    body: JSON.stringify({ email, password, name: 'Coordinación de prueba' }),
  });
  if (result.status !== 201) throw Error('No se pudo preparar el personal del fixture: HTTP ' + result.status);
}
