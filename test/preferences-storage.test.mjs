import test from 'node:test';
import assert from 'node:assert/strict';
import {readPrefs, sanitizePrefs, STORE_KEY, LEGACY_STORE_KEY} from '../public/core.mjs';

test('blocked browser storage returns defaults without attempting a write', () => {
  let reads = 0;
  const storage = {
    getItem() { reads++; throw new Error('Storage access denied'); },
    setItem() { assert.fail('Reading preferences must not write storage'); },
  };
  assert.deepEqual(readPrefs(storage), sanitizePrefs({}));
  assert.equal(reads, 1);
});

test('corrupt current preferences do not resurrect stale legacy selections', () => {
  const values = new Map([
    [STORE_KEY, '{invalid JSON'],
    [LEGACY_STORE_KEY, JSON.stringify({active: 'Indices', selections: {PLTR: 'AAPL'}})],
  ]);
  const before = new Map(values);
  const reads = [];
  const storage = {
    getItem(key) { reads.push(key); return values.get(key) ?? null; },
    setItem() { assert.fail('Corrupt preferences must remain available for recovery'); },
  };
  assert.deepEqual(readPrefs(storage), sanitizePrefs({}));
  assert.deepEqual(reads, [STORE_KEY]);
  assert.deepEqual(values, before);
});
