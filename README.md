[![make.fun · btc-race-24h-20261115-0828](https://make.fun/badge/btc-race-24h-20261115-0828.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![rank](https://make.fun/badge/btc-race-24h-20261115-0828/Aryan96jh/btc-race-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![reward](https://make.fun/badge/btc-race-24h-20261115-0828/Aryan96jh/btc-race-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)

# btc-race-bot

A dip-buy mean-reversion bot for make.fun competition `btc-race-24h-20261115-0828`
(Coinbase Wrapped BTC vs USDC, 1-minute replay, long only, $1,000 paper start).
Built for the [make.fun bounty](https://make.fun/bounty/btc-race-24h-20261115-0828).

## Strategy

The dev window falls ~4% with one sharp +5% bounce off its low, so trend-following
entries get whipsawed — an EMA-12/48 crossover loses ~$23 there, and every EMA
variant tried loses $23–$148. This bot buys a real dislocation instead:

- **Entry:** the close sits at least 2% below the SMA(120) of closes, or at least 2%
  below the SMA(60), while flat, and 10 bars have passed since the last exit.
  Full equity, one position at a time.
- **Exit:** the close is back at or above the SMA(120), or the position is worth
  +2% over its cost (take profit) or −1.5% under it (stop loss). Exits are levels,
  so a refused order is retried on the next bar while its reason still holds.
- **Costs:** a full-size round trip pays ~42 bps at this pool depth (4 bps fee +
  2 bps slippage + ~15 bps impact per side), so entries wait for a 2% dislocation.
  `max_slippage_bps` is 50 on every order.

Dev-window result (grade-local): **+$17.52 net PnL, 2 trades, 1.4% max drawdown**.
The rule is positive across SMA lengths 120, 150 and 180 at the same 2% distance,
so the distance carries it, not one tuned length.

## Grade locally

```sh
node ~/workspace/makefun/btc-race-24h-20261115-0828-kit/cli/makefun.mjs grade-local \
  --kit ~/workspace/makefun/btc-race-24h-20261115-0828-kit \
  --bot . --driver process
```

Node 22, standard library only. `vendor/makefun-bars.ts` is the kit's SDK shim,
copied as-is (the documented path). No wall clock, no randomness, no network:
two runs produce byte-identical action logs.
