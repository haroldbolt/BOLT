import assert from 'node:assert/strict';
import test from 'node:test';
import { boltAdmin } from '../components/admin-next/adminClient';
import { AdminRequestError, adminSetupState, adminSignInFailure, adminStatusFailure } from '../lib/adminAccessStatus';

test('el formulario de alta requiere autorización explícita y coherente de la instalación', () => {
  assert.equal(adminSetupState({ setupState: 'open', isSetupRequired: true }), 'open');
  assert.equal(adminSetupState({ setupState: 'closed', isSetupRequired: false }), 'closed');
  assert.equal(adminSetupState({ setupState: 'recovery-required', isSetupRequired: false }), 'recovery-required');
  assert.equal(adminSetupState({ isSetupRequired: false }), 'closed');
  assert.throws(() => adminSetupState({ isSetupRequired: true }));
  assert.throws(() => adminSetupState({ setupState: 'open', isSetupRequired: false }));
});

test('un alta concurrente consulta otra vez el estado y cambia el formulario a ingreso', async () => {
  const denied = new AdminRequestError('No se pudo completar el alta', 409);
  const outcome = await adminSignInFailure(denied, 'open', async () => 'closed');
  assert.equal(outcome.state, 'closed');
  assert.match(outcome.message, /Ingresa con tu cuenta/);
  assert.equal((await adminSignInFailure(new AdminRequestError('Código inválido', 403), 'open', async () => 'open')).state, 'open');
  assert.equal((await adminSignInFailure(denied, 'open', async () => { throw Error('Sin conexión'); })).state, null);
});

test('el cliente reconoce recuperación autorizada y distingue una caída del servicio', async context => {
  const fetcher = context.mock.method(globalThis, 'fetch', async () => Response.json({
    error: 'Mensaje privado de diagnóstico', code: 'ADMIN_RECOVERY_REQUIRED',
  }, { status: 503 }));
  await assert.rejects(boltAdmin.authStatus(), error => {
    assert.deepEqual(adminStatusFailure(error), { state: 'recovery-required', message: '' });
    return true;
  });
  assert.equal(fetcher.mock.calls.length, 1);
  assert.equal(adminStatusFailure(new AdminRequestError('Error de servidor', 503)).state, null);
});
