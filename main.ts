// Dip-buy mean-reversion bot for btc-race-24h-20261115-0828.
//
// The dev window (1,440 one-minute bars of CBBTC) falls about 4% peak to trough with one sharp
// +5% bounce off its low near bar 1037, so a trend-following entry gets whipsawed: on this window
// an EMA-12/48 crossover with an ATR filter loses about $23, and every EMA variant tried
// (8/21, 12/26, 10/30, 8/34; TP 1-4%, SL 0.7-2%; with and without a long-SMA regime filter)
// loses between $23 and $148. What works here is buying a real dislocation and selling the
// reversion: the close 2% or more below its own 2-hour average, then out when the close is back
// at that average, or at +2% / -1.5% from entry cost. That rule is positive across SMA lengths
// 120, 150 and 180 at the same 2% distance (+$13 to +$18 on the dev window), so it is the
// distance that carries it, not one tuned length.
//
//   - Entry, on a bar's close (filled at the next open): the close sits at least 2% below the
//     SMA(120) of closes, or at least 2% below the SMA(60), while flat, and 10 bars have passed
//     since the last exit. One position at a time, full equity.
//   - Exit, the whole position: the close is back at or above the SMA(120), or the position is
//     worth 2% over its cost, or 1.5% under it. The exit conditions are levels, not edges, so a
//     sell the market refuses (a gap past the slippage cap at the next open) is sent again on the
//     next bar while its reason still holds; an entry refused the same way is retried while the
//     dislocation lasts.
//   - Sizing: 100% of cash on entry (min 1 USDC notional is far below it), capped by the
//     weight room. max_slippage_bps 50: fills run about 2 bps of modelled slippage plus roughly
//     15 bps of pool impact at this depth, so 50 bps of headroom keeps real fills in while a
//     gap at the open is refused rather than chased.
//   - State is two running sums over the last 120 closes (O(1) a bar); no wall clock, no
//     randomness, no files, no network, so two runs give the same orders.
//
// The bot reads every batch, a warm-up's included, to seed the averages, and sends no order
// while warming up (the replay would reject every one).

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** The long average's span in bars (2 hours of 1-minute bars). */
const SMA_LONG = 120;
/** The short average's span in bars (1 hour). */
const SMA_SHORT = 60;
/** A close this far below its average, in bps, is a dislocation worth buying. */
const DIP_BPS = 200;
/** Take profit: the position worth this far over its cost, in bps. */
const TP_BPS = 200;
/** Stop loss: the position worth this far under its cost, in bps. */
const SL_BPS = 150;
/** Bars to wait after an exit before re-entering. */
const COOLDOWN_BARS = 10;
/** Slippage cap on every order, in bps from the latest close. */
const MAX_SLIPPAGE_BPS = 50;

/** The last closes, trimmed so it never grows past two long windows. */
const closes: number[] = [];
/** Running sums of the last SMA_LONG / SMA_SHORT closes. */
let sumLong = 0;
let sumShort = 0;
/** The seq of the batch an exit was decided on, plus the cooldown; -1 while never exited. */
let coolUntil = -1;

/** Fold one close into both running sums. */
function pushClose(close: number): void {
  if (closes.length >= SMA_LONG) sumLong -= closes[closes.length - SMA_LONG]!;
  if (closes.length >= SMA_SHORT) sumShort -= closes[closes.length - SMA_SHORT]!;
  closes.push(close);
  sumLong += close;
  sumShort += close;
  if (closes.length > 2 * SMA_LONG) {
    closes.splice(0, SMA_LONG);
  }
}

/** The mean of the last `span` closes, or null before that many have been seen. */
function mean(span: number, sum: number): number | null {
  return closes.length >= span ? sum / span : null;
}

/** Whether the position exits on this close: back at its long average, or past TP / SL. */
function exits(state: BarsState, held: { qty: bigint; cost: bigint }, longMean: number | null): boolean {
  const close = state.close(SYMBOL);
  if (close !== null && longMean !== null && Number(close) >= longMean) return true;
  const value = state.value(SYMBOL, held.qty);
  if (value * 10_000n >= held.cost * BigInt(10_000 + TP_BPS)) return true;
  if (value * 10_000n <= held.cost * BigInt(10_000 - SL_BPS)) return true;
  return false;
}

await runBars({
  onBatch(state, batch) {
    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      pushClose(Number(bar.c));
    }
    if (state.warmingUp) return [];
    const longMean = mean(SMA_LONG, sumLong);
    const shortMean = mean(SMA_SHORT, sumShort);
    const close = state.close(SYMBOL);
    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      if (exits(state, held, longMean)) {
        coolUntil = state.seq + COOLDOWN_BARS;
        const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }
    if (close === null || longMean === null || shortMean === null) return [];
    if (state.seq < coolUntil) return [];
    const dislocated = Number(close) * 10_000 < longMean * (10_000 - DIP_BPS)
      || Number(close) * 10_000 < shortMean * (10_000 - DIP_BPS);
    if (!dislocated) return [];
    let notional = state.cash;
    const room = state.weightRoom(SYMBOL);
    if (notional > room) notional = room;
    if (notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    const buy: BuyInput = { side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS };
    return [buy];
  },
});
