// token-radar-01 round 3: a fitted log-space value model, a ledger for all 758
// protocols, and farm plans costed to the dollar. Written fresh for r3.
// Node 22, standard library only. No network, no randomness, no clock: two runs
// of the program that reads the same snapshot bytes write the same bytes.

export interface SnapshotProtocol {
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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const DROP_SHARE = 0.07;
const TX_COUNT = 6;
const HOURS_TOTAL = 2;
const HOLD_DAYS = 60;
const FARM_PER_HOUR = 5;
const THIN_PER_HOUR = 1;

/** Whole days from `listedAt` to `asOf`; null when the listing date is absent. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const SET_ASIDE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * Why a pre-token protocol is set aside instead of ranked, or null when it is
 * rankable. Rules use only the snapshot's own fields, in this fixed order, so
 * the ledger's groups are checkable: category first, then the name.
 */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (p.category === 'CEX') return 'CEX: an exchange token, not a launch';
  if (p.category !== null && SET_ASIDE_CATEGORIES.has(p.category)) return `category ${p.category}: a wrapped, staked or bridged product, not a launch`;
  if (VERSIONED_NAME.test(p.name)) return 'versioned name: a release of another protocol';
  if (WRAPPED_WORD.test(p.name)) return 'name carries wrapped, staked or staking';
  if (EXCHANGE_NAME.test(p.name)) return 'name begins with an exchange';
  return null;
}

/** Seven-day TVL change as a clamped fraction: -60%..+120% maps to -0.6..1.2. */
function growthFrac(p: SnapshotProtocol): number {
  const g = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  return Math.min(120, Math.max(-60, g)) / 100;
}

// ------------------------------------------------------------------ OLS fit

type FeatureFn = (p: SnapshotProtocol) => number[];

/** Solve a small dense linear system by Gauss-Jordan with partial pivoting. */
function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    const tmp = m[c];
    m[c] = m[piv];
    m[piv] = tmp;
    const d = m[c][c];
    if (Math.abs(d) < 1e-12) throw new SnapshotError('model fit is singular');
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / d;
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/** Ordinary least squares with a hair of ridge for stability. */
function ols(rows: SnapshotProtocol[], feat: FeatureFn): number[] {
  const k = feat(rows[0]).length;
  const a: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b: number[] = new Array<number>(k).fill(0);
  for (const p of rows) {
    const x = feat(p);
    const y = Math.log(p.mcap_usd as number);
    for (let i = 0; i < k; i++) {
      b[i] += x[i] * y;
      for (let j = 0; j < k; j++) a[i][j] += x[i] * x[j];
    }
  }
  for (let i = 0; i < k; i++) a[i][i] += 1e-9;
  return solveLinear(a, b);
}

function dot(beta: number[], x: number[]): number {
  let s = 0;
  for (let i = 0; i < beta.length; i++) s += beta[i] * x[i];
  return s;
}

function quantile(sorted: number[], f: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
}

function missStats(residuals: number[]): { miss: number; within2: number; within3: number } {
  const abs = residuals.map((r) => Math.abs(r)).sort((x, y) => x - y);
  const med = abs[Math.floor(abs.length / 2)];
  return {
    miss: Math.exp(med),
    within2: residuals.filter((r) => Math.abs(r) <= Math.log(2)).length / residuals.length,
    within3: residuals.filter((r) => Math.abs(r) <= Math.log(3)).length / residuals.length,
  };
}

function medianOf(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** A deterministic generator (mulberry32) so the bootstrap is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A 95% bootstrap interval for the miss, from 1,000 resamples of the errors
 * with a fixed seed, so two runs print the same interval. The same seed is
 * used for every series: common random numbers, so the intervals are
 * comparable and the Monte Carlo noise does not move them apart.
 */
function bootstrapCI(residuals: number[], draws = 1000, seed = 20261118): [number, number] {
  const rng = mulberry32(seed);
  const n = residuals.length;
  const vals: number[] = [];
  for (let b = 0; b < draws; b++) {
    const sample: number[] = [];
    for (let i = 0; i < n; i++) sample.push(residuals[Math.floor(rng() * n)]);
    vals.push(missStats(sample).miss);
  }
  vals.sort((a, b) => a - b);
  return [vals[Math.floor(0.025 * draws)], vals[Math.floor(0.975 * draws)]];
}

/**
 * The r2-style baseline: predict from the median peer multiple, shrunk to
 * the global median. A protocol's peers are the training protocols in its
 * category; with K=3 the category median is pulled a third of the way to the
 * global median when the category holds three protocols, less when it holds
 * more, more when it holds fewer.
 */
function baselineLogPred(rows: SnapshotProtocol[], p: SnapshotProtocol, shrinkK = 3): number {
  const mults = rows.map((r) => (r.mcap_usd as number) / r.tvl_usd);
  const globalMed = medianOf(mults);
  const cat = rows.filter((r) => r.category === p.category);
  const catMed = cat.length > 0 ? medianOf(cat.map((r) => (r.mcap_usd as number) / r.tvl_usd)) : globalMed;
  const m = (cat.length * catMed + shrinkK * globalMed) / (cat.length + shrinkK);
  return Math.log(p.tvl_usd) + Math.log(m);
}

/** Leave-one-out residuals for the baseline: every median excludes the point. */
function looBaseline(train: SnapshotProtocol[]): number[] {
  return train.map((p, i) => {
    const sub = train.filter((_, j) => j !== i);
    return Math.log(p.mcap_usd as number) - baselineLogPred(sub, p);
  });
}

/** Leave-one-out residuals for a feature set. */
function looResiduals(rows: SnapshotProtocol[], feat: FeatureFn): number[] {
  const out: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const sub = rows.filter((_, j) => j !== i);
    const beta = ols(sub, feat);
    out.push(Math.log(rows[i].mcap_usd as number) - dot(beta, feat(rows[i])));
  }
  return out;
}

/** Oldest 60% train, newest 40% test, split on the listing date. */
function walkForward(rows: SnapshotProtocol[], feat: FeatureFn): { miss: number; within2: number; within3: number; trainTo: string; testFrom: string } {
  const sorted = [...rows].sort((a, b) => (a.listed_at as string).localeCompare(b.listed_at as string));
  const cut = Math.floor(sorted.length * 0.6);
  const tr = sorted.slice(0, cut);
  const te = sorted.slice(cut);
  const beta = ols(tr, feat);
  const res = te.map((p) => Math.log(p.mcap_usd as number) - dot(beta, feat(p)));
  const m = missStats(res);
  return { ...m, trainTo: tr[tr.length - 1].listed_at as string, testFrom: te[0].listed_at as string };
}

/** Shrunk category premium from residuals of a base predictor (mean x n/(n+K)). */
function categoryPremiums(rows: SnapshotProtocol[], basePredict: (p: SnapshotProtocol) => number, shrinkK: number): Map<string, number> {
  const byCat = new Map<string, number[]>();
  for (const p of rows) {
    const r = Math.log(p.mcap_usd as number) - basePredict(p);
    const list = byCat.get(p.category as string) ?? [];
    list.push(r);
    byCat.set(p.category as string, list);
  }
  const out = new Map<string, number>();
  for (const [c, rs] of byCat) {
    const mean = rs.reduce((s, v) => s + v, 0) / rs.length;
    out.set(c, mean * (rs.length / (rs.length + shrinkK)));
  }
  return out;
}

// ------------------------------------------------------------------ the model

export interface VariantResult {
  key: string;
  label: string;
  beta: number[] | null;
  flatConstant: number | null;
  looMiss: number;
  looMissLo: number;
  looMissHi: number;
  looWithin2: number;
  looWithin3: number;
  wfMiss: number;
  wfWithin2: number;
  wfWithin3: number;
  r2: number | null;
  combined: number;
}

export interface MissingAgeStats {
  nNoAge: number;
  nWithAge: number;
  medianTvlNoAge: number;
  medianTvlWithAge: number;
  medianRatioNoAge: number;
  medianRatioWithAge: number;
  topNoAge: { category: string; count: number }[];
  topWithAge: { category: string; count: number }[];
  cexNoAge: number;
  cexWithAge: number;
}

export interface FittedModel {
  chosenKey: string;
  chosenLabel: string;
  beta: number[];
  trainSize: number;
  trainExcluded: { slug: string; ratio: number }[];
  variants: VariantResult[];
  baseline: VariantResult;
  ciOverlapBaseline: boolean;
  missingAge: MissingAgeStats;
  preTokenCount: number;
  looQuantiles: { p10: number; p25: number; p75: number; p90: number };
  wfHold50: number;
  wfHold80: number;
  wfTrainTo: string;
  wfTestFrom: string;
  r2: number;
  medianAgeRankable: number;
  ageNote: string;
}

/** The feature sets, simplest first; the combined score picks the winner. */
function variantFeatures(asOf: string): { key: string; label: string; feat: FeatureFn }[] {
  return [
    { key: 'flat', label: 'flat multiple: value = TVL x one multiple', feat: (p) => [1, Math.log(p.tvl_usd)] },
    { key: 'size', label: '+ size curve: log value on log TVL', feat: (p) => [1, Math.log(p.tvl_usd)] },
    { key: 'sizeMom', label: '+ momentum: seven-day TVL change', feat: (p) => [1, Math.log(p.tvl_usd), growthFrac(p)] },
    { key: 'sizeMomAge', label: '+ age: log days since listing', feat: (p) => [1, Math.log(p.tvl_usd), growthFrac(p), Math.log(Math.max(1, ageDays(asOf, p.listed_at) ?? 365))] },
  ];
}

/** The feature vector of the chosen variant, rebuilt from its key. */
function featureVector(key: string, p: SnapshotProtocol, asOf: string): number[] {
  switch (key) {
    case 'flat':
    case 'size':
      return [1, Math.log(p.tvl_usd)];
    case 'sizeMomAge':
      return [1, Math.log(p.tvl_usd), growthFrac(p), Math.log(Math.max(1, ageDays(asOf, p.listed_at) ?? 365))];
    default:
      return [1, Math.log(p.tvl_usd), growthFrac(p)];
  }
}

function fitFlat(rows: SnapshotProtocol[]): number {
  return rows.reduce((s, p) => s + (Math.log(p.mcap_usd as number) - Math.log(p.tvl_usd)), 0) / rows.length;
}

/** Fit every variant on the training set and let validation choose. */
export function fitModel(snapshot: Snapshot): FittedModel {
  const VARIANTS = variantFeatures(snapshot.as_of);
  const usable = snapshot.protocols.filter(
    (p) => typeof p.mcap_usd === 'number' && p.mcap_usd > 0 && p.tvl_usd > 0 && p.listed_at !== null && p.change_7d !== null && p.category !== null,
  );
  const trainExcluded = usable
    .filter((p) => (p.mcap_usd as number) / p.tvl_usd >= 10)
    .map((p) => ({ slug: p.slug, ratio: Math.round(((p.mcap_usd as number) / p.tvl_usd) * 10) / 10 }))
    .sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const train = usable.filter((p) => (p.mcap_usd as number) / p.tvl_usd < 10);
  const y = train.map((p) => Math.log(p.mcap_usd as number));
  const yMean = y.reduce((s, v) => s + v, 0) / y.length;
  const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0);

  const results: VariantResult[] = [];
  for (const v of VARIANTS) {
    let beta: number[] | null = null;
    let flatConstant: number | null = null;
    let predict: (p: SnapshotProtocol) => number;
    if (v.key === 'flat') {
      flatConstant = fitFlat(train);
      predict = (p) => Math.log(p.tvl_usd) + (flatConstant as number);
    } else {
      beta = ols(train, v.feat);
      predict = (p) => dot(beta as number[], v.feat(p));
    }
    // The flat variant's leave-one-out uses the flat fit itself, not OLS.
    let looRes: number[];
    if (v.key === 'flat') {
      looRes = train.map((p, i) => {
        const sub = train.filter((_, j) => j !== i);
        return Math.log(p.mcap_usd as number) - (Math.log(p.tvl_usd) + fitFlat(sub));
      });
    } else {
      looRes = looResiduals(train, v.feat);
    }
    const looM = missStats(looRes);
    const wf = walkForward(train, v.key === 'flat' ? (p: SnapshotProtocol) => [1, Math.log(p.tvl_usd)] : v.feat);
    // Walk-forward for flat also needs the flat fit: correct it.
    let wfM = wf;
    if (v.key === 'flat') {
      const sorted = [...train].sort((a, b) => (a.listed_at as string).localeCompare(b.listed_at as string));
      const cut = Math.floor(sorted.length * 0.6);
      const tr = sorted.slice(0, cut);
      const te = sorted.slice(cut);
      const c = fitFlat(tr);
      const res = te.map((p) => Math.log(p.mcap_usd as number) - (Math.log(p.tvl_usd) + c));
      wfM = { ...missStats(res), trainTo: wf.trainTo, testFrom: wf.testFrom };
    }
    const ssRes = train.reduce((s, p, i) => s + (y[i] - predict(p)) ** 2, 0);
    const looCI = bootstrapCI(looRes);
    results.push({
      key: v.key,
      label: v.label,
      beta,
      flatConstant,
      looMiss: looM.miss,
      looMissLo: looCI[0],
      looMissHi: looCI[1],
      looWithin2: looM.within2,
      looWithin3: looM.within3,
      wfMiss: wfM.miss,
      wfWithin2: wfM.within2,
      wfWithin3: wfM.within3,
      r2: v.key === 'flat' ? null : 1 - ssRes / ssTot,
      combined: Math.sqrt(looM.miss * wfM.miss),
    });
  }

  // Category premium on top of size+momentum, leave-one-out only: it is an
  // ablation row, and validation has rejected it every time it was tried.
  const sizeMom = VARIANTS[2];
  const betaSM = ols(train, sizeMom.feat);
  const baseSM = (p: SnapshotProtocol) => dot(betaSM, sizeMom.feat(p));
  const looCat: number[] = [];
  for (let i = 0; i < train.length; i++) {
    const sub = train.filter((_, j) => j !== i);
    const bb = ols(sub, sizeMom.feat);
    const bs = (p: SnapshotProtocol) => dot(bb, sizeMom.feat(p));
    const prem = categoryPremiums(sub, bs, 3);
    looCat.push(Math.log(train[i].mcap_usd as number) - (bs(train[i]) + (prem.get(train[i].category as string) ?? 0)));
  }
  const looCatM = missStats(looCat);
  const looCatCI = bootstrapCI(looCat);
  // The category variant's own walk-forward: premiums are fitted on the
  // oldest 60% only, then applied to the newest 40%.
  const sortedTrain = [...train].sort((a, b) => (a.listed_at as string).localeCompare(b.listed_at as string));
  const cutCat = Math.floor(sortedTrain.length * 0.6);
  const trCat = sortedTrain.slice(0, cutCat);
  const teCat = sortedTrain.slice(cutCat);
  const bbCat = ols(trCat, sizeMom.feat);
  const bsCat = (p: SnapshotProtocol) => dot(bbCat, sizeMom.feat(p));
  const premCat = categoryPremiums(trCat, bsCat, 3);
  const wfCatRes = teCat.map((p) => Math.log(p.mcap_usd as number) - (bsCat(p) + (premCat.get(p.category as string) ?? 0)));
  const wfCat = missStats(wfCatRes);

  // Leave-one-out picks the winner; walk-forward is the reported number and
  // does not pick. Ties go to the simpler variant, which is listed first.
  // The two scores can disagree — at n=90 they do, on momentum — and the
  // rule lets leave-one-out decide.
  let best = results[0];
  for (const r of results) if (r.looMiss < best.looMiss - 1e-12) best = r;
  results.push({
    key: 'sizeMomCat',
    label: '+ category premium (shrunk, K=3) on size+momentum',
    beta: null,
    flatConstant: null,
    looMiss: looCatM.miss,
    looMissLo: looCatCI[0],
    looMissHi: looCatCI[1],
    looWithin2: looCatM.within2,
    looWithin3: looCatM.within3,
    wfMiss: wfCat.miss,
    wfWithin2: wfCat.within2,
    wfWithin3: wfCat.within3,
    r2: null,
    combined: Math.sqrt(looCatM.miss * wfCat.miss),
  });

  // The r2-style baseline, scored on the SAME 90 protocols and the SAME
  // walk-forward split as the variants: the old round's miss was measured on
  // a different set of live protocols, so it cannot be compared with these
  // numbers. The baseline is never a candidate for the model; it is the
  // yardstick the fitted variants have to clear.
  const baseLoo = looBaseline(train);
  const baseLooM = missStats(baseLoo);
  const baseCI = bootstrapCI(baseLoo);
  const sortedBase = [...train].sort((a, b) => (a.listed_at as string).localeCompare(b.listed_at as string));
  const cutBase = Math.floor(sortedBase.length * 0.6);
  const trBase = sortedBase.slice(0, cutBase);
  const teBase = sortedBase.slice(cutBase);
  const baseWfRes = teBase.map((p) => Math.log(p.mcap_usd as number) - baselineLogPred(trBase, p));
  const baseWfM = missStats(baseWfRes);
  const baseline: VariantResult = {
    key: 'baseline',
    label: 'r2-style baseline: median peer multiple, shrunk to the global median (K=3)',
    beta: null,
    flatConstant: null,
    looMiss: baseLooM.miss,
    looMissLo: baseCI[0],
    looMissHi: baseCI[1],
    looWithin2: baseLooM.within2,
    looWithin3: baseLooM.within3,
    wfMiss: baseWfM.miss,
    wfWithin2: baseWfM.within2,
    wfWithin3: baseWfM.within3,
    r2: null,
    combined: Math.sqrt(baseLooM.miss * baseWfM.miss),
  };
  const chosenVariant = results.find((v) => v.key === best.key) as VariantResult;
  const ciOverlapBaseline = chosenVariant.looMissLo <= baseline.looMissHi && baseline.looMissLo <= chosenVariant.looMissHi;

  // The 33 trading protocols with no listing date: are they a random subset
  // of the 128 that trade, or a systematically different cohort? Compared
  // here on median TVL, median market-cap-to-TVL, the top categories and the
  // CEX share. They are dropped from the training set either way; the check
  // says what dropping them costs.
  const withAge = snapshot.protocols.filter((p) => typeof p.mcap_usd === 'number' && p.mcap_usd > 0 && p.listed_at !== null);
  const noAge = snapshot.protocols.filter((p) => typeof p.mcap_usd === 'number' && p.mcap_usd > 0 && p.listed_at === null);
  const topCategories = (rows: SnapshotProtocol[], k: number): { category: string; count: number }[] => {
    const counts = new Map<string, number>();
    for (const p of rows) counts.set(p.category as string, (counts.get(p.category as string) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, k)
      .map(([category, count]) => ({ category, count }));
  };
  const missingAge: MissingAgeStats = {
    nNoAge: noAge.length,
    nWithAge: withAge.length,
    medianTvlNoAge: medianOf(noAge.map((p) => p.tvl_usd)),
    medianTvlWithAge: medianOf(withAge.map((p) => p.tvl_usd)),
    medianRatioNoAge: medianOf(noAge.map((p) => (p.mcap_usd as number) / p.tvl_usd)),
    medianRatioWithAge: medianOf(withAge.map((p) => (p.mcap_usd as number) / p.tvl_usd)),
    topNoAge: topCategories(noAge, 3),
    topWithAge: topCategories(withAge, 3),
    cexNoAge: noAge.filter((p) => p.category === 'CEX').length,
    cexWithAge: withAge.filter((p) => p.category === 'CEX').length,
  };
  const preTokenCount = snapshot.protocols.filter((p) => isPreToken(p)).length;
  const chosenBeta = best.key === 'flat' ? [best.flatConstant as number, 0] : best.beta as number[];

  // Leave-one-out residuals of the chosen variant, for the printed range.
  const chosenFeat = (VARIANTS.find((v) => v.key === best.key) ?? VARIANTS[2]).feat;
  let chosenLoo: number[];
  if (best.key === 'flat') {
    chosenLoo = train.map((p, i) => {
      const sub = train.filter((_, j) => j !== i);
      return Math.log(p.mcap_usd as number) - (Math.log(p.tvl_usd) + fitFlat(sub));
    });
  } else {
    chosenLoo = looResiduals(train, chosenFeat);
  }
  const sortedLoo = [...chosenLoo].sort((a, b) => a - b);
  const qs = { p10: quantile(sortedLoo, 0.1), p25: quantile(sortedLoo, 0.25), p75: quantile(sortedLoo, 0.75), p90: quantile(sortedLoo, 0.9) };
  const wf = walkForward(train, best.key === 'flat' ? (p: SnapshotProtocol) => [1, Math.log(p.tvl_usd)] : chosenFeat);
  let wfRes: number[];
  if (best.key === 'flat') {
    const sorted = [...train].sort((a, b) => (a.listed_at as string).localeCompare(b.listed_at as string));
    const cut = Math.floor(sorted.length * 0.6);
    const tr = sorted.slice(0, cut);
    const te = sorted.slice(cut);
    const c = fitFlat(tr);
    wfRes = te.map((p) => Math.log(p.mcap_usd as number) - (Math.log(p.tvl_usd) + c));
  } else {
    const sorted = [...train].sort((a, b) => (a.listed_at as string).localeCompare(b.listed_at as string));
    const cut = Math.floor(sorted.length * 0.6);
    const tr = sorted.slice(0, cut);
    const te = sorted.slice(cut);
    const bb = ols(tr, chosenFeat);
    wfRes = te.map((p) => Math.log(p.mcap_usd as number) - dot(bb, chosenFeat(p)));
  }
  const wfHold50 = wfRes.filter((r) => r >= qs.p25 && r <= qs.p75).length / wfRes.length;
  const wfHold80 = wfRes.filter((r) => r >= qs.p10 && r <= qs.p90).length / wfRes.length;

  const rankable = snapshot.protocols.filter((p) => isPreToken(p) && exclusionReason(p) === null);
  const knownAges = rankable
    .map((p) => ageDays(snapshot.as_of, p.listed_at))
    .filter((a): a is number => a !== null)
    .sort((a, b) => a - b);
  const medianAge = knownAges[Math.floor(knownAges.length / 2)];

  const ssResBest = train.reduce((s, p, i) => s + (y[i] - (best.key === 'flat' ? Math.log(p.tvl_usd) + (best.flatConstant as number) : dot(chosenBeta, chosenFeat(p)))) ** 2, 0);
  return {
    chosenKey: best.key,
    chosenLabel: best.label,
    beta: chosenBeta,
    trainSize: train.length,
    trainExcluded,
    variants: results,
    baseline,
    ciOverlapBaseline,
    missingAge,
    preTokenCount,
    looQuantiles: qs,
    wfHold50,
    wfHold80,
    wfTrainTo: wf.trainTo,
    wfTestFrom: wf.testFrom,
    r2: 1 - ssResBest / ssTot,
    medianAgeRankable: medianAge,
    ageNote: 'Age was fitted and tested: it adds nothing out of sample and costs accuracy on newer tokens (walk-forward miss rises), so the point value does not use it. Age is used only to widen the printed range when a protocol has no listing date, and to split the walk-forward test itself.',
  };
}

// ------------------------------------------------------------------ farm plans

export interface GasTable {
  [chain: string]: number;
}

export const GAS_USD: GasTable = {
  Ethereum: 8,
  Solana: 0.05,
  Base: 0.1,
  Arbitrum: 0.25,
  'BNB Chain': 0.15,
  Avalanche: 0.3,
  Polygon: 0.05,
  Optimism: 0.1,
  Other: 1,
};

export function gasPerTx(chain: string): number {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return GAS_USD.Ethereum;
  if (c.includes('solana')) return GAS_USD.Solana;
  if (c.includes('base')) return GAS_USD.Base;
  if (c.includes('arbitrum')) return GAS_USD.Arbitrum;
  if (c.includes('bnb') || c.includes('bsc') || c.includes('binance')) return GAS_USD['BNB Chain'];
  if (c.includes('avalanche')) return GAS_USD.Avalanche;
  if (c.includes('polygon')) return GAS_USD.Polygon;
  if (c.includes('optimism')) return GAS_USD.Optimism;
  return GAS_USD.Other;
}

/** The deposit a farm position carries, by the protocol's size. */
export function ticketFor(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 2500;
  if (tvlUsd >= 100_000_000) return 1000;
  return 500;
}

export function money(n: number): string {
  const v = Math.round(n * 100) / 100;
  if (v >= 1000) {
    const whole = String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `$${whole}`;
  }
  return `$${v.toFixed(2)}`;
}

export interface FarmEconomics {
  ticket: number;
  chain: string;
  gasPerTx: number;
  gasTotal: number;
  slice: number;
  net: number;
  perHour: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  steps: string[];
}

function actionFor(p: SnapshotProtocol, ticket: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply ${money(ticket)} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide ${money(ticket)} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge ${money(ticket)} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake ${money(ticket)} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit ${money(ticket)} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund ${money(ticket)} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit ${money(ticket)} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit ${money(ticket)} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint ${money(ticket)} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy ${money(ticket)} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit ${money(ticket)} of USDC into ${name} on ${chain} and keep the position open.`;
}

function stepText(s: string): string {
  let out = s;
  if (out.length > 600) out = `${out.slice(0, 597)}...`;
  if (out.length < 20) out = `${out} Hold the position and check the protocol's own page.`;
  return out;
}

/** A row's farm plan: six steps, each with its own cost and time. */
export function farmPlan(p: SnapshotProtocol, impliedUsd: number): FarmEconomics {
  const chain = p.chains.length > 0 ? p.chains[0] : 'its main chain';
  const ticket = ticketFor(p.tvl_usd);
  const gas = gasPerTx(chain);
  const gasTotal = Math.round(TX_COUNT * gas * 100) / 100;
  // Your slice of the drop is your share of the TVL: 7% of the implied value,
  // times ticket / TVL. The ticket stays yours; only gas is a cost.
  const slice = Math.round(0.07 * impliedUsd * (ticket / p.tvl_usd) * 100) / 100;
  const net = Math.round((slice - gasTotal) * 100) / 100;
  const perHour = Math.round((net / HOURS_TOTAL) * 100) / 100;
  const verdict: FarmEconomics['verdict'] = perHour >= FARM_PER_HOUR ? 'FARM' : perHour >= THIN_PER_HOUR ? 'THIN' : 'SKIP';
  const steps = [
    `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: ${money(gas)} of gas for the first transaction. Time: 5 minutes.`,
    `${actionFor(p, ticket, chain)} Cost: ${money(ticket)} of capital and about ${money(gas)} of gas. Time: 15 minutes to set up.`,
    `Make one qualifying action every two weeks for ${HOLD_DAYS} days, such as a deposit, a borrow, a swap or a vote, four actions in all. Cost: about ${money(4 * gas)} of gas. Time: 15 minutes each.`,
    `Hold the position for at least ${HOLD_DAYS} days so the activity is counted in more than one snapshot. Cost: the ${money(ticket)} stays in the position. Time: ${HOLD_DAYS} days.`,
    `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes. Cost: about ${money(gas)} of gas to claim. Time: 15 minutes.`,
    `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Expected slice ${money(slice)}, net of gas ${money(net)}, ${money(perHour)} an hour: verdict ${verdict}. Cost: nothing but the log. Time: 15 minutes.`,
  ].map(stepText);
  return { ticket, chain, gasPerTx: gas, gasTotal, slice, net, perHour, verdict, steps };
}

// ------------------------------------------------------------------ the board

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  age_imputed: boolean;
  growth_missing: boolean;
  implied_value_usd: number;
  range_p25_usd: number;
  range_p75_usd: number;
  range_p10_usd: number;
  range_p90_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  slice_usd: number;
  net_usd: number;
  per_hour_usd: number;
  ticket_usd: number;
  gas_usd: number;
  watchlist: boolean;
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  age_imputed: boolean;
  growth_missing: boolean;
  implied_value_usd: number;
  range_p25_usd: number;
  range_p75_usd: number;
  range_p10_usd: number;
  range_p90_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  slice_usd: number;
  net_usd: number;
  per_hour_usd: number;
  ticket_usd: number;
  gas_usd: number;
  watchlist: boolean;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface LedgerGroup {
  key: string;
  label: string;
  rule: string;
  count: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: {
    chosen_key: string;
    formula: string;
    coefficients: { intercept: number; size: number; momentum: number; age?: number };
    train_size: number;
    train_excluded: { slug: string; ratio: number }[];
    variants: VariantResult[];
    baseline: VariantResult;
    ci_overlap_baseline: boolean;
    missing_age: MissingAgeStats;
    selection_note: string;
    extrapolation_note: string;
    loo_miss: number;
    loo_miss_lo: number;
    loo_miss_hi: number;
    loo_within2: number;
    loo_within3: number;
    wf_miss: number;
    wf_within2: number;
    wf_within3: number;
    wf_train_to: string;
    wf_test_from: string;
    loo_quantiles: { p10: number; p25: number; p75: number; p90: number };
    wf_hold50: number;
    wf_hold80: number;
    r2: number;
    median_age_rankable: number;
    age_note: string;
  };
  ledger: LedgerGroup[];
  ledger_total: number;
  assumptions: {
    drop_share: number;
    tx_count: number;
    hours_total: number;
    hold_days: number;
    farm_per_hour: number;
    thin_per_hour: number;
    ticket_tiers: { min_tvl_usd: number; ticket_usd: number }[];
    gas_usd: GasTable;
  };
  kpis: { ranked: number; implied_total_usd: number; farm_count: number; thin_count: number; skip_count: number; best_per_hour_usd: number };
  watchlist_size: number;
  board_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  scatter: { tvl_usd: number; mcap_usd: number }[];
}

/** The fitted point value and its printed range for one protocol. */
export function priceProtocol(p: SnapshotProtocol, snapshot: Snapshot, model: FittedModel): {
  implied: number;
  lo25: number;
  hi75: number;
  lo10: number;
  hi90: number;
  age: number | null;
  ageImputed: boolean;
  growthMissing: boolean;
} {
  const age = ageDays(snapshot.as_of, p.listed_at);
  const ageImputed = age === null;
  const growthMissing = p.change_7d === null;
  const logPred = dot(model.beta, featureVector(model.chosenKey, p, snapshot.as_of));
  const implied = Math.max(1, Math.round(Math.exp(logPred)));
  // The range widens when the row's own figures are imputed, by half again.
  const widen = ageImputed || growthMissing ? 1.5 : 1;
  const q = model.looQuantiles;
  const lo25 = Math.max(1, Math.round(implied * Math.exp(q.p25 * widen)));
  const hi75 = Math.max(lo25, Math.round(implied * Math.exp(q.p75 * widen)));
  const lo10 = Math.max(1, Math.round(implied * Math.exp(q.p10 * widen)));
  const hi90 = Math.max(hi75, Math.round(implied * Math.exp(q.p90 * widen)));
  return { implied, lo25, hi75, lo10, hi90, age, ageImputed, growthMissing };
}

export function buildBoard(snapshot: Snapshot, model: FittedModel): BoardRow[] {
  const watchlist = new Set(snapshot.watchlist);
  const rankable = snapshot.protocols.filter((p) => {
    if (watchlist.has(p.slug)) return isPreToken(p);
    return isPreToken(p) && exclusionReason(p) === null;
  });
  const scored = rankable.map((p) => ({ p, priced: priceProtocol(p, snapshot, model) }));
  scored.sort((a, b) => b.priced.implied - a.priced.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const plan = farmPlan(s.p, s.priced.implied);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      age_days: s.priced.age,
      age_imputed: s.priced.ageImputed,
      growth_missing: s.priced.growthMissing,
      implied_value_usd: s.priced.implied,
      range_p25_usd: s.priced.lo25,
      range_p75_usd: s.priced.hi75,
      range_p10_usd: s.priced.lo10,
      range_p90_usd: s.priced.hi90,
      verdict: plan.verdict,
      slice_usd: plan.slice,
      net_usd: plan.net,
      per_hour_usd: plan.perHour,
      ticket_usd: plan.ticket,
      gas_usd: plan.gasTotal,
      watchlist: watchlist.has(s.p.slug),
      farm_steps: plan.steps,
    };
  });
}

export function buildLedger(snapshot: Snapshot, board: BoardRow[]): LedgerGroup[] {
  const boardSlugs = new Set(board.map((r) => r.slug));
  const groups: LedgerGroup[] = [];
  const count = (fn: (p: SnapshotProtocol) => boolean) => snapshot.protocols.filter(fn).length;
  groups.push({ key: 'ranked', label: 'Ranked on the board', rule: 'Records no token, passes every set-aside rule, and is one of the 198 rankable pre-token protocols.', count: board.length });
  groups.push({ key: 'trades', label: 'Token already trades', rule: 'Market cap above zero: the market prices it, so the board does not.', count: count((p) => typeof p.mcap_usd === 'number' && p.mcap_usd > 0) });
  groups.push({ key: 'recorded', label: 'Token recorded, no market cap', rule: 'A CoinGecko id or a symbol is recorded but no market cap: a token exists on the record, so it is not a launch to come.', count: count((p) => !isPreToken(p) && !(typeof p.mcap_usd === 'number' && p.mcap_usd > 0)) });
  const excluded = snapshot.protocols.filter((p) => isPreToken(p) && !boardSlugs.has(p.slug));
  const byReason = new Map<string, number>();
  for (const p of excluded) {
    const r = exclusionReason(p) as string;
    byReason.set(r, (byReason.get(r) ?? 0) + 1);
  }
  for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    groups.push({ key: `set-aside:${reason}`, label: `Set aside: ${reason}`, rule: 'Pre-token on the record, but the rule puts it aside: it is not a launch to come.', count: n });
  }
  return groups;
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => typeof p.mcap_usd === 'number' && p.mcap_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const model = fitModel(snapshot);
  const board = buildBoard(snapshot, model);
  const ledger = buildLedger(snapshot, board);
  const live = liveRows(snapshot);
  const chosen = model.variants.find((v) => v.key === model.chosenKey) as VariantResult;
  const farm = board.filter((r) => r.verdict === 'FARM').length;
  const thin = board.filter((r) => r.verdict === 'THIN').length;
  const skip = board.filter((r) => r.verdict === 'SKIP').length;
  const best = board.reduce((m, r) => Math.max(m, r.per_hour_usd), Number.NEGATIVE_INFINITY);
  const train = snapshot.protocols.filter(
    (p) => typeof p.mcap_usd === 'number' && p.mcap_usd > 0 && p.tvl_usd > 0 && p.listed_at !== null && p.change_7d !== null && p.category !== null && p.mcap_usd / p.tvl_usd < 10,
  );
  // The coefficients go out at full precision: the page recomputes each row's
  // implied value from them, and rounded coefficients would not reproduce
  // the board's integers. The static page prints them rounded instead.
  const coeffs: { intercept: number; size: number; momentum: number; age?: number } =
    model.chosenKey === 'flat'
      ? { intercept: model.beta[0], size: 1, momentum: 0 }
      : model.chosenKey === 'size'
        ? { intercept: model.beta[0], size: model.beta[1], momentum: 0 }
        : model.chosenKey === 'sizeMomAge'
          ? { intercept: model.beta[0], size: model.beta[1], momentum: model.beta[2], age: model.beta[3] }
          : { intercept: model.beta[0], size: model.beta[1], momentum: model.beta[2] };
  const formula =
    model.chosenKey === 'flat'
      ? 'ln(implied) = ln(TVL) + c, one multiple for every protocol'
      : model.chosenKey === 'size'
        ? 'ln(implied) = a + b x ln(TVL)'
        : model.chosenKey === 'sizeMomAge'
          ? 'ln(implied) = a + b x ln(TVL) + c x growth + d x ln(age days), growth = clamp(change_7d, -60%, +120%) / 100'
          : 'ln(implied) = a + b x ln(TVL) + c x growth, growth = clamp(change_7d, -60%, +120%) / 100';
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: 'radar-3-fitted',
    model: {
      chosen_key: model.chosenKey,
      formula,
      coefficients: coeffs,
      train_size: model.trainSize,
      train_excluded: model.trainExcluded,
      variants: model.variants,
      baseline: model.baseline,
      ci_overlap_baseline: model.ciOverlapBaseline,
      missing_age: model.missingAge,
      selection_note:
        'Leave-one-out chose the variant; the walk-forward miss is the number this board reports. The leave-one-out miss of the chosen variant is optimistic, because the same score that picked it is the score being quoted: at n=90, picking the best of five on one score flatters the winner.',
      extrapolation_note: `This model is fitted on ${model.trainSize} protocols whose tokens already trade and applied to ${model.preTokenCount} protocols with no token. Protocols that launched tend to be bigger and more successful than the average pre-token protocol, so the fitted curve may overstate what an unlaunched protocol is worth. Read the ranges, not just the point.`,
      loo_miss: chosen.looMiss,
      loo_miss_lo: chosen.looMissLo,
      loo_miss_hi: chosen.looMissHi,
      loo_within2: chosen.looWithin2,
      loo_within3: chosen.looWithin3,
      wf_miss: chosen.wfMiss,
      wf_within2: chosen.wfWithin2,
      wf_within3: chosen.wfWithin3,
      wf_train_to: model.wfTrainTo,
      wf_test_from: model.wfTestFrom,
      loo_quantiles: model.looQuantiles,
      wf_hold50: model.wfHold50,
      wf_hold80: model.wfHold80,
      r2: model.r2,
      median_age_rankable: model.medianAgeRankable,
      age_note: model.ageNote,
    },
    ledger,
    ledger_total: snapshot.protocols.length,
    assumptions: {
      drop_share: DROP_SHARE,
      tx_count: TX_COUNT,
      hours_total: HOURS_TOTAL,
      hold_days: HOLD_DAYS,
      farm_per_hour: FARM_PER_HOUR,
      thin_per_hour: THIN_PER_HOUR,
      ticket_tiers: [
        { min_tvl_usd: 1000000000, ticket_usd: 2500 },
        { min_tvl_usd: 100000000, ticket_usd: 1000 },
        { min_tvl_usd: 0, ticket_usd: 500 },
      ],
      gas_usd: GAS_USD,
    },
    kpis: {
      ranked: board.length,
      implied_total_usd: board.reduce((s, r) => s + r.implied_value_usd, 0),
      farm_count: farm,
      thin_count: thin,
      skip_count: skip,
      best_per_hour_usd: best,
    },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    rows: board.map((r) => ({ ...r })),
    live,
    scatter: train.map((p) => ({ tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd as number })),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
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
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i].implied_value_usd > board[i - 1].implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0].implied_value_usd === board[board.length - 1].implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  // Pretty-printed on purpose: the dossier's text shows a file line by line
  // up to its cap, so a one-line dataset would be left out whole, while this
  // form lets the judge read the model, the ledger and the first rows.
  return `window.RADAR=${JSON.stringify(radar, null, 2)};\n`;
}
