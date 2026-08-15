import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amount, assetUnit, bech32Address, hex64, hexString, jsonValue, poolId, stakeAddress } from './schemas.js';

const ADDR = 'addr_test1qqetxfc069tpemq25f954mrg2rxsr9jgvqe78hvyn9zuxxdvaqvlg96unszfywdfrjwq0m8zp0m7wjza0n2pfeep5h7qw62gd8';

test('bech32Address accepts payment + stake addresses, rejects garbage', () => {
  assert.ok(bech32Address.safeParse(ADDR).success);
  assert.ok(bech32Address.safeParse('stake_test1uqevw2xnsc0pvn9t9r9c7qryfqfeerchgrlm3ea2nefr9hqp8n5xl').success);
  assert.ok(!bech32Address.safeParse('addr_test1QQETX').success); // uppercase not bech32
  assert.ok(!bech32Address.safeParse('0x1234').success);
  assert.ok(!stakeAddress.safeParse(ADDR).success);
});

test('hex helpers enforce length / parity', () => {
  assert.ok(hex64('h').safeParse('2b8216b428b5292a4b13075cf37b26434f890a4ffcce1f75da1f85d2297efe83').success);
  assert.ok(!hex64('h').safeParse('2b8216').success);
  assert.ok(hexString('c').safeParse('84a4').success);
  assert.ok(!hexString('c').safeParse('84a').success);
  assert.ok(!hexString('c').safeParse('zz').success);
});

test('assetUnit = policyId + optional assetNameHex', () => {
  const policy = 'a'.repeat(56);
  assert.ok(assetUnit.safeParse(policy).success);
  assert.ok(assetUnit.safeParse(policy + '74657374').success);
  assert.ok(!assetUnit.safeParse(policy + '7').success);
  assert.ok(!assetUnit.safeParse('lovelace').success);
});

test('poolId bech32', () => {
  assert.ok(poolId.safeParse('pool1knap9hldvhww0fjqew26sxkfjpj3c8tp8uuj7j3729lzqn9x70r').success);
  assert.ok(!poolId.safeParse('knap9hldvhww0fjqew26sxkfjpj3c8tp8uuj7j3729lzqn9x70r').success);
});

test('amount normalises to a decimal string and rejects negatives / floats', () => {
  assert.equal(amount('a').parse('2000000'), '2000000');
  assert.equal(amount('a').parse(2000000), '2000000');
  assert.ok(!amount('a').safeParse(-1).success);
  assert.ok(!amount('a').safeParse(1.5).success);
  assert.ok(!amount('a').safeParse('1e6').success);
});

test('jsonValue accepts strings and native values, enforces kind, always yields a string', () => {
  const arr = jsonValue('x', 'array');
  assert.equal(arr.parse('[{"unit":"a","quantity":"1"}]'), '[{"unit":"a","quantity":"1"}]');
  assert.equal(arr.parse([{ unit: 'a', quantity: '1' }]), '[{"unit":"a","quantity":"1"}]');
  assert.ok(!arr.safeParse('{"a":1}').success);
  assert.ok(!arr.safeParse('not json').success);
  const obj = jsonValue('m', 'object');
  assert.equal(obj.parse({ 674: { msg: ['hi'] } }), '{"674":{"msg":["hi"]}}');
  assert.ok(!obj.safeParse('[1]').success);
});
