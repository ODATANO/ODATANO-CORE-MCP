import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trimResult } from './output.js';

test('trimResult caps arrays and appends a truncation notice', () => {
  const out = trimResult({ value: [1, 2, 3, 4, 5] }, { maxRows: 3 }) as { value: unknown[] };
  assert.equal(out.value.length, 4);
  assert.deepEqual(out.value.slice(0, 3), [1, 2, 3]);
  assert.match(String(out.value[3]), /2 more item\(s\) truncated/);
});

test('trimResult elides long CBOR fields unless keepCbor', () => {
  const cbor = 'a'.repeat(10000);
  const nested = { build: { unsignedTxCbor: cbor, fee: '170000' }, note: 'x'.repeat(10000) };
  const trimmed = trimResult(nested, { maxRows: 50 }) as { build: { unsignedTxCbor: string; fee: string }; note: string };
  assert.match(trimmed.build.unsignedTxCbor, /^<unsignedTxCbor: 10000 hex chars elided/);
  assert.equal(trimmed.build.fee, '170000');
  assert.equal(trimmed.note.length, 10000); // non-CBOR keys untouched
  const kept = trimResult(nested, { maxRows: 50, keepCbor: true }) as { build: { unsignedTxCbor: string } };
  assert.equal(kept.build.unsignedTxCbor, cbor);
});

test('trimResult leaves short CBOR and primitives alone', () => {
  const short = { unsignedTxCbor: '84a4', n: 1, b: true, z: null };
  assert.deepEqual(trimResult(short, { maxRows: 5 }), short);
});
