import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startupProblemCode } from '../lib/startupDiagnostics';

test('startup reports schema/role failures without emitting connection details', () => {
  assert.equal(startupProblemCode(new Error('Customer database migration required: run customer:migrate explicitly')), 'CUSTOMER_SCHEMA_MIGRATION_REQUIRED');
  assert.equal(startupProblemCode(new Error('Customer database requires a restricted role without BYPASSRLS')), 'CUSTOMER_DATABASE_ROLE_UNSAFE');
  const unknown = new Error('unexpected value that should remain private');
  assert.equal(startupProblemCode(unknown), 'STARTUP_UNCLASSIFIED');
  assert.equal(startupProblemCode(Object.assign(unknown, {code: '28P01'})), 'DATABASE_LOGIN_FAILED');
  assert.equal(startupProblemCode(null), 'STARTUP_UNCLASSIFIED');
});
