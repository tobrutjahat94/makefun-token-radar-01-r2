# First Light — a token-radar-01 entry

A pre-token launch board: 198 protocols ranked by **shrunk implied value** — the
geometric mean of each protocol's own raw value (TVL × category peer multiple ×
growth × maturity) and the median of its pseudo-peers — with the middle-half range
beside every number, a farm verdict net of gas on every row, the method box, the
market line and the farm-next rail on the same screen.

## The model, in one paragraph

A protocol's token, if it ever launches, is priced off the tokens that already
trade. The peer multiple is the median market-cap / TVL of live-token protocols in
its category (global median when a category has fewer than three peers). Raw value
is TVL × multiple, pushed up or down by seven-day growth (clipped −50% / +100%,
weighted 0.4) and by maturity (0.7 plus up to 0.3 over 1,095 days listed with no
token; an unlisted age counts as 365 days). Then shrinkage: the board number is the
geometric mean of the raw value and the median of up to 20 pseudo-peers — same
category, TVL within 3×. The range beside it is the peers' middle half, widened to
at least the typical miss when peers are thin. Farm verdicts price a $1,000 position
over 8 weeks at 2 hours of the farmer's time against a drop pool of 7% of the shrunk
value and the gas of the main chain: farm clears $5/hr net, thin clears $1/hr, the
rest is skip.

## Honesty, printed on the board

The model was run out of sample on the 119 live-token protocols, each left out of
its own peer multiple: the typical miss is about **×3.6**, within 2× about 28% of
the time and within 3× about 40%. Implied values are estimates, not prices, and
"records no token" is not proof a protocol has none.

## Run it

```sh
# inside the sealed /input, /output mounts of the make.fun grader:
node main.ts
# or locally, against the kit snapshot:
MAKEFUN_OUTPUT_DIR=out node main.ts --input kits/token-radar-01/token-radar-01-kit/input/snapshot.json
```

Node 22, standard library only. Two runs write byte-identical `/output`.

## Layout

- `main.ts` — entrypoint: reads the snapshot, builds the board, writes
  `board.json` + `data.js`, copies `dashboard/` and `screenshots/`, writes
  `dossier.json` through the vendored library.
- `lib/radar.ts` — the model: snapshot parsing, peer multiples, shrunk values,
  farm verdicts and plans, the market line, the out-of-sample miss.
- `vendor/makefun-board.ts` — the make.fun library, copied byte-for-byte from
  the competition kit.
- `dashboard/` — `index.html` + `app.css` + `app.js`; a static page with no
  framework and no network. It renders the board, the method box, the market-line
  chart, the farm-next rail and a detail view for every protocol, and it
  recomputes each row's shrunk point from the snapshot figures so the page's
  arithmetic and `board.json`'s number are visibly the same.
- `screenshots/` — the board, a detail view and the farm filter at 1440×900.
