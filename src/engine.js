// Local paper execution only. Never sends orders or requests to a broker.
export const DEFAULTS = Object.freeze({ initialBalance: 10000, riskPercent: 1, stopPercent: 0.25, rewardRatio: 1.8, maxLossPercent: 3, fastPeriod: 8, slowPeriod: 21 });
export const MARKETS = Object.freeze({ EURUSD: { name: 'Euro / US Dollar', base: 1.0845, decimals: 5 }, GBPUSD: { name: 'British Pound / US Dollar', base: 1.2713, decimals: 5 }, USDJPY: { name: 'US Dollar / Japanese Yen', base: 149.62, decimals: 3 }, BTCUSD: { name: 'Bitcoin / US Dollar', base: 67420, decimals: 2 } });
export function validateSettings(input) {
  const s = { ...DEFAULTS, ...input };
  const ranges = { initialBalance: [100, 1000000], riskPercent: [0.1, 2], stopPercent: [0.05, 5], rewardRatio: [1, 5], maxLossPercent: [0.5, 10], fastPeriod: [2, 30], slowPeriod: [3, 100] };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (typeof s[key] !== 'number' || !Number.isFinite(s[key]) || s[key] < min || s[key] > max) throw new Error(`${key} must be between ${min} and ${max}.`);
  }
  if (!Number.isInteger(s.fastPeriod) || !Number.isInteger(s.slowPeriod) || s.fastPeriod >= s.slowPeriod) throw new Error('Moving-average periods must be integers; fast must be smaller than slow.');
  return s;
}
export function ema(values, period) {
  if (values.length < period) return null;
  let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) value += (values[i] - value) * k;
  return value;
}
export function crossover(prices, fast = 8, slow = 21) {
  if (prices.length < slow + 1) return 'WAIT';
  const previous = prices.slice(0, -1);
  const f0 = ema(previous, fast), s0 = ema(previous, slow);
  const f1 = ema(prices, fast), s1 = ema(prices, slow);
  if (f0 <= s0 && f1 > s1) return 'BUY';
  if (f0 >= s0 && f1 < s1) return 'SELL';
  return 'WAIT';
}
export class PaperEngine {
  constructor(settings = {}) {
    this.settings = validateSettings(settings);
    this.balance = this.settings.initialBalance;
    this.equity = this.balance;
    this.running = false;
    this.halted = false;
    this.position = null;
    this.trades = [];
    this.events = [];
    this.nextId = 1;
    this.equityHistory = [this.balance];
    this.log('Paper account ready. Broker connection disabled.');
  }
  log(message, type = 'info') {
    this.events.unshift({ message, type, time: Date.now() });
    this.events = this.events.slice(0, 60);
  }
  start() {
    if (this.halted) throw new Error('Session loss limit reached. Reset the paper account to start a new session.');
    this.running = true;
    this.log('Strategy started. Monitoring for EMA crossovers.', 'success');
  }
  pause() {
    this.running = false;
    this.log('New entries paused. Open-position protection remains active.');
  }
  updateSettings(input) {
    if (this.running || this.position) throw new Error('Pause the strategy and close the position before changing risk settings.');
    this.settings = validateSettings({ ...this.settings, ...input, initialBalance: this.settings.initialBalance });
    this.log('Risk settings updated.');
  }
  open(side, price, symbol, time = Date.now()) {
    if (!this.running || this.halted || this.position) return false;
    if (!['BUY', 'SELL'].includes(side) || !Number.isFinite(price) || price <= 0 || !MARKETS[symbol]) throw new Error('Invalid paper order.');
    const stopDistance = price * this.settings.stopPercent / 100;
    // Cap notional to equity (no leverage), in addition to risk-based sizing.
    const quantity = Math.min(this.balance * this.settings.riskPercent / 100 / stopDistance, this.balance / price);
    const direction = side === 'BUY' ? 1 : -1;
    this.position = { id: this.nextId++, side, symbol, entry: price, quantity, stop: price - direction * stopDistance, target: price + direction * stopDistance * this.settings.rewardRatio, openedAt: time, unrealized: 0 };
    this.log(`${side} ${symbol} paper position opened.`, 'success');
    return true;
  }
  close(price, reason = 'Manual close', time = Date.now()) {
    if (!this.position) return null;
    if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid closing price.');
    const p = this.position;
    const pnl = (price - p.entry) * p.quantity * (p.side === 'BUY' ? 1 : -1);
    const trade = { ...p, exit: price, pnl, reason, closedAt: time };
    this.balance += pnl;
    this.equity = this.balance;
    this.position = null;
    this.trades.unshift(trade);
    this.trades = this.trades.slice(0, 500);
    this.log(`Paper trade #${p.id} closed: ${reason}. ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}.`, pnl >= 0 ? 'success' : 'warning');
    this.checkLimit();
    return trade;
  }
  checkLimit() {
    if (this.equity <= this.settings.initialBalance * (1 - this.settings.maxLossPercent / 100)) {
      if (!this.halted) this.log('Session loss limit reached. Strategy locked until account reset.', 'warning');
      this.halted = true;
      this.running = false;
    }
  }
  tick(price, symbol, prices, time = Date.now()) {
    if (!Number.isFinite(price) || price <= 0 || !MARKETS[symbol]) throw new Error('Invalid market tick.');
    let closed = false;
    if (this.position && this.position.symbol === symbol) {
      const p = this.position, long = p.side === 'BUY';
      p.unrealized = (price - p.entry) * p.quantity * (long ? 1 : -1);
      this.equity = this.balance + p.unrealized;
      const stopHit = long ? price <= p.stop : price >= p.stop;
      const targetHit = long ? price >= p.target : price <= p.target;
      const lossHit = this.equity <= this.settings.initialBalance * (1 - this.settings.maxLossPercent / 100);
      if (stopHit || targetHit || lossHit) {
        // Fill at observed price: gaps may exceed configured loss limits.
        this.close(price, lossHit ? 'Session loss limit' : stopHit ? 'Stop loss' : 'Take profit', time);
        closed = true;
      }
    }
    this.checkLimit();
    const signal = crossover(prices, this.settings.fastPeriod, this.settings.slowPeriod);
    if (!closed && !this.position && this.running && !this.halted && signal !== 'WAIT') this.open(signal, price, symbol, time);
    this.equityHistory.push(this.equity);
    this.equityHistory = this.equityHistory.slice(-240);
    return signal;
  }
}
// Synthetic geometric random walk; these are NOT market quotes or a backtest.
export function nextPrice(previous, random = Math.random) {
  return previous * Math.exp((random() - 0.5) * 0.0014);
}
