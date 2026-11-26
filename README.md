# Orbit — paper trading workspace

A dependency-free, local paper-trading dashboard built with Node.js and browser JavaScript. **This is not connected to market-qx.info or any broker. It cannot place real trades or guarantee profits.**

The requested demo page could not be retrieved during development. No official API, trading permissions, instrument specifications, or payout model have been verified. This project intentionally does not automate the site's login, scrape authenticated sessions, or use private broker endpoints.

## Run

Requires Node.js 20 or newer.

```sh
npm start
# Open http://localhost:3000
```

The server listens on `0.0.0.0:3000` for hosted previews. Override with `PORT=4000 npm start`. There are no runtime dependencies, credentials, database, or broker network calls.

```sh
npm test
```

## Use

1. Open the dashboard. The strategy starts **paused** with $10,000 of virtual funds.
2. Select a synthetic instrument. The prices are random simulations, not current or historical quotes.
3. Set risk per trade, stop distance, reward/risk, and session loss limit; apply settings.
4. Start the strategy. The next fast/slow EMA crossover opens a paper long or short position. Signals are not guaranteed to arrive immediately.
5. Pause to disable new entries. **Stops and take-profit checks continue while the page is running.** You can also close a position manually.
6. Review trade history and export closed trades as CSV. Reset starts a fresh, paused account.

Account state is in browser memory only. **Reloading or closing the page loses the session; export first.** Background-tab throttling and device sleep can delay simulated ticks. This is not an unattended trading service.

## Strategy and risk assumptions

- EMA 8 / EMA 21 crossover, calculated on synthetic one-second ticks. Tick periods are not minute candles.
- One open position at a time. Changing markets is blocked while a position is open.
- Quantity is the smaller of risk-based sizing and an equity-sized notional cap (no leverage).
- Risk per trade is an upper bound at the configured stop price, not a guarantee. The notional cap can make actual planned risk lower.
- Long and short P&L use a simplified USD-quoted linear model, including for the USD/JPY simulation. Real FX currency conversion, contract sizes, and margin are **not** modeled.
- Stops/targets fill at the next observed synthetic price. Gaps can exceed stops and the session loss limit.
- Session loss threshold is based on initial account equity, including unrealized P&L; it is not a calendar-day limit or trailing drawdown limit. Reaching it closes the position and locks entries until reset.
- No spread, commissions, slippage beyond observed-tick gaps, financing, liquidity, or latency model.
- No optimization, predictive model, profitability claim, backtest, or verified performance.
- **This is a spot-style P&L simulator, not a binary-options/fixed-expiry payout simulator.** Its results cannot be transferred to a platform with different instrument/payout rules.

## Project layout

- `src/engine.js`: pure paper-execution engine, signal calculation, validation, synthetic prices.
- `public/`: responsive dashboard, canvas chart, controls, trade history, CSV export.
- `server.js`: allowlisted static server with security headers; no execution API.
- `test/engine.test.js`: Node test runner coverage for sizing, signals, exits, pausing, and risk lockout.

## Before considering a real integration

A separate, reviewed broker adapter and backend would be needed. First obtain the platform's official API documentation and confirm automation is permitted and legally available to you. Verify the operator, applicable licensing, account eligibility, product risks, and exact payout model independently.

Any future adapter should begin with a broker-supported demo account, store narrowly scoped API keys server-side, never accept browser session cookies/passwords, reconcile orders and fills, handle reconnects and duplicate-order prevention, enforce server-side account-level limits, and support an emergency stop. Live execution is deliberately absent, not a hidden toggle. Do not treat simulated wins as evidence of future profit.
