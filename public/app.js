import { PaperEngine, MARKETS, nextPrice, ema } from '/src/engine.js';

const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const signed = n => `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`;
const time = t => new Date(t).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false });
let engine = new PaperEngine();
let symbol = 'EURUSD';
let tab = 'positions';
let toastTimer;
let lastEventTime = null;
const feeds = {};
function createFeeds() {
  for (const [key, market] of Object.entries(MARKETS)) {
    let price = market.base;
    feeds[key] = [];
    for (let i = 0; i < 120; i++) {
      const open = price;
      price = nextPrice(price);
      feeds[key].push({ open, close: price, high: Math.max(open, price) * (1 + Math.random() * .00018), low: Math.min(open, price) * (1 - Math.random() * .00018), time: Date.now() - (120 - i) * 1000 });
    }
  }
}
createFeeds();
function priceOf(key = symbol) { return feeds[key].at(-1).close; }
function formatPrice(price, key = symbol) { return price.toFixed(MARKETS[key].decimals); }
function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
}
$('toggle-bot').addEventListener('click', () => {
  try { engine.running ? engine.pause() : engine.start(); render(); }
  catch (error) { toast(error.message); }
});
$('settings-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    engine.updateSettings({ riskPercent: Number($('risk').value), maxLossPercent: Number($('max-loss').value), stopPercent: Number($('stop').value), rewardRatio: Number($('reward').value) });
    toast('Risk settings applied to future paper trades.');
    render();
  } catch (error) { toast(error.message); }
});
$('market').addEventListener('change', event => {
  if (engine.position) {
    event.target.value = symbol;
    toast('Close the open position before switching markets.');
    return;
  }
  symbol = event.target.value;
  engine.log(`Watching ${symbol}. Synthetic feed selected.`);
  render();
});
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => {
  tab = button.dataset.tab;
  renderTrades();
});
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => {
  for (const item of document.querySelectorAll('[data-view]')) item.classList.toggle('active', item === button);
  const view = button.dataset.view;
  $('page-label').textContent = { overview: 'Overview', activity: 'Trade history', strategy: 'Strategy & risk' }[view];
  if (view === 'activity') { tab = 'history'; renderTrades(); }
  $(view === 'activity' ? 'activity-section' : view === 'strategy' ? 'strategy-section' : 'overview-section').scrollIntoView({ behavior: 'smooth', block: 'center' });
});
$('reset').addEventListener('click', () => $('reset-dialog').showModal());
$('reset-dialog').addEventListener('close', () => {
  if ($('reset-dialog').returnValue !== 'confirm') return;
  engine = new PaperEngine();
  lastEventTime = null;
  createFeeds();
  $('risk').value = 1; $('max-loss').value = 3; $('stop').value = .25; $('reward').value = 1.8;
  tab = 'positions';
  render();
  toast('Paper account reset to $10,000. Strategy is paused.');
});
$('export').addEventListener('click', () => {
  if (!engine.trades.length) { toast('No closed paper trades to export yet.'); return; }
  const columns = ['id', 'symbol', 'side', 'entry', 'exit', 'quantity', 'pnl', 'reason', 'openedAt', 'closedAt'];
  const rows = engine.trades.map(t => columns.map(key => ['openedAt', 'closedAt'].includes(key) ? new Date(t[key]).toISOString() : t[key]));
  const csv = [columns, ...rows].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = 'orbit-paper-trades.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Paper trade history exported.');
});
function render() {
  const pnl = engine.equity - engine.settings.initialBalance;
  const wins = engine.trades.filter(t => t.pnl > 0).length;
  $('equity').textContent = money(engine.equity);
  $('total-return').textContent = signed(pnl);
  $('total-return').className = `stat-value ${pnl >= 0 ? 'positive' : 'negative'}`;
  $('return-percent').textContent = `${pnl >= 0 ? '+' : ''}${(pnl / engine.settings.initialBalance * 100).toFixed(2)}%`;
  $('return-percent').className = pnl >= 0 ? 'positive' : 'negative';
  $('win-rate').textContent = engine.trades.length ? `${(wins / engine.trades.length * 100).toFixed(1)}%` : '—';
  $('win-count').textContent = `${wins} wins / ${engine.trades.length} trades`;
  $('trade-count').textContent = engine.trades.length;
  $('bot-status').textContent = engine.halted ? 'Risk locked' : engine.running ? 'Running' : 'Standby';
  $('bot-status').className = `stat-value status-value ${engine.running ? 'positive' : engine.halted ? 'negative' : ''}`;
  $('status-light').className = `status-light ${engine.running ? 'running' : ''}`;
  $('status-description').textContent = engine.halted ? 'Session loss limit reached' : engine.running ? engine.position ? 'Managing paper position' : 'Waiting for a crossover' : 'New entries paused';
  $('toggle-bot').textContent = engine.running ? 'Ⅱ  Pause strategy' : '▶  Start strategy';
  $('toggle-bot').disabled = engine.halted;
  for (const input of $('settings-form').querySelectorAll('input, button')) input.disabled = engine.running || Boolean(engine.position);
  $('market').disabled = Boolean(engine.position);
  $('market-name').textContent = MARKETS[symbol].name;
  $('asset-type').textContent = symbol === 'BTCUSD' ? 'CRYPTO' : 'FOREX';
  $('price').textContent = formatPrice(priceOf());
  const move = (priceOf() / feeds[symbol][0].open - 1) * 100;
  $('price-change').textContent = `${move >= 0 ? '+' : ''}${move.toFixed(2)}% · simulated window`;
  $('price-change').className = move >= 0 ? 'positive' : 'negative';
  $('fast-label').textContent = engine.settings.fastPeriod;
  $('slow-label').textContent = engine.settings.slowPeriod;
  $('clock').textContent = `${time(Date.now())} UTC`;
  $('chart-time').textContent = `${time(Date.now())} UTC`;
  renderTrades();
  const eventKey = engine.events.map(e => `${e.time}:${e.message}`).join('|');
  if (lastEventTime !== eventKey) {
    lastEventTime = eventKey;
    $('events').replaceChildren(...engine.events.map(event => {
      const row = document.createElement('div'); row.className = `event ${event.type}`;
      const dot = document.createElement('span'); dot.className = 'event-dot';
      const content = document.createElement('div');
      const text = document.createElement('p'); text.textContent = event.message;
      const stamp = document.createElement('time'); stamp.textContent = `${time(event.time)} UTC`; stamp.dateTime = new Date(event.time).toISOString();
      content.append(text, stamp); row.append(dot, content); return row;
    }));
  }
  drawChart();
}
function renderTrades() {
  for (const button of document.querySelectorAll('[data-tab]')) button.classList.toggle('selected', button.dataset.tab === tab);
  $('position-count').textContent = engine.position ? '1' : '0';
  $('exit-heading').textContent = tab === 'positions' ? 'CURRENT PRICE' : 'EXIT PRICE';
  $('action-heading').textContent = tab === 'positions' ? 'ACTION' : 'CLOSED (UTC)';
  const trades = tab === 'positions' ? engine.position ? [engine.position] : [] : engine.trades;
  $('empty-state').hidden = trades.length > 0;
  $('empty-state').querySelector('strong').textContent = tab === 'positions' ? 'No open positions. Room to be deliberate.' : 'Your trading story starts here.';
  $('empty-state').querySelector('p').textContent = tab === 'positions' ? 'Start the strategy to watch for the next crossover.' : 'Closed paper trades will appear here. Nothing is live.';
  $('trade-summary').textContent = tab === 'positions' ? 'Paper execution only · No fees or spread modeled' : `${engine.trades.length} closed trades · Current browser session only`;
  $('trades-body').replaceChildren(...trades.map(trade => {
    const row = document.createElement('tr');
    const market = document.createElement('td');
    const label = document.createElement('strong'); label.textContent = trade.symbol;
    const side = document.createElement('small'); side.textContent = `${trade.side} · ${trade.quantity.toFixed(4)} units`; side.className = trade.side === 'BUY' ? 'side-buy' : 'side-sell';
    market.append(label, side); row.append(market);
    for (const value of [formatPrice(trade.entry, trade.symbol), formatPrice(tab === 'positions' ? priceOf(trade.symbol) : trade.exit, trade.symbol)]) { const td = document.createElement('td'); td.textContent = value; row.append(td); }
    const pnl = tab === 'positions' ? trade.unrealized : trade.pnl;
    const pnlCell = document.createElement('td'); pnlCell.textContent = signed(pnl); pnlCell.className = pnl >= 0 ? 'positive' : 'negative';
    pnlCell.title = tab === 'positions' ? `Stop: ${formatPrice(trade.stop, trade.symbol)} / Target: ${formatPrice(trade.target, trade.symbol)}` : trade.reason;
    row.append(pnlCell);
    const action = document.createElement('td');
    if (tab === 'positions') {
      const button = document.createElement('button'); button.className = 'table-close'; button.textContent = 'Close';
      button.addEventListener('click', () => { engine.close(priceOf(trade.symbol)); render(); }); action.append(button);
      const protections = document.createElement('small'); protections.textContent = `SL ${formatPrice(trade.stop, trade.symbol)} · TP ${formatPrice(trade.target, trade.symbol)}`; action.append(protections);
    } else { action.textContent = time(trade.closedAt); const reason = document.createElement('small'); reason.textContent = trade.reason; action.append(reason); }
    row.append(action); return row;
  }));
}
function drawChart() {
  const canvas = $('price-chart');
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(bounds.width * dpr); canvas.height = Math.round(bounds.height * dpr);
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const width = bounds.width, height = bounds.height;
  const left = 12, top = 20, right = width - 68, bottom = height - 29;
  const all = feeds[symbol];
  const candles = all.slice(-70);
  const values = candles.flatMap(c => [c.high, c.low]);
  const position = engine.position;
  if (position?.symbol === symbol) values.push(position.stop, position.target);
  const min = Math.min(...values), max = Math.max(...values);
  const padding = Math.max((max - min) * .15, min * .00005);
  const low = min - padding, high = max + padding;
  const y = value => bottom - (value - low) / (high - low) * (bottom - top);
  const step = (right - left) / candles.length;
  const x = i => left + (i + .5) * step;
  ctx.font = '9px -apple-system, sans-serif';
  for (let i = 0; i < 5; i++) {
    const yy = top + (bottom - top) * i / 4;
    ctx.strokeStyle = '#23303a'; ctx.lineWidth = .5; ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(right, yy); ctx.stroke();
    ctx.fillStyle = '#647887'; ctx.fillText(formatPrice(high - (high - low) * i / 4), right + 8, yy + 3);
  }
  for (let i = 4; i < candles.length; i += 14) {
    ctx.strokeStyle = '#1c2831'; ctx.beginPath(); ctx.moveTo(x(i), top); ctx.lineTo(x(i), bottom); ctx.stroke();
    ctx.fillStyle = '#5d7382'; ctx.fillText(time(candles[i].time).slice(0, 8), x(i) - 16, height - 9);
  }
  candles.forEach((c, i) => {
    ctx.strokeStyle = ctx.fillStyle = c.close >= c.open ? '#70bca1' : '#a16c77';
    ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x(i), y(c.high)); ctx.lineTo(x(i), y(c.low)); ctx.stroke();
    const bodyTop = Math.min(y(c.open), y(c.close));
    ctx.fillRect(x(i) - Math.max(2, step * .55) / 2, bodyTop, Math.max(2, step * .55), Math.max(1.2, Math.abs(y(c.open) - y(c.close))));
  });
  const closes = all.map(c => c.close);
  for (const [period, color] of [[engine.settings.fastPeriod, '#bfde7e'], [engine.settings.slowPeriod, '#778fdf']]) {
    ctx.strokeStyle = color; ctx.lineWidth = 1.3; ctx.beginPath(); let begun = false;
    candles.forEach((c, i) => {
      const avg = ema(closes.slice(0, all.length - candles.length + i + 1), period);
      if (avg === null) return;
      if (!begun) { ctx.moveTo(x(i), y(avg)); begun = true; } else ctx.lineTo(x(i), y(avg));
    }); ctx.stroke();
  }
  function line(value, color, label) {
    const yy = y(value); ctx.strokeStyle = color; ctx.lineWidth = .7; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(right, yy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = color; ctx.fillRect(right + 3, yy - 8, 64, 16); ctx.fillStyle = '#101b18'; ctx.font = '9px -apple-system, sans-serif'; ctx.fillText(label, right + 7, yy + 3);
  }
  line(priceOf(), '#94c9ad', formatPrice(priceOf()));
  if (position?.symbol === symbol) { line(position.stop, '#dc8b87', 'SL'); line(position.target, '#c5df8c', 'TP'); }
}
new ResizeObserver(drawChart).observe($('price-chart').parentElement);
setInterval(() => {
  for (const key of Object.keys(MARKETS)) {
    const open = priceOf(key), close = nextPrice(open);
    feeds[key].push({ open, close, high: Math.max(open, close) * (1 + Math.random() * .00018), low: Math.min(open, close) * (1 - Math.random() * .00018), time: Date.now() });
    feeds[key] = feeds[key].slice(-240);
  }
  engine.tick(priceOf(), symbol, feeds[symbol].map(c => c.close));
  render();
}, 1000);
render();
