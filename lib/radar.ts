// First Light — the radar model for token-radar-01, round 2.
//
// One snapshot of DefiLlama's protocol index in, one ranked board out. Every number on
// the board is derived from the snapshot's own figures: a protocol's TVL, its seven-day
// TVL change, and how long it has been listed with no token on record. No protocol name
// is ever special-cased, and no row is hand-picked: the same functions score all 758.
//
// The model in four moves:
//
//   1. Peer multiple. A protocol's token, if it ever launches, is priced off the tokens
//      that already trade in its own category: the median market-cap-to-TVL ratio of the
//      live-token protocols in that category (at least three peers, else the whole
//      market's median). A lending protocol is priced like lending, not like a bridge.
//   2. Raw value. TVL x peer multiple, pushed up or down by seven-day growth and by
//      maturity: the longer a protocol has run with no token, the closer its launch.
//   3. Shrinkage. The raw number is pulled toward the middle of its pseudo-peers —
//      pre-token protocols in the same category whose TVL sits within 3x, nearest
//      twenty by size. The board's number is the geometric mean of the protocol's own
//      raw value and its peer median, and the range on the board is the middle half of
//      the peer values, widened to at least the typical miss when peers are thin.
//   4. Honesty check. The same model is run on the protocols whose tokens already
//      trade, leaving each protocol out of its own peer multiple, and the board states
//      how far the model's numbers usually land from the market's: the typical miss.
//
// The farm verdict is a separate, stated calculation: a $1,000 position farmed for eight
// weeks, at two hours of the farmer's time, against a drop pool of 7% of the shrunk
// implied value and the gas of the protocol's main chain. Farm when the net pay clears
// $5 an hour, thin between $1 and $5, skip below that. The numbers are the board's
// own claim, and the board prints the assumptions beside the verdicts.

/** One protocol record: exactly the ten fields the sealed snapshot carries. */
export interface Proto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface Snap {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

/** The model's constants, printed on the board's method box. */
export interface ModelSpec {
  version: string;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  peer_window: number;
  peer_max: number;
  pool_share: number;
  position_usd: number;
  horizon_weeks: number;
  hours_total: number;
  farm_hourly: number;
  thin_hourly: number;
}

export const MODEL: ModelSpec = {
  version: 'first-light-2',
  growth_weight: 0.4,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
  peer_window: 3,
  peer_max: 20,
  pool_share: 0.07,
  position_usd: 1000,
  horizon_weeks: 8,
  hours_total: 2,
  farm_hourly: 5,
  thin_hourly: 1,
};

/** Extra early rows below the watchlist floor, by shrunk value. */
export const EARLY_ROWS = 160;

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  implied_lo_usd: number;
  implied_hi_usd: number;
  peer_count: number;
  peer_multiple: number;
  raw_value_usd: number;
  peer_median_usd: number;
  verdict: 'farm' | 'thin' | 'skip';
  drop_per_1k_usd: number;
  net_per_hour_usd: number;
  farm_steps: string[];
}

/** The dashboard's compact row. */
export interface DashRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chain: string;
  tvl: number;
  chg: number | null;
  age: number | null;
  point: number;
  lo: number;
  hi: number;
  peers: number;
  mult: number;
  raw: number;
  peermed: number;
  verdict: 'farm' | 'thin' | 'skip';
  drop: number;
  net: number;
}

/** A live-token protocol, kept apart with the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl: number;
  mcap: number;
  chg: number | null;
}

/** Everything the dashboard renders. */
export interface DashData {
  as_of: string;
  floor_usd: number;
  model: ModelSpec;
  watchlist: number;
  scanned: number;
  rankable: number;
  board: number;
  early: number;
  live_n: number;
  farm_n: number;
  thin_n: number;
  skip_n: number;
  miss_median: number;
  miss_within2: number;
  miss_within3: number;
  miss_n: number;
  market_slope: number;
  market_intercept: number;
  market_r2: number;
  market_n: number;
  global_mult: number;
  rows: DashRow[];
  farm_next: { slug: string; name: string; chain: string; net: number; gross: number; point: number }[];
  live: LiveRow[];
  market_points: { x: number; y: number; name: string }[];
}

/** Why the snapshot is not one this model can score. */
export class SnapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapError';
  }
}

const DAY_MS = 86_400_000;

function finiteNum(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Median of a list, or NaN when empty. */
export function medianOf(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether the record shows no token at all. */
export function isPreToken(p: Proto): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const WRAPPED_CATEGORY = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * Whether the board may rank a protocol: it records no token, and it is not a wrapped,
 * staked or bridged product of a token that already trades, nor an exchange, nor a
 * versioned pool of another protocol. The snapshot carries no parent field, so the
 * versioned-name, wrapped-word, exchange-prefix and category rules do that work.
 */
export function isRankable(p: Proto): boolean {
  return (
    isPreToken(p) &&
    !WRAPPED_CATEGORY.has(p.category ?? '') &&
    !VERSIONED_NAME.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: Proto): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Gas for one week of farming plus the setup, by the protocol's main chain. */
export function gasTier(chain: string): { weekly: number; setup: number } {
  if (chain === 'Ethereum') return { weekly: 14, setup: 18 };
  if (chain === 'Solana') return { weekly: 0.25, setup: 1 };
  if (
    ['Base', 'Arbitrum', 'Optimism', 'Polygon', 'BSC', 'BNB Chain', 'Avalanche', 'Sui', 'Aptos', 'zkSync Era', 'Linea', 'Scroll', 'Blast', 'Mode', 'Hyperliquid', 'Berachain', 'Unichain', 'Sei', 'Sonic'].includes(chain)
  ) {
    return { weekly: 1.5, setup: 4 };
  }
  return { weekly: 4, setup: 6 };
}

/** The growth and maturity multipliers and the age behind them. */
function growthMaturity(p: Proto, asOf: string, spec: ModelSpec): { growth: number; maturity: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finiteNum(p.change_7d, 0);
  const clipped = Math.min(spec.growth_cap, Math.max(spec.growth_floor, rawGrowth));
  const growth = 1 + (clipped / 100) * spec.growth_weight;
  const ageForModel = age ?? spec.unknown_age_days;
  const maturity =
    spec.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), spec.maturity_days) / spec.maturity_days) * spec.maturity_range;
  return { growth, maturity, age };
}

/** The raw implied value before shrinkage: TVL x peer multiple x growth x maturity. */
function rawValue(p: Proto, mult: number, asOf: string, spec: ModelSpec): { raw: number; growth: number; maturity: number; age: number | null } {
  const { growth, maturity, age } = growthMaturity(p, asOf, spec);
  return { raw: p.tvl_usd * mult * growth * maturity, growth, maturity, age };
}

/** Pseudo-peers: pre-token protocols in the same category, TVL within the window, nearest by size. */
function pseudoPeers(p: Proto, universe: Proto[], spec: ModelSpec): Proto[] {
  const same = universe.filter(
    (q) =>
      q.slug !== p.slug &&
      (q.category ?? 'Other') === (p.category ?? 'Other') &&
      q.tvl_usd >= p.tvl_usd / spec.peer_window &&
      q.tvl_usd <= p.tvl_usd * spec.peer_window,
  );
  same.sort(
    (a, b) =>
      Math.abs(Math.log(a.tvl_usd / p.tvl_usd)) - Math.abs(Math.log(b.tvl_usd / p.tvl_usd)) ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  return same.slice(0, spec.peer_max);
}

/** The shrunk point and its middle-half range, from the raw value and its pseudo-peers. */
export function shrunkValue(
  p: Proto,
  universe: Proto[],
  mults: Map<string, number>,
  globalMult: number,
  missWiden: number,
  asOf: string,
  spec: ModelSpec,
): { point: number; lo: number; hi: number; peers: number; raw: number; peermed: number; mult: number; growth: number; maturity: number; age: number | null } {
  const mult = mults.get(p.category ?? 'Other') ?? globalMult;
  const { raw, growth, maturity, age } = rawValue(p, mult, asOf, spec);
  const peers = pseudoPeers(p, universe, spec);
  const peerRaws = peers.map((q) => {
    const qMult = mults.get(q.category ?? 'Other') ?? globalMult;
    return rawValue(q, qMult, asOf, spec).raw;
  });
  const pool = [...peerRaws, raw].sort((a, b) => a - b);
  const q25 = pool[Math.floor(pool.length * 0.25)] ?? raw;
  const q75 = pool[Math.floor(pool.length * 0.75)] ?? raw;
  const peerMed = peerRaws.length > 0 ? medianOf(peerRaws) : raw;
  const point = Math.max(1, Math.round(Math.sqrt(raw * peerMed)));
  // The range is the peer middle half; when peers are thin it widens to at least the
  // typical miss measured out of sample, so a range is never a single number. And it
  // always contains the point: a raw value far above its peers would otherwise land
  // outside the quartiles.
  const qLo = peers.length >= 5 ? q25 : Math.min(q25, point / missWiden);
  const qHi = peers.length >= 5 ? q75 : Math.max(q75, point * missWiden);
  const lo = Math.round(Math.min(qLo, point));
  const hi = Math.round(Math.max(qHi, point));
  return { point, lo, hi, peers: peers.length, raw: Math.round(raw), peermed: Math.round(peerMed), mult, growth, maturity, age };
}

/** The farm verdict for one row: expected drop, gas, and net pay per hour of the farmer's time. */
export function farmVerdict(
  p: Proto,
  point: number,
  spec: ModelSpec,
): { verdict: 'farm' | 'thin' | 'skip'; gross: number; net: number; gas8w: number } {
  const gross = (spec.pool_share * point * spec.position_usd) / p.tvl_usd;
  const gas = gasTier(chainOf(p));
  const gas8w = gas.weekly * spec.horizon_weeks + gas.setup;
  const net = (gross - gas8w) / spec.hours_total;
  const verdict = net >= spec.farm_hourly ? 'farm' : net >= spec.thin_hourly ? 'thin' : 'skip';
  return { verdict, gross: Math.round(gross * 100) / 100, net: Math.round(net * 100) / 100, gas8w };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: Proto): number {
  if (p.tvl_usd >= 2_000_000_000) return 200;
  if (p.tvl_usd >= 500_000_000) return 120;
  if (p.tvl_usd >= 50_000_000) return 80;
  return 40;
}

/** How long to hold, from the protocol's age: younger protocols get a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 540) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: Proto, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC in ${name}'s main market on ${chain} and leave the loan open`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and leave the LP tokens in place`;
  if (c.includes('bridge')) return `Move $${capital} of USDC across ${name} onto ${chain} and put the bridged funds to work in the app`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} through ${name} and hold the receipt token`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Post $${capital} of USDC as margin on ${name} and open one small hedged trade`;
  if (c.includes('prediction')) return `Back one outcome with $${capital} on ${name}`;
  if (c.includes('curator') || c.includes('allocator')) return `Put $${capital} into a ${name} vault on ${chain} and keep the vault shares`;
  if (c.includes('stable')) return `Mint or hold $${capital} of the stable asset ${name} issues on ${chain}`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy live`;
  return `Put $${capital} of USDC to work in ${name} on ${chain} and leave it there`;
}

/**
 * A protocol's farm plan: six steps, each one sentence carrying its cost and its time.
 * Every step is derived from the protocol's own record (category, chains, TVL, age);
 * no name is ever special-cased.
 */
export function farmPlan(p: Proto, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasTier(chain);
  const steps = [
    `Open a wallet you use only for this farm and keep its recovery phrase on paper, never in a screenshot or a chat (no cost; 5 minutes).`,
    `${actionFor(p, capital, chain)} (about $${gas.setup} of gas to set up; 15 minutes).`,
    `Do one qualifying action a week — a deposit, a borrow, a swap or a vote — so the wallet reads as active, not one-off (about $${gas.weekly} of gas a week; 10 minutes a week).`,
    `Leave the position alone for at least ${hold} days, so it is counted in more than one snapshot (the $${capital} stays in the position; ${hold} days).`,
    `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; never pay to claim (no fee to check; 10 minutes).`,
    `Write the wallet, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it cleanly (nothing but the log; 5 minutes).`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/** The live-token protocols, by market cap, set aside from the ranking. */
export function liveRows(snapshot: Snap): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl: p.tvl_usd,
      mcap: p.mcap_usd ?? 0,
      chg: p.change_7d,
    }));
}

/** The market line: a log-log fit of market cap on TVL over the live-token protocols. */
export function marketLine(live: Proto[]): { slope: number; intercept: number; r2: number; points: { x: number; y: number; name: string }[] } {
  const pts = live.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const xs = pts.map((p) => Math.log(p.tvl_usd));
  const ys = pts.map((p) => Math.log(p.mcap_usd ?? 1));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  const points = [...pts]
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .map((p) => ({ x: p.tvl_usd, y: p.mcap_usd ?? 0, name: p.name }))
    .sort((a, b) => a.x - b.x || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { slope, intercept, r2, points };
}

/**
 * The honesty check: run the same model on the protocols whose tokens already trade,
 * each one left out of its own peer multiple, and measure how far the model's numbers
 * land from the market's. Returns the typical miss factor and the shares within 2x and 3x.
 */
export function outOfSampleMiss(
  live: Proto[],
  mults: Map<string, number>,
  globalMult: number,
  asOf: string,
  spec: ModelSpec,
): { median: number; within2: number; within3: number; n: number } {
  const ratiosByCat = new Map<string, number[]>();
  for (const p of live) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const c = p.category ?? 'Other';
    if (!ratiosByCat.has(c)) ratiosByCat.set(c, []);
    ratiosByCat.get(c)!.push(p.mcap_usd / p.tvl_usd);
  }
  const looMult = (p: Proto): number => {
    const arr = ratiosByCat.get(p.category ?? 'Other');
    if (!arr || arr.length < 2) return globalMult;
    const self = (p.mcap_usd ?? 0) / p.tvl_usd;
    const idx = arr.indexOf(self);
    const rest = idx >= 0 ? [...arr.slice(0, idx), ...arr.slice(idx + 1)] : arr;
    return medianOf(rest);
  };
  const universe = live.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
  const misses: number[] = [];
  for (const p of universe) {
    const m = looMult(p);
    const { raw } = rawValue(p, m, asOf, spec);
    const peers = live
      .filter(
        (q) =>
          q.slug !== p.slug &&
          (q.category ?? 'Other') === (p.category ?? 'Other') &&
          q.tvl_usd >= p.tvl_usd / spec.peer_window &&
          q.tvl_usd <= p.tvl_usd * spec.peer_window,
      )
      .sort(
        (a, b) =>
          Math.abs(Math.log(a.tvl_usd / p.tvl_usd)) - Math.abs(Math.log(b.tvl_usd / p.tvl_usd)) ||
          (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
      )
      .slice(0, spec.peer_max);
    const peerRaws = peers.map((q) => rawValue(q, looMult(q), asOf, spec).raw);
    const peerMed = peerRaws.length > 0 ? medianOf(peerRaws) : raw;
    const point = Math.max(1, Math.sqrt(raw * peerMed));
    const mcap = p.mcap_usd ?? 1;
    misses.push(Math.max(point / mcap, mcap / point));
  }
  misses.sort((a, b) => a - b);
  const n = misses.length;
  return {
    median: n === 0 ? 1 : medianOf(misses),
    within2: n === 0 ? 0 : misses.filter((m) => m <= 2).length / n,
    within3: n === 0 ? 0 : misses.filter((m) => m <= 3).length / n,
    n,
  };
}

/** The ranked board and the dashboard's whole dataset, from one snapshot. */
export function buildBoard(snapshot: Snap, spec: ModelSpec = MODEL): { board: BoardRow[]; data: DashData } {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX');
  const globalMult = medianOf(live.map((p) => (p.mcap_usd ?? 0) / p.tvl_usd));
  const ratiosByCat = new Map<string, number[]>();
  for (const p of live) {
    const c = p.category ?? 'Other';
    if (!ratiosByCat.has(c)) ratiosByCat.set(c, []);
    ratiosByCat.get(c)!.push((p.mcap_usd ?? 0) / p.tvl_usd);
  }
  const mults = new Map<string, number>();
  for (const [c, arr] of ratiosByCat) if (arr.length >= 3) mults.set(c, medianOf(arr));

  const miss = outOfSampleMiss(live, mults, globalMult, snapshot.as_of, spec);
  const widen = Math.sqrt(miss.median);

  const rankable = snapshot.protocols.filter(isRankable);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, Proto>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = rankable
    .filter((p) => !chosen.has(p.slug))
    .map((p) => ({ p, value: shrunkValue(p, rankable, mults, globalMult, widen, snapshot.as_of, spec) }))
    .sort((a, b) => b.value.point - a.value.point || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const { p } of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()]
    .map((p) => ({ p, value: shrunkValue(p, rankable, mults, globalMult, widen, snapshot.as_of, spec) }))
    .sort((a, b) => b.value.point - a.value.point || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  const board: BoardRow[] = scored.map((s, i) => {
    const verdict = farmVerdict(s.p, s.value.point, spec);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.value.age,
      implied_value_usd: s.value.point,
      implied_lo_usd: s.value.lo,
      implied_hi_usd: s.value.hi,
      peer_count: s.value.peers,
      peer_multiple: Math.round(s.value.mult * 10000) / 10000,
      raw_value_usd: s.value.raw,
      peer_median_usd: s.value.peermed,
      verdict: verdict.verdict,
      drop_per_1k_usd: verdict.gross,
      net_per_hour_usd: verdict.net,
      farm_steps: farmPlan(s.p, s.value.age),
    };
  });

  const market = marketLine(live);
  const farmNext = board
    .filter((r) => r.verdict === 'farm')
    .sort((a, b) => b.net_per_hour_usd - a.net_per_hour_usd || a.slug.localeCompare(b.slug))
    .slice(0, 8)
    .map((r) => ({ slug: r.slug, name: r.name, chain: chainOf({ chains: r.chains } as Proto), net: r.net_per_hour_usd, gross: r.drop_per_1k_usd, point: r.implied_value_usd }));

  const data: DashData = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model: spec,
    watchlist: snapshot.watchlist.length,
    scanned: snapshot.protocols.length,
    rankable: rankable.length,
    board: board.length,
    early: early.length,
    live_n: liveRows(snapshot).length,
    farm_n: board.filter((r) => r.verdict === 'farm').length,
    thin_n: board.filter((r) => r.verdict === 'thin').length,
    skip_n: board.filter((r) => r.verdict === 'skip').length,
    miss_median: Math.round(miss.median * 100) / 100,
    miss_within2: Math.round(miss.within2 * 100) / 100,
    miss_within3: Math.round(miss.within3 * 100) / 100,
    miss_n: miss.n,
    market_slope: Math.round(market.slope * 1000) / 1000,
    market_intercept: Math.round(market.intercept * 1000) / 1000,
    market_r2: Math.round(market.r2 * 100) / 100,
    market_n: market.points.length,
    global_mult: Math.round(globalMult * 1000) / 1000,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chain: chainOf({ chains: r.chains } as Proto),
      tvl: r.tvl_usd,
      chg: r.change_7d,
      age: r.age_days,
      point: r.implied_value_usd,
      lo: r.implied_lo_usd,
      hi: r.implied_hi_usd,
      peers: r.peer_count,
      mult: r.peer_multiple,
      raw: r.raw_value_usd,
      peermed: r.peer_median_usd,
      verdict: r.verdict,
      drop: r.drop_per_1k_usd,
      net: r.net_per_hour_usd,
    })),
    farm_next: farmNext,
    live: liveRows(snapshot),
    market_points: market.points,
  };
  return { board, data };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snap {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snap): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.implied_lo_usd > r.implied_value_usd || r.implied_hi_usd < r.implied_value_usd) return `${r.slug} has a range that misses its own point`;
  }
  return null;
}

/** The dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(data: DashData): string {
  return `window.RADAR=${JSON.stringify(data)};\n`;
}
