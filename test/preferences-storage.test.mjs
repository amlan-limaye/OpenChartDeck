import test from 'node:test';
import assert from 'node:assert/strict';
import {readPrefs, sanitizePrefs, STORE_KEY, LEGACY_STORE_KEY} from '../public/core.mjs';

test('blocked browser storage returns defaults without attempting a write', () => {
  let reads = 0;
  let writes = 0;
  const storage = {
    getItem() { reads++; throw new Error('Storage access denied'); },
    setItem() { writes++; },
  };
  assert.deepEqual(readPrefs(storage), sanitizePrefs({}));
  assert.equal(reads, 1);
  assert.equal(writes, 0);
});

test('corrupt current preferences do not resurrect stale legacy selections', () => {
  const values = new Map([
    [STORE_KEY, '{invalid JSON'],
    [LEGACY_STORE_KEY, JSON.stringify({active: 'Indices', selections: {PLTR: 'AAPL'}})],
  ]);
  const before = new Map(values);
  const reads = [];
  let writes = 0;
  const storage = {
    getItem(key) { reads.push(key); return values.get(key) ?? null; },
    setItem() { writes++; },
  };
  assert.deepEqual(readPrefs(storage), sanitizePrefs({}));
  assert.deepEqual(reads, [STORE_KEY]);
  assert.deepEqual(values, before);
  assert.equal(writes, 0);
});
