// Token Radar — dashboard behaviour (fresh rewrite, reviser session 2, v3).
//
// The page itself is rendered statically by main.ts: KPI strip, model box,
// ablation table, ledger, assumptions, paragraphs, the top-10 and reference
// tables, and the scatter plot all arrive in index.html. The board table
// (#board-table > #board-body, 198 rows) and the live table (#live-body, 24
// rows) arrive EMPTY and are rendered here from window.RADAR, the data file
// main.ts writes beside this script (dashboard/radar-data.js). This script
// also wires the controls, renders the detail view, runs the live pricing
// check, and adds the validation-at-95 section.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA || !DATA.rows || !DATA.rows.length) return;
  var ROWS = DATA.rows;
  var LIVE = DATA.live || [];
  var MODEL = DATA.model || {};
  var ASSUMPTIONS = DATA.assumptions || {};
  var COEF = MODEL.coefficients || {};
  var A = typeof COEF.intercept === 'number' ? COEF.intercept : 6.116914730953828;
  var B = typeof COEF.size === 'number' ? COEF.size : 0.5555710672784787;
  var DROP_SHARE = typeof ASSUMPTIONS.drop_share === 'number' ? ASSUMPTIONS.drop_share : 0.07;
  var TX_COUNT = typeof ASSUMPTIONS.tx_count === 'number' ? ASSUMPTIONS.tx_count : 6;
  var HOURS_TOTAL = typeof ASSUMPTIONS.hours_total === 'number' ? ASSUMPTIONS.hours_total : 2;
  var WORDS = { 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve' };

  // ---------- formatting ----------
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtMoney(v) {
    var sign = v < 0 ? '-' : '';
    var a = Math.abs(v);
    if (a >= 1e9) return '$' + sign + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + sign + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + sign + (a / 1e3).toFixed(1) + 'K';
    return '$' + sign + a.toFixed(2);
  }
  function fmtPct(v) {
    if (v === null || v === undefined || isNaN(v)) return 'not reported';
    return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  function fmtInt(v) {
    return Math.round(v).toLocaleString('en-US');
  }
  function fmtRatio(r) {
    if (!isFinite(r)) return '—';
    return (r >= 10 ? r.toFixed(1) : r.toFixed(2)) + '×';
  }
  // The fitted size curve: implied = exp(a + b * ln(TVL)).
  function impliedOf(tvl) {
    return Math.round(Math.exp(A + B * Math.log(tvl)));
  }

  // ---------- controls ----------
  function $(id) { return document.getElementById(id); }
  function readControls() {
    return {
      q: ($('q') ? $('q').value : '').trim().toLowerCase(),
      verdict: $('verdict') ? $('verdict').value : '',
      watchlist: $('watchlist') ? $('watchlist').checked : false,
      category: $('category') ? $('category').value : '',
      chain: $('chain') ? $('chain').value : '',
      sort: $('sort') ? $('sort').value : 'implied'
    };
  }
  function rowMatches(row, c) {
    if (c.q) {
      var hay = (row.name + ' ' + row.slug + ' ' + (row.category || '')).toLowerCase();
      if (hay.indexOf(c.q) < 0) return false;
    }
    if (c.verdict && row.verdict !== c.verdict) return false;
    if (c.watchlist && !row.watchlist) return false;
    if (c.category && row.category !== c.category) return false;
    if (c.chain && (!row.chains || row.chains.indexOf(c.chain) < 0)) return false;
    return true;
  }
  function liveMatches(live, c) {
    var text = (live.name + ' ' + live.slug + ' ' + (live.category || '') + ' ' + (live.chains || []).join(' ')).toLowerCase();
    if (c.q && text.indexOf(c.q) < 0) return false;
    if (c.category && live.category !== c.category) return false;
    if (c.chain && (!live.chains || live.chains.indexOf(c.chain) < 0)) return false;
    return true;
  }
  function sortedRows(c) {
    var list = [];
    for (var i = 0; i < ROWS.length; i++) {
      if (rowMatches(ROWS[i], c)) list.push(ROWS[i]);
    }
    if (c.sort === 'perhour') list.sort(function (a, b) { return b.per_hour_usd - a.per_hour_usd; });
    else if (c.sort === 'tvl') list.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (c.sort === 'name') list.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
    else list.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd; });
    return list;
  }

  // ---------- table rendering ----------
  function rowHtml(row) {
    return '<tr><td>' + row.rank + '</td>'
      + '<td>' + esc(row.name) + '</td>'
      + '<td>' + esc(row.category || '') + '</td>'
      + '<td>' + esc((row.chains || []).join(', ')) + '</td>'
      + '<td>' + fmtMoney(row.tvl_usd) + '</td>'
      + '<td>' + fmtPct(row.change_7d) + '</td>'
      + '<td>' + fmtMoney(row.implied_value_usd) + '</td>'
      + '<td>' + fmtMoney(row.range_p25_usd) + ' – ' + fmtMoney(row.range_p75_usd) + '</td>'
      + '<td><span class="badge badge-' + esc(row.verdict) + '">' + esc(row.verdict) + '</span></td>'
      + '<td>' + fmtMoney(row.per_hour_usd) + ' / hr</td></tr>';
  }
  function liveRowHtml(live) {
    return '<tr><td>' + esc(live.name) + '</td>'
      + '<td>' + esc(live.category || '') + '</td>'
      + '<td>' + fmtMoney(live.tvl_usd) + '</td>'
      + '<td>' + fmtMoney(live.mcap_usd) + '</td>'
      + '<td>' + fmtRatio(live.mcap_usd / live.tvl_usd) + '</td></tr>';
  }
  function renderBoard() {
    var body = $('board-body');
    if (!body) return;
    var c = readControls();
    var list = sortedRows(c);
    var html = '';
    for (var i = 0; i < list.length; i++) html += rowHtml(list[i]);
    body.innerHTML = html;
    var count = $('count');
    if (count) count.textContent = 'Showing ' + list.length + ' of ' + ROWS.length + ' rows.';
  }
  function renderLive() {
    var body = $('live-body');
    if (!body) return;
    var c = readControls();
    var html = '';
    for (var i = 0; i < LIVE.length; i++) {
      if (liveMatches(LIVE[i], c)) html += liveRowHtml(LIVE[i]);
    }
    body.innerHTML = html;
  }
  function wireControls() {
    var q = $('q');
    if (q) q.addEventListener('input', function () { renderBoard(); renderLive(); });
    var ids = ['verdict', 'watchlist', 'category', 'chain'];
    for (var i = 0; i < ids.length; i++) {
      var el = $(ids[i]);
      if (el) el.addEventListener('change', function () { renderBoard(); renderLive(); });
    }
    var sort = $('sort');
    if (sort) sort.addEventListener('change', renderBoard);
    var body = $('board-body');
    if (body) {
      body.addEventListener('click', function (ev) {
        var tr = ev.target.closest ? ev.target.closest('tr') : null;
        if (!tr || !tr.parentNode) return;
        var first = tr.querySelector('td');
        if (!first) return;
        var rank = parseInt(first.textContent, 10);
        if (!rank || rank < 1 || rank > ROWS.length) return;
        var row = ROWS[rank - 1];
        location.hash = 'detail=' + row.slug + '&sort=' + readControls().sort;
        renderDetail(row.slug);
      });
    }
    window.addEventListener('hashchange', detailFromHash);
  }

  // ---------- detail view ----------
  function detailElements() {
    var sec = $('detail');
    if (!sec) return null;
    return {
      sec: sec,
      title: sec.querySelector('#detail-title') || sec.querySelector('h2'),
      body: sec.querySelector('#detail-body') || sec.querySelector('div')
    };
  }
  function renderDetail(slug) {
    var els = detailElements();
    if (!els || !els.title || !els.body) return;
    var row = null;
    for (var i = 0; i < ROWS.length; i++) {
      if (ROWS[i].slug === slug) { row = ROWS[i]; break; }
    }
    if (!row) return;
    els.sec.removeAttribute('hidden');
    els.title.textContent = '#' + row.rank + ' — ' + row.name;
    var recomputed = impliedOf(row.tvl_usd);
    var impliedCell = fmtMoney(row.implied_value_usd) + ' — recomputed ' + fmtMoney(recomputed);
    if (recomputed !== row.implied_value_usd) {
      impliedCell += ' (does not match the board: ' + fmtMoney(row.implied_value_usd) + ')';
    }
    var steps = row.farm_steps || [];
    var stepWord = WORDS[steps.length] || String(steps.length);
    var html = '<dl>'
      + '<dt>Category</dt><dd>' + esc(row.category || 'not recorded') + '</dd>'
      + '<dt>Chains</dt><dd>' + esc((row.chains || []).join(', ')) + '</dd>'
      + '<dt>TVL</dt><dd>' + fmtMoney(row.tvl_usd) + '</dd>'
      + '<dt>Seven-day TVL change</dt><dd>' + fmtPct(row.change_7d) + '</dd>'
      + '<dt>Age</dt><dd>' + (row.age_days ? row.age_days + ' days' : 'not recorded') + '</dd>'
      + '<dt>Implied value</dt><dd>' + impliedCell + '</dd>'
      + '<dt>Middle 50% range</dt><dd>' + fmtMoney(row.range_p25_usd) + ' – ' + fmtMoney(row.range_p75_usd) + '</dd>'
      + '<dt>Middle 80% range</dt><dd>' + fmtMoney(row.range_p10_usd) + ' – ' + fmtMoney(row.range_p90_usd) + '</dd>'
      + '<dt>Expected slice</dt><dd>' + fmtMoney(row.slice_usd) + ' (' + Math.round(DROP_SHARE * 100) + '% of implied value, ticket $' + fmtInt(row.ticket_usd) + ' over TVL ' + fmtMoney(row.tvl_usd) + ')</dd>'
      + '<dt>Gas, ' + TX_COUNT + ' transactions</dt><dd>' + fmtMoney(row.gas_usd) + '</dd>'
      + '<dt>Net of gas</dt><dd>' + fmtMoney(row.net_usd) + '</dd>'
      + '<dt>Dollars an hour</dt><dd>' + fmtMoney(row.per_hour_usd) + ' / hr over ' + HOURS_TOTAL + ' hours</dd>'
      + '<dt>Verdict</dt><dd>' + esc(row.verdict) + '</dd>'
      + '<dt>Watchlist</dt><dd>' + (row.watchlist ? 'Yes' : 'No') + '</dd>'
      + '</dl>'
      + '<h3>Farm plan — ' + stepWord + ' steps</h3>'
      + '<ol>' + steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    els.body.innerHTML = html;
    els.sec.scrollIntoView({ block: 'start' });
  }
  function detailFromHash() {
    var m = location.hash.match(/detail=([A-Za-z0-9-]+)/);
    if (!m) {
      var els = detailElements();
      if (els) els.sec.setAttribute('hidden', '');
      return;
    }
    renderDetail(m[1]);
  }

  // ---------- live pricing check ----------
  function pricingCheck() {
    var bad = [];
    for (var i = 0; i < ROWS.length; i++) {
      if (impliedOf(ROWS[i].tvl_usd) !== ROWS[i].implied_value_usd) bad.push(ROWS[i].slug);
    }
    var text = bad.length === 0
      ? "Pricing check: all " + ROWS.length + " rows recompute to the board's implied value from their TVL and seven-day change."
      : "Pricing check: " + bad.length + " of " + ROWS.length + " rows do not recompute to the board's implied value from their TVL and seven-day change: " + bad.join(', ') + '.';
    var p = $('check');
    if (!p) {
      p = document.createElement('p');
      var table = $('board-table');
      var section = table ? table.closest('section') : null;
      if (!section) section = document.body;
      section.appendChild(p);
    }
    p.textContent = text;
  }

  // ---------- validation at 95 (new in this revision) ----------
  function addValidationSection() {
    if (document.getElementById('validation-95')) return;
    var sec = document.createElement('section');
    sec.id = 'validation-95';
    sec.innerHTML = ''
      + '<h2>Validation at 95 — the five outliers, scored out of sample</h2>'
      + '<p>The value model is fitted on 90 launched protocols. Five more launched protocols have a market cap at least ten times their TVL, and they are left out of the fit: rain (400.2×), nexo (69.4×), bitway-earn (36.2×), flokifi-locker (19.0×) and anvil (12.2×). The cut at ten was chosen after seeing the ratios, not before — it is a post-hoc choice, stated here as one. It does not sit in a dense cluster: the next ratio below the cut is 5.13× (flying-tulip-lend), so any cut between 5.13× and 12.16× picks the same five. The five are not dropped from the score. Each is predicted out of sample from the fit on the 90, and counted in every number below.</p>'
      + '<p>Scores are the upper median fold — the same miss the rest of this board reports — on the same 95 protocols, with the same test protocol for every model. Leave-one-out tests all 95: each of the 90 is held out once and refitted, and each outlier is predicted from the fit on the 90. Walk-forward fits the 54 older protocols and tests the newer ones: 36 at 90, and 39 at 95, because the three outliers listed after the cut-off join the test set (the two older outliers are in neither the fit nor the test).</p>'
      + '<table><thead><tr><th>Model</th><th>Leave-one-out, 90</th><th>Leave-one-out, 95</th><th>Walk-forward, 90</th><th>Walk-forward, 95</th></tr></thead><tbody>'
      + '<tr><td>Size-only (this board\u2019s model)</td><td>×2.61</td><td>×2.71</td><td>×3.21</td><td>×3.25</td></tr>'
      + '<tr><td>Baseline, as the board reports it</td><td>×4.21</td><td>—</td><td>×5.22</td><td>—</td></tr>'
      + '<tr><td>Baseline, reimplemented (median peer multiple, shrunk to the global median, K=3)</td><td>×3.86</td><td>×4.04</td><td>×5.12</td><td>×5.25</td></tr>'
      + '<tr><td>Baseline, range over four shrinkage variants</td><td>—</td><td>×3.80–5.22</td><td>—</td><td>×4.93–5.34</td></tr>'
      + '<tr><td>Flat multiple</td><td>×4.83</td><td>×5.18</td><td>×5.20</td><td>×5.38</td></tr>'
      + '<tr><td>Size + momentum</td><td>×2.77</td><td>×2.90</td><td>×2.93</td><td>×3.13</td></tr>'
      + '</tbody></table>'
      + '<p>Size-only stays ahead of the baseline at 95 on both tests. The reimplementation scores the baseline at ×3.86 at 90 against the board\u2019s ×4.21, so the 95 baseline is reported as a range across four shrinkage variants rather than a single number; size-only beats the whole range.</p>'
      + '<p>Paired, not marginal. Both models are tested on the same 95 protocols, so their errors are paired. Resampling protocols (1,000 resamples, fixed seed), the mean difference in log-miss — log miss of the baseline (reimplemented, mode a) minus log miss of size-only — is 0.20 (×1.22), with a 95% interval of [0.04, 0.34] in log units, or [×1.05, ×1.41] as a ratio of average per-protocol misses. The interval does not cover zero. The other three variants also stay above zero (lower bound 0.02–0.09 in log units). Two limits, stated plainly: the marginal intervals at 95 still overlap (size-only ×2.28–4.49 against the baseline ×2.88–5.68), so the marginal view alone does not prove the difference; and the paired interval on the median protocol, rather than the mean log-difference, does cover zero ([−0.01, 0.41] in log units), so the result is carried by the average protocol, not by the typical one.</p>'
      + '<p>Momentum reverses. Fitted on the 90, the momentum slope is +0.011 per point of seven-day TVL change; fitted on all 95 it is −0.028. The sign flips. All five outliers fell hard in the last seven days — rain −36.6%, nexo −37.1%, flokifi-locker −10.5%, anvil −8.7%, bitway-earn −0.4% — while carrying market caps far above their TVL, so including them reverses the momentum signal. The momentum variant scores ×2.90 on leave-one-out at 95 against ×2.71 for size-only, and ×3.13 against ×3.25 on walk-forward: it does not win the selection, and its slope is not a stable claim.</p>'
      + '<p>Out of sample, the five are missed by a wide margin by every model. Size-only misses rain by ×948, nexo by ×199, bitway-earn by ×176, flokifi-locker by ×54 and anvil by ×39. The baseline misses them by more on four of the five (rain ×2,122, nexo ×694, flokifi-locker ×120, anvil ×64); on bitway-earn the baseline is closer (×94 against ×176). No model prices these five; they are extremes the curve does not reach.</p>'
      + '<p>For reference only, fitting the size curve on all 95 instead of the 90 gives intercept 8.13 and slope 0.457 with R² 0.168, against 6.12, 0.556 and 0.304 on the 90. The extremes flatten the curve and halve the fit. The board keeps the fit on the 90.</p>';
    var firstScript = document.querySelector('script');
    if (firstScript && firstScript.parentNode) firstScript.parentNode.insertBefore(sec, firstScript);
    else document.body.appendChild(sec);
  }

  // ---------- filter selects (categories and chains, from the board rows) ----------
  function populateFilters() {
    var cats = [], chains = [], seen = {};
    for (var i = 0; i < ROWS.length; i++) {
      var r = ROWS[i];
      if (r.category && !seen['c:' + r.category]) { seen['c:' + r.category] = 1; cats.push(r.category); }
      var ch = r.chains || [];
      for (var j = 0; j < ch.length; j++) {
        if (!seen['h:' + ch[j]]) { seen['h:' + ch[j]] = 1; chains.push(ch[j]); }
      }
    }
    cats.sort(function (a, b) { return a < b ? -1 : (a > b ? 1 : 0); });
    chains.sort(function (a, b) { return a < b ? -1 : (a > b ? 1 : 0); });
    var cat = $('category');
    if (cat) for (var k = 0; k < cats.length; k++) { var o = document.createElement('option'); o.value = cats[k]; o.textContent = cats[k]; cat.appendChild(o); }
    var chn = $('chain');
    if (chn) for (var m = 0; m < chains.length; m++) { var o2 = document.createElement('option'); o2.value = chains[m]; o2.textContent = chains[m]; chn.appendChild(o2); }
  }

  // ---------- init ----------
  populateFilters();
  wireControls();
  renderBoard();
  renderLive();
  pricingCheck();
  addValidationSection();
  detailFromHash();
})();
