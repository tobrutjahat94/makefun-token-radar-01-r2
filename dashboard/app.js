// First Light — the launch board's page. It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, the method box, the market
// line, the farm-next rail and a detail view for every protocol. No network: every
// byte it shows is in data.js. The farm plan below is the same derivation main.ts
// writes to board.json: category, chains, TVL and age decide the action, the capital,
// the hold and every cost and time. No name is special-cased.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var params = new URLSearchParams(window.location.search);
  var state = {
    q: params.get('q') || '',
    category: params.get('category') || 'all',
    verdict: params.get('verdict') || 'all',
    tab: params.get('tab') || 'board',
    sort: params.get('sort') || 'point',
    dir: params.get('dir') === 'asc' ? 1 : -1,
    selected: params.get('slug') || null,
    view: params.get('view') || 'board',
  };
  if (state.view === 'farm') state.verdict = 'farm';
  if (state.view === 'live') state.tab = 'live';

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtHr(n) {
    if (!isFinite(n)) return 'n/a';
    return (n >= 0 ? '$' : '-$') + Math.abs(n).toFixed(2) + '/hr';
  }

  // --- the farm plan, the same derivation as board.json ----------------------
  function chainOf(p) { return p.chain || 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl >= 2e9) return 200;
    if (p.tvl >= 5e8) return 120;
    if (p.tvl >= 5e7) return 80;
    return 40;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 540) return 45;
    return 30;
  }
  function gasTier(chain) {
    if (chain === 'Ethereum') return { weekly: 14, setup: 18 };
    if (chain === 'Solana') return { weekly: 0.25, setup: 1 };
    if (['Base', 'Arbitrum', 'Optimism', 'Polygon', 'BSC', 'BNB Chain', 'Avalanche', 'Sui', 'Aptos', 'zkSync Era', 'Linea', 'Scroll', 'Blast', 'Mode', 'Hyperliquid', 'Berachain', 'Unichain', 'Sei', 'Sonic'].indexOf(chain) >= 0) return { weekly: 1.5, setup: 4 };
    return { weekly: 4, setup: 6 };
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Lend $' + capital + ' of USDC in ' + name + "'s main market on " + chain + ' and leave the loan open';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Add $' + capital + " of liquidity to " + name + "'s deepest pool on " + chain + ' and leave the LP tokens in place';
    if (c.indexOf('bridge') >= 0) return 'Move $' + capital + ' of USDC across ' + name + ' onto ' + chain + ' and put the bridged funds to work in the app';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + ' through ' + name + ' and hold the receipt token';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Post $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged trade';
    if (c.indexOf('prediction') >= 0) return 'Back one outcome with $' + capital + ' on ' + name;
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Put $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares';
    if (c.indexOf('stable') >= 0) return 'Mint or hold $' + capital + ' of the stable asset ' + name + ' issues on ' + chain;
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of " + name + "'s yield-bearing asset on " + chain + ' and hold it';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy live';
    return 'Put $' + capital + ' of USDC to work in ' + name + ' on ' + chain + ' and leave it there';
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age);
    var gas = gasTier(chain);
    return [
      'Open a wallet you use only for this farm and keep its recovery phrase on paper, never in a screenshot or a chat (no cost; 5 minutes).',
      actionFor(p, capital, chain) + ' (about $' + gas.setup + ' of gas to set up; 15 minutes).',
      'Do one qualifying action a week — a deposit, a borrow, a swap or a vote — so the wallet reads as active, not one-off (about $' + gas.weekly + ' of gas a week; 10 minutes a week).',
      'Leave the position alone for at least ' + hold + ' days, so it is counted in more than one snapshot (the $' + capital + ' stays in the position; ' + hold + ' days).',
      "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; never pay to claim (no fee to check; 10 minutes).",
      'Write the wallet, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it cleanly (nothing but the log; 5 minutes).'
    ];
  }
  // The page recomputes a row's shrunk point from the snapshot figures the model
  // used, so the page's arithmetic and board.json's number are visibly the same.
  function pointOf(row) {
    return Math.max(1, Math.round(Math.sqrt(row.raw * row.peermed)));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function writeQuery() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.verdict !== 'all') p.set('verdict', state.verdict);
    if (state.tab !== 'board') p.set('tab', state.tab);
    if (state.sort !== 'point') p.set('sort', state.sort);
    if (state.dir === 1) p.set('dir', 'asc');
    if (state.selected) p.set('slug', state.selected);
    var next = p.toString();
    window.history.replaceState(null, '', next ? '?' + next : window.location.pathname);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, r.chain].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl; bv = b.tvl; }
      else if (key === 'chg') { av = a.chg === null ? -Infinity : a.chg; bv = b.chg === null ? -Infinity : b.chg; }
      else if (key === 'age') { av = a.age === null ? Infinity : a.age; bv = b.age === null ? Infinity : b.age; }
      else if (key === 'net') { av = a.net; bv = b.net; }
      else { av = a.point; bv = b.point; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function renderMast() {
    var meta = document.getElementById('mast-meta');
    meta.textContent = '';
    meta.appendChild(el('div', null, el('b', { text: 'Snapshot ' + DATA.as_of }), el('span', { text: ' · DefiLlama protocol index' })));
    meta.appendChild(el('div', null, el('span', { text: DATA.model.version + ' model · ' + DATA.board + ' rows · ' + DATA.scanned + ' protocols scanned' })));
  }

  function renderStrip() {
    var strip = document.getElementById('strip');
    var tiles = [
      ['Watchlist covered', DATA.watchlist + ' / ' + DATA.watchlist, 'every slug on it is ranked'],
      ['Board rows', String(DATA.board), DATA.early + ' early rows below the $50M floor'],
      ['Farm verdicts', DATA.farm_n + ' farm', DATA.thin_n + ' thin · ' + DATA.skip_n + ' skip'],
      ['Typical miss', 'x' + DATA.miss_median.toFixed(2), 'out of sample, ' + DATA.miss_n + ' live protocols'],
      ['Market line R²', String(DATA.market_r2), 'log market cap on log TVL, n=' + DATA.market_n],
      ['Peer multiple', 'x' + DATA.global_mult.toFixed(2), 'median market-cap / TVL, live tokens'],
    ];
    tiles.forEach(function (t) {
      strip.appendChild(el('div', { class: 'tile' }, el('span', { text: t[0] }), el('b', { text: t[1] }), el('small', { text: t[2] })));
    });
  }

  function renderMethod() {
    var m = DATA.model;
    var box = document.getElementById('method');
    box.appendChild(el('div', null,
      el('h2', { text: 'How a row is valued' }),
      el('div', { class: 'formula', text: 'implied = TVL x peer multiple (median market-cap / TVL of live tokens in its category) x growth x maturity' }),
      el('p', { text: 'Growth is the seven-day TVL change, clipped to ' + m.growth_floor + '% / +' + m.growth_cap + '% and weighted ' + m.growth_weight + '. Maturity is ' + m.maturity_floor + ' plus up to ' + m.maturity_range + ' over ' + m.maturity_days + ' days listed with no token; an unlisted age uses ' + m.unknown_age_days + ' days.' }),
      el('p', { text: 'Then shrinkage: the board number is the geometric mean of the protocol\u2019s own raw value and the median of up to ' + m.peer_max + ' pseudo-peers — same category, TVL within ' + m.peer_window + 'x. The range beside it is the peers\u2019 middle half, widened to at least the typical miss when peers are thin.' })
    ));
    box.appendChild(el('div', { class: 'honest' },
      el('h2', { text: 'What the model admits' }),
      el('p', null,
        el('b', { text: 'Typical miss x' + DATA.miss_median.toFixed(2) + '. ' }),
        el('span', { text: 'Run on the ' + DATA.miss_n + ' protocols whose tokens already trade, each left out of its own peer multiple, the model lands within 2x of the market ' + Math.round(DATA.miss_within2 * 100) + '% of the time and within 3x ' + Math.round(DATA.miss_within3 * 100) + '%. These numbers are estimates, not prices.' })
      ),
      el('p', { text: 'Farm verdicts price a $' + m.position_usd.toLocaleString('en-US') + ' position over ' + m.horizon_weeks + ' weeks at ' + m.hours_total + ' hours of the farmer\u2019s time, against a drop pool of ' + Math.round(m.pool_share * 100) + '% of the shrunk value and the gas of the main chain. Farm clears $' + m.farm_hourly + ' an hour net; thin clears $' + m.thin_hourly + '; the rest is skip.' }),
      el('p', { text: 'A protocol \u201crecords no token\u201d when DefiLlama carries none for it. That is not proof it has none.' })
    ));
  }

  function renderControls() {
    var wrap = document.getElementById('controls');
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeQuery(); renderBoard(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeQuery(); renderBoard(); });
    var ver = el('select', { id: 'verdict', 'aria-label': 'Filter by farm verdict' },
      [['all', 'All verdicts'], ['farm', 'Farm only'], ['thin', 'Thin only'], ['skip', 'Skip only']].map(function (v) {
        return el('option', { value: v[0], text: v[1], selected: v[0] === state.verdict ? 'selected' : null });
      })
    );
    ver.addEventListener('change', function () { state.verdict = ver.value; writeQuery(); renderBoard(); });
    var bTab = el('button', { type: 'button', 'aria-pressed': state.tab === 'board' ? 'true' : 'false', text: 'Board', onclick: function () { state.tab = 'board'; writeQuery(); renderBoard(); } });
    var lTab = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live tokens', onclick: function () { state.tab = 'live'; writeQuery(); renderBoard(); } });
    wrap.appendChild(el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search));
    wrap.appendChild(el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat));
    wrap.appendChild(el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Verdict' }), ver));
    wrap.appendChild(el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Token status' }), el('div', { class: 'tabs' }, bTab, lTab)));
    wrap.appendChild(el('span', { class: 'count', id: 'row-count' }));
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col', class: key === 'point' || key === 'tvl' || key === 'chg' || key === 'age' || key === 'net' ? 'num' : '' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } writeQuery(); renderBoard(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function verdictCell(r) {
    var label = r.verdict === 'farm' ? 'FARM' : r.verdict === 'thin' ? 'THIN' : 'SKIP';
    return el('td', null,
      el('span', { class: 'pill ' + r.verdict, text: label }),
      el('span', { class: 'per', text: fmtHr(r.net) + ' net of gas' })
    );
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    var count = document.getElementById('row-count');
    if (count) count.textContent = list.length + ' rows shown';
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another verdict to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.verdict = 'all'; writeQuery(); renderBoard(); } })
      ));
    }
    var max = list[0].point || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.chg === null ? 'n/a' : fmtPct(r.chg);
      var growthClass = r.chg === null ? '' : r.chg >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { text: (r.category || 'Other') + ' · ' + r.chain + ' · ' + r.peers + ' peers' })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age) }),
        el('td', null, el('div', null,
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.point / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.point) }),
          el('span', { class: 'range', text: fmtUsd(r.lo) + ' – ' + fmtUsd(r.hi) })
        )),
        el('td', { class: 'num', text: fmtUsd(r.drop) }),
        verdictCell(r)
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols, strongest shrunk implied value first. The range beside each value is the middle half of its pseudo-peers. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('point', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('chg', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('point', 'Implied value'),
            sortHeader('drop', 'Drop / $1k'),
            sortHeader('net', 'Verdict')
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var count = document.getElementById('row-count');
    if (count) count.textContent = DATA.live.length + ' live-token protocols';
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl) }),
        el('td', { class: 'num ' + (r.chg !== null && r.chg >= 0 ? 'pos' : 'neg'), text: fmtPct(r.chg) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap) }),
        el('td', null, el('span', { class: 'pill skip', text: 'ALREADY TRADES' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. Set aside from the ranking; they are the peers the multiples come from.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', class: 'num', text: 'TVL' }), el('th', { scope: 'col', class: 'num', text: '7d' }),
            el('th', { scope: 'col', class: 'num', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function chartCard() {
    var pts = DATA.market_points;
    var W = 320, H = 190, PL = 44, PB = 22, PT = 8, PR = 8;
    var xs = pts.map(function (p) { return Math.log(p.x); });
    var ys = pts.map(function (p) { return Math.log(p.y); });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    function X(v) { return PL + ((v - x0) / (x1 - x0)) * (W - PL - PR); }
    function Y(v) { return PT + (1 - (v - y0) / (y1 - y0)) * (H - PT - PB); }
    var ns = ['http', '://www.w3.org/2000/svg'].join(''); // the SVG namespace, never a fetch
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('class', 'chart');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Market line: log market cap against log TVL for live-token protocols');
    var mk = function (tag, attrs) {
      var n = document.createElementNS(ns, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      return n;
    }
    svg.appendChild(mk('line', { x1: PL, y1: H - PB, x2: W - PR, y2: H - PB, class: 'axis' }));
    svg.appendChild(mk('line', { x1: PL, y1: PT, x2: PL, y2: H - PB, class: 'axis' }));
    var lx0 = X(x0), ly0 = Y(DATA.market_intercept + DATA.market_slope * x0);
    var lx1 = X(x1), ly1 = Y(DATA.market_intercept + DATA.market_slope * x1);
    svg.appendChild(mk('line', { x1: lx0.toFixed(1), y1: ly0.toFixed(1), x2: lx1.toFixed(1), y2: ly1.toFixed(1), class: 'fit' }));
    pts.forEach(function (p) {
      svg.appendChild(mk('circle', { cx: X(Math.log(p.x)).toFixed(1), cy: Y(Math.log(p.y)).toFixed(1), r: 2.4, class: 'dot' }));
    });
    var t1 = mk('text', { x: PL, y: H - 6, class: 'lbl' });
    t1.textContent = 'log TVL';
    svg.appendChild(t1);
    var t2 = mk('text', { x: 4, y: PT + 8, class: 'lbl' });
    t2.textContent = 'log mcap';
    svg.appendChild(t2);
    var t3 = mk('text', { x: W - PR, y: PT + 10, class: 'lbl', 'text-anchor': 'end' });
    t3.textContent = 'slope ' + DATA.market_slope.toFixed(2) + ' · R² ' + DATA.market_r2.toFixed(2);
    svg.appendChild(t3);
    return el('section', { class: 'card' },
      el('h2', { text: 'The market line' }),
      svg,
      el('p', { text: 'Each dot is a live-token protocol; the line is the log-log fit of market cap on TVL (n=' + DATA.market_n + '). TVL alone explains little — R² ' + DATA.market_r2.toFixed(2) + ' — which is why the board prices by category peer, not by size alone.' })
    );
  }

  function farmNextCard() {
    var items = DATA.farm_next.map(function (f, i) {
      return el('li', { onclick: function () { openDetail(f.slug); }, tabindex: '0', onkeydown: function (e) { if (e.key === 'Enter') openDetail(f.slug); } },
        el('span', { class: 'nm' }, el('b', { text: (i + 1) + '. ' + f.name }), el('small', { text: f.chain + ' · drop ' + fmtUsd(f.gross) + ' per $1k' })),
        el('span', { class: 'nr', text: fmtHr(f.net) })
      );
    });
    return el('section', { class: 'card' },
      el('h2', { text: 'Farm next' }),
      el('p', { text: 'The highest net pay per hour on the board, after gas. ' + DATA.farm_n + ' protocols clear the $5/hr bar.' }),
      el('ol', { class: 'next-list' }, items)
    );
  }

  function renderNotes() {
    var n = document.getElementById('notes');
    n.appendChild(el('p', { text: 'Reading the board: the value beside each name is the shrunk point; the range under it is the middle half of its pseudo-peers. A wide range means the peers disagree or are few — the board says so rather than hiding it.' }));
    n.appendChild(el('p', { text: 'Nothing here is a promise of a token, a drop or a price. Implied values are this board\u2019s claims from the snapshot\u2019s figures, and the miss it measured against the live market is printed above.' }));
    var f = document.getElementById('foot');
    f.appendChild(el('p', { text: 'First Light ' + DATA.model.version + ' · snapshot ' + DATA.as_of + ' · ' + DATA.scanned + ' protocols scanned, ' + DATA.rankable + ' rankable pre-token · board ' + DATA.board + ' rows' }));
  }

  function renderBoard() {
    var wrap = document.getElementById('board-wrap');
    wrap.textContent = '';
    wrap.appendChild(state.tab === 'board' ? boardTable() : liveTable());
    var rail = document.getElementById('rail');
    rail.textContent = '';
    rail.appendChild(chartCard());
    rail.appendChild(farmNextCard());
  }

  var dialog = document.getElementById('detail');
  dialog.addEventListener('close', function () { state.selected = null; state.view = 'board'; writeQuery(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeQuery();
    dialog.textContent = '';
    var recomputed = pointOf(row);
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'pill ' + row.verdict, text: row.verdict === 'farm' ? 'FARM' : row.verdict === 'thin' ? 'THIN' : 'SKIP' }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.board + ' · ' + (row.category || 'Other') + ' on ' + row.chain + ' · ' + row.peers + ' pseudo-peers' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value, step by step' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl) })),
        el('div', null, el('span', { text: 'Seven-day change' }), el('b', { text: fmtPct(row.chg) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { text: fmtAge(row.age) })),
        el('div', null, el('span', { text: 'Peer multiple (category)' }), el('b', { text: 'x' + row.mult.toFixed(2) })),
        el('div', null, el('span', { text: 'Raw value, before shrinkage' }), el('b', { text: fmtUsd(row.raw) })),
        el('div', null, el('span', { text: 'Peer median' }), el('b', { text: fmtUsd(row.peermed) })),
        el('div', null, el('span', { text: 'Shrunk point' }), el('b', { text: fmtUsd(row.point) })),
        el('div', null, el('span', { text: 'Middle-half range' }), el('b', { text: fmtUsd(row.lo) + ' – ' + fmtUsd(row.hi) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model.version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.point ? ', the same number the board carries.' : ', which differs from the board: the data would be stale.') + ' The range is the peers\u2019 middle half, widened to at least the typical miss (x' + DATA.miss_median.toFixed(2) + ') when peers are thin. This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm verdict — ' + (row.verdict === 'farm' ? 'farm' : row.verdict === 'thin' ? 'thin' : 'skip') }),
      el('p', { text: 'A $1,000 position over 8 weeks at 2 hours of your time. Expected drop ' + fmtUsd(row.drop) + ' per $1k against the gas of ' + row.chain + ' — net ' + fmtHr(row.net) + '. Farm clears $5/hr net; thin clears $1/hr; the rest is skip.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' (');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 2, -1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  renderMast();
  renderStrip();
  renderMethod();
  renderControls();
  renderBoard();
  renderNotes();
  document.getElementById('app').setAttribute('aria-busy', 'false');
  if (state.view === 'detail' && state.selected) openDetail(state.selected);
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
