import test from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal, toMinor } from '../src/lib/money.ts';
test('cart uses exact minor units, validates quantities and overflow', () => {
  assert.equal(cartTotal([{ price: '0.10', quantity: 3 }, { price: '0.20', quantity: 1 }]), 50);
  assert.equal(cartTotal([]), 0);
  assert.equal(toMinor('12500.05'), 1250005);
  for (const price of ['-1', 'NaN', '1.001', '', '1e3']) assert.throws(() => toMinor(price));
  for (const quantity of [0, -1, 1.5, Infinity]) assert.throws(() => cartTotal([{ price: 1, quantity }]));
  assert.throws(() => cartTotal([{ price: '90071992547409', quantity: 2 }]));
});
