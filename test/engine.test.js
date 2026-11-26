import test from 'node:test';
import assert from 'node:assert/strict';
import { PaperEngine, crossover, ema, validateSettings, nextPrice } from '../src/engine.js';

test('account starts paused with virtual funds', () => {
  const e = new PaperEngine();
  assert.equal(e.balance, 10000);
  assert.equal(e.running, false);
  assert.equal(e.open('BUY', 100, 'BTCUSD'), false);
});
test('settings reject non-finite and unsafe values', () => {
  for (const settings of [{ riskPercent: NaN }, { riskPercent: Infinity }, { riskPercent: 3 }, { stopPercent: 0 }, { initialBalance: -1 }, { maxLossPercent: 0 }, { fastPeriod: 21, slowPeriod: 8 }, { fastPeriod: 2.5 }, { riskPercent: '1' }]) assert.throws(() => validateSettings(settings));
});
test('EMA and crossover signals', () => {
  assert.equal(ema([1, 2], 3), null);
  assert.equal(ema([1, 2, 3], 3), 2);
  assert.equal(crossover([1, 2, 3]), 'WAIT');
  assert.equal(crossover([5, 4, 3, 2, 1, 8], 2, 4), 'BUY');
  assert.equal(crossover([1, 2, 3, 4, 5, 1], 2, 4), 'SELL');
});
test('paper order sizing never exceeds equity or configured stop risk', () => {
  const e = new PaperEngine(); e.start(); e.open('BUY', 100, 'BTCUSD');
  const p = e.position;
  assert.ok(p.quantity * p.entry <= e.balance);
  assert.ok(p.quantity * Math.abs(p.entry - p.stop) <= e.balance * .01);
  assert.equal(e.open('SELL', 100, 'EURUSD'), false);
});
test('long stop loss closes at observed price and realizes loss', () => {
  const e = new PaperEngine(); e.start(); e.open('BUY', 100, 'BTCUSD');
  e.tick(99.7, 'BTCUSD', [100, 99.7]);
  assert.equal(e.position, null);
  assert.equal(e.trades[0].reason, 'Stop loss');
  assert.ok(Math.abs(e.balance - 9970) < 1e-8);
});
test('short take profit produces a gain', () => {
  const e = new PaperEngine(); e.start(); e.open('SELL', 100, 'BTCUSD');
  e.tick(99, 'BTCUSD', [100, 99]);
  assert.equal(e.trades[0].reason, 'Take profit');
  assert.equal(e.balance, 10100);
});
test('paused strategy still enforces protective stops', () => {
  const e = new PaperEngine(); e.start(); e.open('BUY', 100, 'BTCUSD'); e.pause();
  e.tick(99, 'BTCUSD', [100, 99]);
  assert.equal(e.position, null);
  assert.equal(e.balance, 9900);
  assert.equal(e.running, false);
});
test('session loss circuit breaker locks after a gap and blocks restart', () => {
  const e = new PaperEngine(); e.start(); e.open('BUY', 100, 'BTCUSD');
  e.tick(95, 'BTCUSD', [100, 95]);
  assert.equal(e.balance, 9500);
  assert.equal(e.running, false);
  assert.equal(e.halted, true);
  assert.equal(e.position, null);
  assert.throws(() => e.start(), /loss limit/);
  assert.equal(e.open('BUY', 95, 'BTCUSD'), false);
});
test('risk settings cannot be changed while running or with an open position', () => {
  const e = new PaperEngine(); e.start();
  assert.throws(() => e.updateSettings({ riskPercent: .5 }));
  e.open('BUY', 100, 'BTCUSD'); e.pause();
  assert.throws(() => e.updateSettings({ riskPercent: .5 }));
  e.close(100); e.updateSettings({ riskPercent: .5 });
  assert.equal(e.settings.riskPercent, .5);
});
test('unrealized P&L updates equity without changing balance', () => {
  const e = new PaperEngine(); e.start(); e.open('BUY', 100, 'BTCUSD');
  e.tick(100.1, 'BTCUSD', [100, 100.1]);
  assert.ok(Math.abs(e.equity - 10010) < 1e-8);
  assert.equal(e.balance, 10000);
});
test('invalid quotes and orders are rejected', () => {
  const e = new PaperEngine(); e.start();
  assert.throws(() => e.open('HOLD', 100, 'BTCUSD'));
  assert.throws(() => e.open('BUY', -1, 'BTCUSD'));
  assert.throws(() => e.tick(NaN, 'BTCUSD', []));
  assert.throws(() => e.tick(100, 'UNKNOWN', []));
});
test('synthetic feed is positive and deterministic with injected randomness', () => {
  assert.equal(nextPrice(100, () => .5), 100);
  assert.ok(nextPrice(100, () => 0) > 0);
});
test('signals trigger automatic paper orders only after start', () => {
  const e = new PaperEngine({ fastPeriod: 2, slowPeriod: 4 });
  const prices = [5, 4, 3, 2, 1, 8];
  e.tick(8, 'EURUSD', prices);
  assert.equal(e.position, null);
  e.start(); e.tick(8, 'EURUSD', prices);
  assert.equal(e.position.side, 'BUY');
});
