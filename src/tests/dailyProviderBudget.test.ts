import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDailyProviderBudget, secondsUntilBogotaMidnight } from '../lib/dailyProviderBudget';

test('independent provider counters persist across restarts and reset at Bogotá midnight', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bolt-budget-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const env = {NODE_ENV:'production', BOLT_PILOT_VOLUME:root, BOLT_DATA_DIR:root};
  let time = Date.parse('2026-02-03T04:59:30Z');
  assert.equal(secondsUntilBogotaMidnight(time), 30);
  const a = createDailyProviderBudget(env, () => time);
  const b = createDailyProviderBudget(env, () => time);
  assert.ok(a.take('photo', 1));
  assert.ok(b.take('maps', 1));
  assert.equal(b.take('photo', 1), false);
  assert.equal(a.take('maps', 1), false);
  time += 60000;
  assert.ok(b.take('photo', 1));
  fs.writeFileSync(path.join(root,'.bolt-private','provider-budget.json'), '{');
  assert.throws(() => a.take('maps', 1), /verificar/);
});
