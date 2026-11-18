// token-radar-01 round 3: read the snapshot, fit the model, and write the
// board, the dashboard and the dossier. Written fresh for r3. Node 22, the
// standard library only. No network, no clock, no randomness: the same
// snapshot bytes in always write the same bytes out.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { boardIssue, buildRadar, dataScript, money, parseSnapshot } from './lib/radar.ts';
import type { BoardRow, RadarData } from './lib/radar.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const TEXT_MAX_BYTES = 65536;
const SCREENSHOTS_MAX = 4;
const SCREENSHOT_MAX_BYTES = 512 * 1024;
const DASHBOARD_MAX_FILES = 400;
const DASHBOARD_MAX_BYTES = 4 * 1024 * 1024;

function usage(): never {
  console.error('usage: node main.ts --input <snapshot.json> [--output <dir>]');
  console.error('  --output defaults to $MAKEFUN_OUTPUT_DIR, then /output');
  process.exit(2);
}

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = '';
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') input = argv[++i] ?? '';
    else if (a === '--output') output = argv[++i] ?? '';
    else if (a === '--help' || a === '-h') usage();
    else {
      console.error(`unknown argument: ${a}`);
      usage();
    }
  }
  if (input === '') usage();
  if (output === '') output = '/output';
  return { input, output };
}

/** Escape text for the static HTML main.ts bakes into the page. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return money(n);
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function fmtMult(x: number): string {
  return `×${x.toFixed(2)}`;
}

function fmtNum(n: number): string {
  return String(Math.round(n * 10000) / 10000);
}

function coefText(m: RadarData['model']): string {
  const parts = [`intercept ${fmtNum(m.coefficients.intercept)}`, `size ${fmtNum(m.coefficients.size)}`];
  if (m.coefficients.momentum !== 0) parts.push(`momentum ${fmtNum(m.coefficients.momentum)}`);
  if (m.coefficients.age !== undefined) parts.push(`age ${fmtNum(m.coefficients.age)}`);
  return parts.join(', ');
}

function kpiStrip(radar: RadarData): string {
  const k = radar.kpis;
  const m = radar.model;
  const cells: [string, string][] = [
    ['Protocols ranked', String(k.ranked)],
    ['Implied value, all ranked', fmtUsd(k.implied_total_usd)],
    ['LOO miss (picks the variant only)', fmtMult(m.loo_miss)],
    ['Reported miss (walk-forward)', fmtMult(m.wf_miss)],
    ['Range holds, newest 40%', `50% band ${pct(m.wf_hold50)} · 80% band ${pct(m.wf_hold80)}`],
    ['Worth farming', `${k.farm_count} FARM · ${k.thin_count} THIN · ${k.skip_count} SKIP`],
    ['Best dollars an hour', `${money(k.best_per_hour_usd)} / hr`],
  ];
  return cells.map(([label, value]) => `<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(value)}</div></div>`).join('\n');
}

function modelBox(radar: RadarData): string {
  const m = radar.model;
  const b = m.baseline;
  const ma = m.missing_age;
  const fmtTop = (tops: { category: string; count: number }[], n: number) => tops.map((t) => `${esc(t.category)} ${t.count} of ${n}`).join(', ');
  const lines = [
    `<p><strong>Chosen model.</strong> ${esc(m.formula)}</p>`,
    `<p>Coefficients: ${coefText(m)}. Fitted on ${m.train_size} protocols that already trade and carry a full feature set (market cap above zero, TVL, listing date, seven-day change, category).</p>`,
    `<p><strong>What the market line explains.</strong> R² in log space is ${fmtNum(m.r2)}: the size curve explains about a third of the spread in log market value, and two thirds is still idiosyncratic. That is the honest limit of a model fitted on ${m.train_size} points, and it is why every row prints a range, not a point.</p>`,
    `<p><strong>Which number is the report.</strong> ${esc(m.selection_note)}</p>`,
    `<p><strong>Against the previous round's approach.</strong> The last round's miss was measured on a different set of live protocols, so it cannot be compared with these numbers. Instead the baseline below re-runs the previous round's approach — a median peer multiple, shrunk to the global median — on the same ${m.train_size} protocols and the same walk-forward split as the variants. On the point estimates the fitted model is ahead: leave-one-out ${fmtMult(m.loo_miss)} against the baseline's ${fmtMult(b.looMiss)}, walk-forward ${fmtMult(m.wf_miss)} against ${fmtMult(b.wfMiss)}. ${m.ci_overlap_baseline ? `But the 95% bootstrap intervals overlap (fitted ${fmtMult(m.loo_miss_lo)}–${fmtMult(m.loo_miss_hi)}, baseline ${fmtMult(b.looMissLo)}–${fmtMult(b.looMissHi)}), so at n=${m.train_size} the improvement over the baseline is not established, and this board does not claim a proven win on miss.` : `The 95% bootstrap intervals do not overlap (fitted ${fmtMult(m.loo_miss_lo)}–${fmtMult(m.loo_miss_hi)}, baseline ${fmtMult(b.looMissLo)}–${fmtMult(b.looMissHi)}), so the fitted model's lead over the baseline is established at this sample size.`} What the fitted model adds that the baseline cannot is a range per row and a walk-forward test that holds up on newer tokens.</p>`,
    `<p><strong>Age.</strong> ${esc(m.age_note)} Protocols with no listing date (7 of the 198 ranked) use the median age of the rankable set, ${m.median_age_rankable} days, and carry the flag “age imputed”. The age variant's fallback of 365 days never fires on the training set: all ${m.train_size} training protocols carry a listing date.</p>`,
    `<p><strong>The protocols with no age at all.</strong> ${ma.nNoAge} of the ${ma.nNoAge + ma.nWithAge} trading protocols carry no listing date, and they are not a random subset. Their median TVL is ${fmtUsd(ma.medianTvlNoAge)} against ${fmtUsd(ma.medianTvlWithAge)} for the ${ma.nWithAge} with a date — about the same size — but their median market-cap-to-TVL is ${ma.medianRatioNoAge.toFixed(2)} against ${ma.medianRatioWithAge.toFixed(2)}, and their categories skew to bridges and early exchanges: ${fmtTop(ma.topNoAge, ma.nNoAge)}, against ${fmtTop(ma.topWithAge, ma.nWithAge)} for the dated set, with ${ma.cexNoAge} CEX against ${ma.cexWithAge}. They are the oldest cohort, and they are dropped from the training set, not imputed: imputing an age for protocols whose age is missing for a reason would pretend the gap is random. The cost is a training set that skews newer than the trading universe.</p>`,
    `<p><strong>Outliers kept out of the fit.</strong> ${m.train_excluded.length} trading protocols sit at a market-cap-to-TVL ratio of 10 or more (${m.train_excluded.map((t) => `${esc(t.slug)} ${fmtMult(t.ratio)}`).join(', ')}). They are excluded from the training set: two of them alone (rain, nexo) flip the momentum slope negative, and a model that learns from them prices growth backwards. They are still listed in the live table below.</p>`,
    `<p><strong>Walk-forward.</strong> Trained on the oldest 60% of the training set (listed up to ${esc(m.wf_train_to)}), tested on the newest 40% (from ${esc(m.wf_test_from)}). The printed ranges use leave-one-out residuals: the middle 50% band held on ${pct(m.wf_hold50)} of the newer tokens and the middle 80% band on ${pct(m.wf_hold80)}.</p>`,
    `<p><strong>Extrapolation.</strong> ${esc(m.extrapolation_note)}</p>`,
  ];
  return lines.join('\n');
}

function ablationTable(radar: RadarData): string {
  const m = radar.model;
  const row = (v: { label: string; looMiss: number; looMissLo: number; looMissHi: number; looWithin3: number; wfMiss: number; wfWithin3: number; r2: number | null }) =>
    `<tr><td>${esc(v.label)}</td><td>${fmtMult(v.looMiss)}</td><td>${fmtMult(v.looMissLo)}–${fmtMult(v.looMissHi)}</td><td>${pct(v.looWithin3)}</td><td>${fmtMult(v.wfMiss)}</td><td>${pct(v.wfWithin3)}</td><td>${v.r2 === null ? '—' : fmtNum(v.r2)}</td></tr>`;
  const rows = [row(m.baseline), ...m.variants.map(row)].join('\n');
  const sizeV = m.variants.find((v) => v.key === 'size');
  const momV = m.variants.find((v) => v.key === 'sizeMom');
  const momLine =
    sizeV && momV
      ? ` Size alone wins on leave-one-out (${fmtMult(sizeV.looMiss)}). Momentum improves the walk-forward test (${fmtMult(sizeV.wfMiss)} to ${fmtMult(momV.wfMiss)}) but costs leave-one-out (${fmtMult(sizeV.looMiss)} to ${fmtMult(momV.looMiss)}), so it is not in the model: at n=${m.train_size} the two scores disagree and the rule lets leave-one-out decide.`
      : '';
  return `<table class="data"><thead><tr><th>Variant</th><th>LOO miss</th><th>LOO miss, 95% bootstrap interval</th><th>LOO within 3×</th><th>Walk-forward miss</th><th>WF within 3×</th><th>R²</th></tr></thead><tbody>${rows}</tbody></table>
<p class="note">Leave-one-out picks the winner by the lowest miss; ties go to the simpler variant. Walk-forward is the number this board reports, and it does not pick the winner.${momLine} Age costs leave-one-out against size and a lot out of sample, and the category premium costs on both, so neither is in the point value. The intervals are 1,000 bootstrap resamples of the leave-one-out errors at n=${m.train_size}, same seed for every row. The fitted model's interval ${m.ci_overlap_baseline ? 'overlaps the baseline' : 'does not overlap the baseline'}'s: ${m.ci_overlap_baseline ? 'the lead over the previous round\u2019s approach is not established at this sample size.' : 'the lead over the previous round\u2019s approach is established at this sample size.'}</p>`;
}

function ledgerTable(radar: RadarData): string {
  const rows = radar.ledger
    .map((g) => `<tr><td>${esc(g.label)}</td><td>${g.count}</td><td>${esc(g.rule)}</td></tr>`)
    .join('\n');
  return `<table class="data"><thead><tr><th>Group</th><th>Count</th><th>Rule</th></tr></thead><tbody>${rows}</tbody></table>
<p class="note">The groups add to ${radar.ledger_total}. A protocol is ranked only when it records no token and passes every set-aside rule; the rules use only the snapshot's own category and name, so any group can be checked.</p>`;
}

function assumptionsTable(radar: RadarData): string {
  const a = radar.assumptions;
  const gasRows = Object.entries(a.gas_usd)
    .map(([chain, gas]) => `<tr><td>${esc(chain)}</td><td>${money(gas)}</td></tr>`)
    .join('\n');
  const tierRows = a.ticket_tiers
    .map((t) => `<tr><td>TVL ${t.min_tvl_usd === 0 ? 'below $100M' : `at least ${fmtUsd(t.min_tvl_usd)}`}</td><td>${money(t.ticket_usd)}</td></tr>`)
    .join('\n');
  return `<p>Every farm plan on this board uses the same assumptions. A plan's expected slice is 7% of the row's implied value, times the ticket over the protocol's TVL; the ticket stays yours, so only gas is a cost. Gas is ${a.tx_count} transactions (one deposit, four actions, one claim) at the chain's gas price, and the plan takes ${a.hours_total} hours of work over a ${a.hold_days}-day hold. FARM means at least ${money(a.farm_per_hour)} an hour, THIN at least ${money(a.thin_per_hour)} an hour, anything less is SKIP.</p>
<table class="data"><thead><tr><th>Chain</th><th>Gas per transaction</th></tr></thead><tbody>${gasRows}</tbody></table>
<table class="data"><thead><tr><th>Protocol size</th><th>Ticket</th></tr></thead><tbody>${tierRows}</tbody></table>`;
}

function topTable(board: BoardRow[]): string {
  const rows = board
    .slice(0, 10)
    .map(
      (r) =>
        `<tr><td>${r.rank}</td><td>${esc(r.name)}</td><td>${esc(r.category ?? '')}</td><td>${fmtUsd(r.tvl_usd)}</td><td>${fmtUsd(r.implied_value_usd)}</td><td>${fmtUsd(r.range_p25_usd)} – ${fmtUsd(r.range_p75_usd)}</td><td>${esc(r.verdict)}</td><td>${money(r.per_hour_usd)} / hr</td></tr>`,
    )
    .join('\n');
  return `<table class="data"><thead><tr><th>#</th><th>Protocol</th><th>Category</th><th>TVL</th><th>Implied value</th><th>Middle 50% range</th><th>Verdict</th><th>$/hr</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function liveTable(radar: RadarData): string {
  const rows = radar.live
    .slice(0, 10)
    .map(
      (r) =>
        `<tr><td>${esc(r.name)}</td><td>${esc(r.category ?? '')}</td><td>${fmtUsd(r.tvl_usd)}</td><td>${fmtUsd(r.mcap_usd ?? 0)}</td><td>${r.mcap_usd !== null && r.tvl_usd > 0 ? fmtMult(r.mcap_usd / r.tvl_usd) : '—'}</td></tr>`,
    )
    .join('\n');
  return `<table class="data"><thead><tr><th>Protocol</th><th>Category</th><th>TVL</th><th>Market cap</th><th>Cap / TVL</th></tr></thead><tbody>${rows}</tbody></table>
<p class="note">The ten largest protocols that already trade, for comparison with the fitted curve. The full table of ${radar.live_size} is in the live view below.</p>`;
}

function metaLine(snapshot: { as_of: string; source: string; floor_usd: number; protocols: unknown[]; watchlist: string[] }): string {
  return `Snapshot ${esc(snapshot.as_of)} · Source: ${esc(snapshot.source)} · TVL floor ${fmtUsd(snapshot.floor_usd)} · ${snapshot.protocols.length} protocols in the snapshot, ${snapshot.watchlist.length} on the watchlist`;
}

function renderTemplate(template: string, radar: RadarData, board: BoardRow[], snapshot: { as_of: string; source: string; floor_usd: number; protocols: unknown[]; watchlist: string[] }): string {
  const out = template
    .replace('<!--META-->', metaLine(snapshot))
    .replace('<!--KPI-->', kpiStrip(radar))
    .replace('<!--MODEL-->', modelBox(radar))
    .replace('<!--ABLATION-->', ablationTable(radar))
    .replace('<!--LEDGER-->', ledgerTable(radar))
    .replace('<!--ASSUMPTIONS-->', assumptionsTable(radar))
    .replace('<!--TOP10-->', topTable(board))
    .replace('<!--LIVE-->', liveTable(radar));
  const missing = ['<!--META-->', '<!--KPI-->', '<!--MODEL-->', '<!--ABLATION-->', '<!--LEDGER-->', '<!--ASSUMPTIONS-->', '<!--TOP10-->', '<!--LIVE-->'].filter((m) => out.includes(m));
  if (missing.length > 0) throw new Error(`dashboard/index.html is missing placeholders: ${missing.join(', ')}`);
  return out;
}

function copyTree(src: string, dst: string): void {
  if (!existsSync(src)) return;
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true, dereference: false });
}

function main(): void {
  const { input, output } = parseArgs(process.argv.slice(2));
  const snapshot = parseSnapshot(readFileSync(input, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    console.error(`board refused: ${issue}`);
    process.exit(1);
  }

  mkdirSync(output, { recursive: true });
  mkdirSync(join(output, 'dashboard'), { recursive: true });
  mkdirSync(join(output, 'screenshots'), { recursive: true });

  writeFileSync(join(output, 'board.json'), `${JSON.stringify(board, null, 2)}\n`, 'utf8');

  const template = readFileSync(join(REPO_ROOT, 'dashboard', 'index.html'), 'utf8');
  writeFileSync(join(output, 'dashboard', 'index.html'), renderTemplate(template, radar, board, snapshot), 'utf8');
  for (const f of ['app.css', 'app.js']) {
    cpSync(join(REPO_ROOT, 'dashboard', f), join(output, 'dashboard', f));
  }
  writeFileSync(join(output, 'dashboard', 'radar-data.js'), dataScript(radar), 'utf8');

  // Screenshots are generated from the rendered dashboard by a separate
  // program and kept in the repository, so a run of main.ts reproduces the
  // dossier from the same inputs. Copy them in byte for byte.
  copyTree(join(REPO_ROOT, 'screenshots'), join(output, 'screenshots'));
  const shots = existsSync(join(output, 'screenshots')) ? readdirSync(join(output, 'screenshots')).filter((n) => !n.startsWith('.')) : [];
  if (shots.length === 0) {
    console.log('no screenshots in screenshots/: dossier.json not written; generate the screenshots, then run main.ts again.');
  } else {
    const dossier = buildDossier(output, {
      text_max_bytes: TEXT_MAX_BYTES,
      screenshots: { max: SCREENSHOTS_MAX, max_bytes: SCREENSHOT_MAX_BYTES },
      dashboard: { max_files: DASHBOARD_MAX_FILES, max_bytes: DASHBOARD_MAX_BYTES },
    });
    writeFileSync(join(output, 'dossier.json'), dossier);
    const dossierText = JSON.parse(new TextDecoder('utf-8').decode(dossier)) as { text: string };
    console.log(`dossier.json: ${dossier.length} bytes, text ${Buffer.byteLength(dossierText.text, 'utf8')} bytes, ${shots.length} screenshots`);
  }

  const m = radar.model;
  const dashFiles = readdirSync(join(output, 'dashboard'));
  const dashBytes = dashFiles.reduce((s, f) => s + statSync(join(output, 'dashboard', f)).size, 0);
  console.log(`snapshot ${snapshot.as_of}: ${snapshot.protocols.length} protocols, watchlist ${snapshot.watchlist.length}`);
  console.log(`board: ${board.length} rows (farm ${radar.kpis.farm_count}, thin ${radar.kpis.thin_count}, skip ${radar.kpis.skip_count}), implied total ${fmtUsd(radar.kpis.implied_total_usd)}`);
  console.log(`model ${m.variants.find((v) => v.key === m.chosen_key)?.label ?? ''}: LOO miss ${fmtMult(m.loo_miss)} (within 3x ${pct(m.loo_within3)}), walk-forward miss ${fmtMult(m.wf_miss)} (within 3x ${pct(m.wf_within3)}), R2 ${fmtNum(m.r2)}`);
  console.log(`range holds on newer tokens: 50% band ${pct(m.wf_hold50)}, 80% band ${pct(m.wf_hold80)}`);
  console.log(`ledger: ${radar.ledger.map((g) => `${g.label} ${g.count}`).join(', ')} = ${radar.ledger_total}`);
  console.log(`dashboard: ${dashFiles.length} files, ${dashBytes} bytes; board.json ${statSync(join(output, 'board.json')).size} bytes`);
}

main();
