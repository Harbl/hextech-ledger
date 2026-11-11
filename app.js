/* Hextech Ledger — Riftbound event scoreboard
 *
 * Two windows share one state: the control panel (laptop) and the display (TV).
 * State lives in localStorage and changes are pushed over BroadcastChannel, so
 * either window can be refreshed mid-event without losing anything.
 */

// Set this after deploying worker/index.js. Only needed for a hosted deployment.
const PROXY = '';

// Riot's event pages send no CORS headers, so the browser can't read them
// directly. tools/serve.js (and serve.pl, and the Worker) relay
// /riot/events/{id} to the public page. Running locally that relay is the page's
// own origin, hence the empty base.
function apiBase() {
  if (PROXY) return PROXY.replace(/\/$/, '');
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return '';
  return null;
}

const KEY = 'hextech-ledger';

// Renamed from Magma Chamber. A shop part-way through a season must not lose its
// archive or its branding to a rename, so the old keys are copied across once,
// before anything reads them. The originals are left alone as a safety net.
for (const suffix of ['', '-logo', '-tvscale']) {
  try {
    const old = localStorage.getItem('magma-chamber' + suffix);
    if (old !== null && localStorage.getItem(KEY + suffix) === null)
      localStorage.setItem(KEY + suffix, old);
  } catch { /* private mode, or no storage at all */ }
}

const WIN = 3, DRAW = 1;               // match points
const chan = new BroadcastChannel(KEY);
const isDisplay = new URLSearchParams(location.search).has('display');

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const uid = () => Math.random().toString(36).slice(2, 9);

// Mirrors the --d-* variables in app.css, which is where the reasoning behind
// these particular steps is written down. SVG presentation attributes cannot
// take var(), so the values have to exist here too; a test holds the two in step.
const DOMAIN_COLOR = {
  Fury: '#ff5147', Body: '#ffa033', Order: '#f5e663',
  Calm: '#35d07f', Mind: '#41b8f5', Chaos: '#b06bff', Colorless: '#94a3b8',
};

let legends = [];
let state = load();

// ---------------------------------------------------------------- state

function blank() {
  return {
    mode: null,             // '1v1' | '2v2', chosen on the splash screen
    manual: false,          // unofficial night: no locator event, this app pairs
    name: '', minutes: 50, byePoints: 8, tables: 8, pairingMinutes: 8, overtime: 0,
    shopName: '', brandMode: 'text',   // venue half of the TV lockup; logo itself is in LOGO_KEY
    eventId: '', uvsMode: false,       // locator event, and whether it owns the pairings
    uvsRound: 0, uvsPairings: null, uvsStandings: null,
    players: [],            // {id, name, legend}
    teams: [],              // {id, name, players:[id,id], custom:bool}
    rounds: [],             // {n, pairings:[{a, b|null, winner, pa, pb}], endsAt, pausedMs, running}
    order: null,            // manual team-id order for the TV, or null
    archive: [],
  };
}

// The winner is picked explicitly by tapping a team name, then both scores are
// entered for the leaderboard. A match counts once both steps are done.
const outcome = p => p.b === null ? 'a' : (p.winner || null);
const reported = p => p.b === null
  ? p.pa != null
  : (!!p.winner && p.pa != null && p.pb != null);

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? purgeMeta({ ...blank(), ...JSON.parse(raw) }) : blank();
  } catch { return blank(); }
}

// Riot's developer terms forbid *retaining* metagame-defining data, not just
// publishing it -- play rates and win rates for decks and cards. A Legend is a
// deck's defining card, so nothing keyed to one is archived any more. Archives
// written before that rule are stripped here rather than left sitting in
// localStorage, because stopping recording is not the same as not retaining.
function purgeMeta(s) {
  for (const ev of s.archive || []) {
    (ev.players || []).forEach(p => { delete p.legend; });
    (ev.standings || []).forEach(r => { delete r.legends; });
  }
  return s;
}

function save(broadcast = true) {
  localStorage.setItem(KEY, JSON.stringify(state));
  if (broadcast) chan.postMessage(state);
  render();
}

chan.onmessage = e => { if (!e.data.logo) state = e.data; render(); };

// ---------------------------------------------------------------- shop logo
//
// The logo lives in its own localStorage key rather than in `state`, because
// `state` is re-serialised and broadcast on every keystroke -- pushing a few
// hundred KB of data URL through that each time is needless. Both windows share
// the same origin, so the display reads the key itself and is only told to
// re-render, by a {logo:true} ping.
const LOGO_KEY = KEY + '-logo';
const logoUrl = () => { try { return localStorage.getItem(LOGO_KEY) || ''; } catch { return ''; } };

// Branding belongs to the venue, not the event, so it has to be carried across
// the blank() rebuilds done by archiving and Reset everything. The logo itself
// needs no help -- it is in its own key.
const venue = () => ({ shopName: state.shopName, brandMode: state.brandMode });

function setLogo(url) {
  try {
    if (url) localStorage.setItem(LOGO_KEY, url); else localStorage.removeItem(LOGO_KEY);
  } catch { return false; }   // quota: still too big even after shrinking
  chan.postMessage({ logo: true });
  render();
  return true;
}

// Anything larger than this is redrawn before being stored. 512px covers the
// header box even on a 4K panel, and keeps a photo-heavy logo inside quota.
const LOGO_MAX = 512;

function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('unreadable'));
    fr.onload = () => {
      // SVG is already resolution-independent and has no pixel size to shrink.
      if (file.type === 'image/svg+xml') return resolve(fr.result);
      const img = new Image();
      img.onerror = () => reject(new Error('not an image'));
      img.onload = () => {
        const scale = Math.min(1, LOGO_MAX / Math.max(img.width, img.height));
        if (scale === 1) return resolve(fr.result);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));   // PNG so a transparent logo stays transparent
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

// Assigning .src re-decodes the image, and render() runs on every keystroke, so
// only touch it when it actually changed.
function setImg(sel, url) {
  const el = $(sel);
  if (el.getAttribute('src') !== url) el.setAttribute('src', url);
  el.hidden = !url;
}

// ---------------------------------------------------------------- lookups

// The mode decides which tabs and settings exist at all. Anything carrying
// data-only is shown only when every token it lists is active, so the markup
// declares its own relevance rather than this having to know about each control.
// Tokens: the mode itself, manual|official, and mirror|local.
const MODE_TABS = {
  '1v1': ['setup', 'round', 'stats', 'settings'],                                      // mirroring the locator
  '1v1-manual': ['setup', 'round', 'results', 'standings', 'stats', 'settings'],       // we run it: solo players
  '2v2': ['setup', 'teams', 'round', 'results', 'standings', 'stats', 'settings'],
};

// Manual 1v1 reuses the whole team machinery with one player per team, which is
// why it gets Results and Standings while the mirrored version does not.
const soloMode = () => state.mode === '1v1' && !!state.manual;
const tabKey = () => (soloMode() ? '1v1-manual' : state.mode);
// Official 2v2: Riot pairs the captains, this app scores the teams.
const teamsOnRiot = () => state.mode === '2v2' && !state.manual;

function viewTokens() {
  return [state.mode, state.manual ? 'manual' : 'official', state.uvsMode ? 'mirror' : 'local',
    state.uvsMode || teamsOnRiot() ? 'riot' : 'self'];
}

const team = id => state.teams.find(t => t.id === id);
const player = id => state.players.find(p => p.id === id);
const teamName = id => { const t = team(id); return t ? t.name : '?'; };
const currentRound = () => state.rounds[state.rounds.length - 1] || null;
const unassigned = () => state.players.filter(p => !state.teams.some(t => t.players.includes(p.id)));

function legendOf(name) { return legends.find(l => l.name === name) || null; }

function legendColor(name) {
  const l = legendOf(name);
  return l && l.domains.length ? (DOMAIN_COLOR[l.domains[0]] || DOMAIN_COLOR.Colorless) : 'transparent';
}

// Riot's CDN is a Sanity instance, so a square top crop at webp turns a ~1.1MB
// card scan into ~6KB -- worth doing when a dozen of these sit on screen.
function legendArt(name) {
  const l = legendOf(name);
  if (!l || !l.image) return null;
  return l.image + (l.image.includes('?') ? '&' : '?') + 'w=160&h=160&fit=crop&crop=top&fm=webp';
}

// ---------------------------------------------------------------- scoring

function records() {
  const rec = {};
  // gp = cumulative game points scored, which is what ranks the leaderboard.
  // pts = match points (3/1/0), kept as a tiebreaker and for the W-L-D record.
  for (const t of state.teams) rec[t.id] = { id: t.id, w: 0, l: 0, d: 0, pts: 0, gp: 0, opps: [], byes: 0 };

  for (const round of state.rounds) {
    for (const p of round.pairings) {
      const res = outcome(p);
      if (!res) continue;
      if (p.b === null) { // bye counts as a win, but isn't an opponent for tiebreakers
        if (rec[p.a]) { rec[p.a].w++; rec[p.a].pts += WIN; rec[p.a].gp += p.pa || 0; rec[p.a].byes++; }
        continue;
      }
      const A = rec[p.a], B = rec[p.b];
      if (!A || !B) continue;
      A.opps.push(p.b); B.opps.push(p.a);
      A.gp += p.pa || 0; B.gp += p.pb || 0;
      if (res === 'draw') { A.d++; B.d++; A.pts += DRAW; B.pts += DRAW; }
      else if (res === 'a') { A.w++; A.pts += WIN; B.l++; }
      else if (res === 'b') { B.w++; B.pts += WIN; A.l++; }
    }
  }

  // Opponent match-win %, floored at 33% the way Swiss tiebreakers normally are.
  const winPct = r => {
    const games = r.w + r.l + r.d;
    return games ? Math.max((r.w + r.d * 0.5) / games, 0.33) : 0.33;
  };
  for (const r of Object.values(rec)) {
    const os = r.opps.map(id => rec[id]).filter(Boolean);
    r.omw = os.length ? os.reduce((s, o) => s + winPct(o), 0) / os.length : 0;
  }
  return rec;
}

// Official 2v2: a team Riot never paired didn't turn up (its captain was dropped
// as a no-show), so once Riot has paired anything it is left off the standings
// and the archive rather than sitting on the TV at 0 points all night.
function playedTeams() {
  if (!teamsOnRiot() || !state.rounds.some(r => r.pairings.length)) return state.teams;
  const ids = new Set(state.rounds.flatMap(r => r.pairings.flatMap(p => [p.a, p.b])));
  return state.teams.filter(t => ids.has(t.id));
}

function standings() {
  const rec = records();
  const list = playedTeams().map(t => ({ ...rec[t.id], team: t }));
  if (state.order) {
    const pos = Object.fromEntries(state.order.map((id, i) => [id, i]));
    return list.sort((a, b) => (pos[a.id] ?? 99) - (pos[b.id] ?? 99));
  }
  // Ranked on cumulative game points, with match points then OMW breaking ties.
  return list.sort((a, b) =>
    b.gp - a.gp || b.pts - a.pts || b.omw - a.omw || a.team.name.localeCompare(b.team.name));
}

// ---------------------------------------------------------------- pairings

function alreadyPlayed(a, b) {
  return state.rounds.some(r => r.pairings.some(p =>
    (p.a === a && p.b === b) || (p.a === b && p.b === a)));
}

function makePairings() {
  const ranked = standings().map(s => s.id);
  const rec = records();
  let pool = [...ranked];
  let bye = null;

  if (pool.length % 2 === 1) {
    // Lowest-ranked team that hasn't had a bye yet.
    for (let i = pool.length - 1; i >= 0; i--) {
      if (!rec[pool[i]] || rec[pool[i]].byes === 0) { bye = pool[i]; break; }
    }
    if (bye === null) bye = pool[pool.length - 1];
    pool = pool.filter(id => id !== bye);
  }

  // Pair down the standings, backtracking when the only option is a rematch.
  const pairs = walk(pool);
  if (!pairs) return null;
  // Tables run 1..n down the standings, so table 1 is always the feature match.
  pairs.forEach((p, i) => { p.table = i + 1; });
  if (bye !== null) pairs.push({ a: bye, b: null, winner: null, pa: state.byePoints ?? 8, pb: null, table: null });
  return pairs;

  function walk(rest) {
    if (!rest.length) return [];
    const [a, ...others] = rest;
    for (const b of others) {
      if (alreadyPlayed(a, b)) continue;
      const tail = walk(others.filter(x => x !== b));
      if (tail) return [{ a, b, winner: null, pa: null, pb: null }, ...tail];
    }
    // Everyone left is a rematch; allow it rather than failing to pair.
    if (others.length) {
      const b = others[0];
      const tail = walk(others.slice(1));
      if (tail) return [{ a, b, winner: null, pa: null, pb: null }, ...tail];
    }
    return null;
  }
}

// ---------------------------------------------------------------- timer

function remainingMs() {
  const r = currentRound();
  if (!r) return null;
  if (!r.running) return r.pausedMs ?? state.minutes * 60000;
  return Math.max(0, r.endsAt - Date.now());
}

// What the TV should actually show. Once the round clock reaches zero an
// optional overtime clock takes over and counts down from state.overtime in
// red; with overtime set to 0 it goes straight to "Time!" as it always did.
function clock() {
  const r = currentRound();
  if (!r) return { ms: null, phase: 'idle' };
  const total = (state.minutes || 50) * 60000;
  if (!r.running) return { ms: r.pausedMs ?? total, phase: 'paused' };
  const left = r.endsAt - Date.now();
  if (left > 0) return { ms: left, phase: 'main' };
  const ot = (state.overtime || 0) * 60000;
  // `left` is negative past time, so ot + left is what is left of overtime.
  if (ot > 0 && ot + left > 0) return { ms: ot + left, phase: 'overtime' };
  return { ms: 0, phase: 'done' };
}

function fmt(ms) {
  if (ms === null) return '--:--';
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- render

function render() {
  if (isDisplay) renderDisplay(); else renderControl();
}

// Art if the player has a Legend, otherwise a plain domain-coloured dot.
function playerChip(id) {
  const p = player(id);
  if (!p) return '';
  const art = legendArt(p.legend);
  const mark = art
    ? `<img class="legend-art" src="${art}" alt="${esc(shortLegend(p.legend))}"
         title="${esc(p.legend)}" style="border-color:${legendColor(p.legend)}" loading="lazy">`
    : '<i class="legend-chip" style="background:var(--line)"></i>';
  return `<span>${mark}${esc(p.name)}</span>`;
}

// Venue half of the lockup. A logo wins when that mode is picked and one is
// stored; otherwise the shop name. With neither, the whole venue half drops out
// -- including the "x", which would have nothing left to join.
function renderBrand() {
  const url = state.brandMode === 'logo' ? logoUrl() : '';
  const name = url ? '' : (state.shopName || '');
  setImg('#dsp-logo', url);
  $('#dsp-shop').textContent = name;
  $('#dsp-shop').hidden = !name;
  $('#dsp-x').hidden = !url && !name;
}

function renderDisplay() {
  renderBrand();
  const r = currentRound();
  const mode = displayMode();
  if (mode !== lastMode) { scrollAt = 0; atBottom = false; holdUntil = 0; }
  lastMode = mode;
  const roundName = state.uvsMode ? (state.uvsRound ? `Round ${state.uvsRound}` : '')
    : r ? `Round ${r.n}` : '';
  $('#dsp-round').textContent = !roundName ? 'Waiting to start'
    : `${roundName} — ${mode === 'pairings' ? 'Pairings' : 'Standings'}`;

  $('#dsp-pairings').hidden = mode !== 'pairings';
  $('#dsp-standings').hidden = mode === 'pairings';

  if (mode === 'pairings') {
    $('#dsp-empty').hidden = true;
    $('#dsp-pairings').innerHTML = displayPairings().map(p => p.bye
      ? `<li class="pr-row pr-bye">
           <div class="pr-table">—</div>
           <div class="pr-teams"><span class="pr-team">${esc(p.names[0])}</span></div>
           <div class="pr-bye-tag">BYE</div>
         </li>`
      : `<li class="pr-row">
           <div class="pr-table"><i>Table</i>${p.table ?? '—'}</div>
           <div class="pr-teams">
             ${p.names.map(n => `<span class="pr-team">${esc(n)}</span>`)
                      .join('<span class="pr-vs">vs</span>')}
           </div>
         </li>`).join('');
    tick();
    return;
  }

  // Mirroring UVS means showing UVS's own standings -- ranked on its match
  // points, not this app's game points, because nothing is scored here.
  const rows = state.uvsMode
    ? (state.uvsStandings || []).map((s, i) => ({
        rank: s.rank ?? i + 1, name: s.name, chips: '',
        w: s.w, l: s.l, d: s.d, points: s.pts,
      }))
    : standings().map((s, i) => ({
        rank: i + 1, name: s.team.name, chips: s.team.players.map(playerChip).join(''),
        w: s.w, l: s.l, d: s.d, points: s.gp,
      }));

  $('#dsp-empty').hidden = rows.length > 0;
  $('#dsp-empty').textContent = state.uvsMode ? 'Waiting for the Riftbound page to post pairings.'
    : state.mode === '1v1' ? 'Add players to get started.' : 'Add teams to get started.';
  $('#dsp-standings').innerHTML = rows.map((s, i) => `
    <li class="${i === 0 ? 'top' : ''}" style="--rank-color:${i === 0 ? 'var(--brass)' : 'var(--line)'}">
      <div class="st-rank">${s.rank}</div>
      <div class="st-team">
        <div class="st-name">${esc(s.name)}</div>
        ${s.chips ? `<div class="st-players">${s.chips}</div>` : ''}
      </div>
      <div class="st-record">${s.w}-${s.l}${s.d ? `-${s.d}` : ''}</div>
      <div class="st-points">${s.points}<i class="st-pts-label">pts</i></div>
    </li>`).join('');

  tick();
}

let lastMode = null;

function tick() {
  if (!isDisplay) return;
  // The pairings-to-standings switch is time-based, so poll for it here.
  if (displayMode() !== lastMode) { renderDisplay(); return; }
  const el = $('#dsp-timer'), label = $('#dsp-timer-label');
  const { ms, phase } = clock();
  el.textContent = fmt(ms);
  el.className = 'timer';
  if (phase === 'idle') { label.textContent = 'Round Timer'; return; }
  if (phase === 'paused') { el.classList.add('paused'); label.textContent = 'Paused'; return; }
  if (phase === 'overtime') { el.classList.add('overtime'); label.textContent = 'Overtime'; return; }
  if (phase === 'done') { el.classList.add('done'); label.textContent = 'Time!'; return; }
  label.textContent = 'Time Remaining';
  if (ms < 60000) el.classList.add('crit');
  else if (ms < 5 * 60000) el.classList.add('warn');
}

function shortLegend(n) { return n.split(' - ')[0]; }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function renderControl() {
  applyMode();
  if (!state.mode && !settingsOnly) return;   // splash is up; nothing behind it needs filling in

  $('#ev-name').value = state.name;
  $('#ev-minutes').value = state.minutes;
  $('#ev-bye').value = state.byePoints ?? 8;
  $('#ev-tables').value = state.tables ?? 8;
  $('#ev-pairing-mins').value = state.pairingMinutes ?? 8;
  $('#ev-overtime').value = state.overtime ?? 0;

  const logo = logoUrl();
  $('#ev-shop').value = state.shopName || '';
  $('#brand-logo').checked = state.brandMode === 'logo';
  $('#brand-text').checked = state.brandMode !== 'logo';
  $('#btn-logo-clear').disabled = !logo;
  setImg('#logo-img', logo);
  $('#logo-preview').hidden = !logo;
  $('#player-count').textContent = state.players.length ? `(${state.players.length})` : '';
  $('#archive-count').textContent = state.archive.length ? `(${state.archive.length})` : '';

  $('#save-dir-name').textContent = saveDirName
    ? `Saving to “${saveDirName}”. The browser asks you to confirm once each time it starts up.`
    : hasFS()
      ? 'No folder chosen — archives and exports go to your Downloads folder.'
      : 'This browser cannot pick a folder, so files go to Downloads. Chrome or Edge can.';
  $('#btn-save-dir-clear').disabled = !saveDirName;

  $('#ev-manual').checked = !!state.manual;
  $('#manual-hint').textContent = state.manual
    ? 'This app makes the pairings, assigns tables and keeps the scores. Nothing is read from the Riftbound event page.'
    : state.mode === '1v1'
      ? 'The Riftbound event page owns the pairings and the players report there. This app mirrors it and runs the clock.'
      : 'Import signups before anyone is dropped, make the teams, then drop each teammate on the Riftbound page so only captains are left. It pairs the captains; this app shows the teams and keeps the points. Importing again later only adds people, so teammates are never lost.';

  // players
  $('#player-list').innerHTML = state.players.map(p => `
    <li data-player="${p.id}">
      <span class="grow">${esc(p.name)}</span>
      <select data-legend="${p.id}">
        <option value="">No legend</option>
        ${legends.map(l => `<option value="${esc(l.name)}" ${l.name === p.legend ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
      </select>
      <button class="ghost sm" data-del-player="${p.id}">Remove</button>
    </li>`).join('') || '<li class="sub">No players yet.</li>';

  // team pickers
  const free = unassigned();
  const opts = free.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  $('#pick-a').innerHTML = `<option value="">Player 1</option>${opts}`;
  $('#pick-b').innerHTML = `<option value="">Player 2</option>${opts}`;

  $('#team-list').innerHTML = state.teams.map(t => `
    <li>
      <span class="grow"><b>${esc(t.name)}</b><br><span class="sub">${t.players.map(id => esc(player(id)?.name ?? '?')).join(' &amp; ')}</span></span>
      <button class="ghost sm" data-rename="${t.id}">Rename</button>
      <button class="ghost sm" data-del-team="${t.id}">Disband</button>
    </li>`).join('') || '<li class="sub">No teams yet.</li>';

  // round
  const r = currentRound();
  $('#round-num').textContent = r ? r.n : '—';

  // Once the locator owns the pairings, local pairing has to be off or the two
  // disagree and results get reported against the wrong matches.
  const locked = state.uvsMode;
  $('#uvs-lock').hidden = !state.uvsMode;
  $('#btn-uvs').disabled = !state.uvsMode && !teamsOnRiot();
  ['#btn-pair', '#btn-next-round'].forEach(sel => { $(sel).disabled = locked; });
  // Mirroring UVS: nothing is scored here, so the list is read-only and just
  // shows what the players are looking at, including who has reported.
  if (state.uvsMode) {
    const rows = state.uvsPairings || [];
    $('#pairing-list').innerHTML = !rows.length
      ? '<li class="sub">Nothing pulled from the Riftbound page yet.</li>'
      : rows.map(p => `<li>
          <span class="grow">${p.bye
            ? `${esc(p.names[0] || '?')} <span class="bye">BYE</span>`
            : esc(p.names.join('  vs  '))}</span>
          ${p.table ? `<span class="table-tag">Table ${p.table}</span>` : ''}
          <span class="sub">${p.done ? (p.winner ? `${esc(p.winner)} won` : 'Reported') : 'Playing'}</span>
        </li>`).join('');
    // UVS owns the standings too, so the local team table would only mislead.
    $('#ctl-standings').innerHTML = (state.uvsStandings || []).map(s => `
      <li><span class="grow"><b>${s.rank}. ${esc(s.name)}</b><br>
        <span class="sub">${s.w}-${s.l}${s.d ? `-${s.d}` : ''} &middot; ${s.pts} match pts</span>
      </span></li>`).join('') || '<li class="sub">Nothing pulled from the Riftbound page yet.</li>';
    renderStats();
    return;
  }

  $('#pairing-list').innerHTML = !r ? '<li class="sub">No pairings yet.</li>' : r.pairings.map((p, i) => {
    if (p.b === null) return `<li><span class="grow">${esc(teamName(p.a))}</span>
      <span class="bye">BYE &middot; ${p.pa} pts</span></li>`;
    const tableTag = p.table ? `<span class="table-tag">Table ${p.table}</span>` : '';
    const w = p.winner;
    const cls = side => w ? (w === 'draw' ? 'drew' : (w === side ? 'won' : 'lost')) : '';
    return `<li class="pair-card">
      <div class="pair-teams">
        ${tableTag}
        <button class="team-pick ${cls('a')}" data-pick="${i}:a">${esc(teamName(p.a))}</button>
        <span class="pair-vs">vs</span>
        <button class="team-pick ${cls('b')}" data-pick="${i}:b">${esc(teamName(p.b))}</button>
        <button class="draw-pick ${w === 'draw' ? 'drew' : ''}" data-pick="${i}:draw">Draw</button>
        ${w ? `<button class="clear-pick" data-pick="${i}:">Clear</button>` : ''}
      </div>
      ${w ? `<div class="pair-scores">
        <label class="score"><span>${esc(teamName(p.a))} points</span>
          <input type="number" min="0" data-pts="${i}:a" value="${p.pa ?? ''}"></label>
        <label class="score"><span>${esc(teamName(p.b))} points</span>
          <input type="number" min="0" data-pts="${i}:b" value="${p.pb ?? ''}"></label>
        ${reported(p) ? '<span class="result-note done">Recorded</span>'
                      : '<span class="result-note">Enter both scores</span>'}
      </div>` : '<p class="pair-hint">Tap the winning team.</p>'}
    </li>`;
  }).join('');

  // standings
  $('#ctl-standings').innerHTML = standings().map((s, i) => `
    <li draggable="true" data-team="${s.id}">
      <span class="grow"><b>${i + 1}. ${esc(s.team.name)}</b><br>
        <span class="sub"><b>${s.gp} pts</b> &middot; ${s.w}-${s.l}${s.d ? `-${s.d}` : ''} &middot; ${s.pts} match pts &middot; OMW ${(s.omw * 100).toFixed(0)}%</span>
      </span>
    </li>`).join('') || '<li class="sub">No teams yet.</li>';

  renderResults();
  renderStats();
}

function renderResults() {
  const sel = $('#res-round');
  const rounds = state.rounds.filter(r => r.pairings.length).map(r => r.n);
  // Default to the round just finished, which is the one being typed up.
  const want = rounds.includes(+sel.value) ? +sel.value : rounds[rounds.length - 1];
  sel.innerHTML = rounds.map(n => `<option value="${n}"${n === want ? ' selected' : ''}>Round ${n}</option>`).join('');

  const rows = want === undefined ? [] : roundResults(want);
  $('#btn-copy-results').disabled = !rows.length;
  $('#results-list').innerHTML = rows.length
    ? rows.map(r => `<li class="res-row ${r.result ? r.result.toLowerCase() : 'pending'}">
        <span class="grow"><b>${esc(r.name)}</b><br><span class="sub">${esc(r.team)}${r.bye ? ' &middot; bye' : ''}</span></span>
        <span class="res-tag">${r.result || 'not reported'}</span>
      </li>`).join('')
    : '<li class="sub">Nothing to report yet — pair a round and record some results.</li>';
}

// ----------------------------------------------------------------- stats
//
// The Stats tab is split in two because the halves work on different
// time-scales: an archived night stands on its own, player records only mean
// anything across nights.
//
// There is deliberately no Legend or domain breakdown in here. Riot's developer
// terms forbid publishing or retaining metagame-defining data -- play rates and
// win rates for decks and cards -- and a Legend is a deck's defining card, so
// counting who brought what is precisely the prohibited thing. Legends are still
// picked per player and shown on the live leaderboard; they are never counted,
// never exported and never archived. See purgeMeta().

function eventPanel(ev, i) {
  const top8 = (ev.standings || []).slice(0, 8);
  return `<div class="ev-detail">
    <h3>Top ${top8.length}</h3>
    <ol class="top8">${top8.map(s => `<li>
      <span class="pl">${s.place}</span>
      <span class="grow"><b>${esc(s.name)}</b><br><span class="sub">${esc((s.players || []).join(' & '))}</span></span>
      <span class="sub">${s.w}-${s.l}${s.d ? `-${s.d}` : ''}</span>
      <b class="gp">${s.gp ?? 0}</b>
    </li>`).join('') || '<li class="sub">No standings saved.</li>'}</ol>
    <div class="row">
      <button class="ghost sm" data-del-archive="${i}">Delete this event</button>
    </div>
  </div>`;
}

let openEvent = -1;     // which archived event is expanded; view state, not saved

function renderStats() {
  $('#archive-count').textContent = state.archive.length ? `(${state.archive.length})` : '';
  $('#archive-list').innerHTML = state.archive.length ? state.archive.map((ev, i) => `
    <li class="ev ${openEvent === i ? 'open' : ''}">
      <button class="ev-head" data-event="${i}" aria-expanded="${openEvent === i}">
        <span class="grow"><b>${esc(ev.name || 'Untitled event')}</b><br>
          <span class="sub">${new Date(ev.date).toLocaleDateString()} &middot;
          ${(ev.teams || []).length} teams &middot; won by ${esc(ev.standings?.[0]?.name ?? '—')}</span></span>
        <span class="chev" aria-hidden="true">${openEvent === i ? '&minus;' : '+'}</span>
      </button>
      ${openEvent === i ? eventPanel(ev, i) : ''}
    </li>`).join('')
    : '<li class="sub">No saved events yet. Finish and archive a night and it appears here.</li>';

  const hist = playerHistory();
  $('#hist-count').textContent = hist.length ? `(${hist.length})` : '';
  $('#btn-export-history').disabled = !hist.length;
  const most = Math.max(1, ...hist.map(e => e.played));
  $('#hist-list').innerHTML = hist.length ? hist.map(e => `
    <li>
      <span class="grow"><b>${esc(e.name)}</b><br>
        <span class="sub">${e.w}-${e.l}${e.d ? `-${e.d}` : ''} &middot; ${(e.winPct * 100).toFixed(0)}% &middot;
        ${e.events} night${e.events === 1 ? '' : 's'}${e.wins ? ` &middot; ${e.wins} won` : ''}</span></span>
      <span class="bar-track wins" title="${e.w} of ${e.played} matches won">
        <i style="width:${(e.played / most) * 100}%"><em style="width:${e.winPct * 100}%"></em></i></span>
    </li>`).join('') : '<li class="sub">Nothing yet — finish and archive a night and everyone who played shows up here.</li>';
}

// ------------------------------------------------------- round results
//
// Carde.io has no public API we can reach, so reporting stays manual. What the
// organiser actually needs between rounds is every player listed A-Z with their
// own result, because a "multiplayer unpaired" event is entered player by player
// and hunting for names in pairing order is where the time goes.
//
// Both team-mates take their team's result -- that is the whole point of the 2v2
// workaround, and it means nobody has to be dropped from the event.

function roundResults(n) {
  const round = state.rounds.find(r => r.n === n);
  if (!round) return [];
  const rows = [];
  for (const p of round.pairings) {
    const res = outcome(p);
    const sides = p.b === null ? [[p.a, 'Win']] : [
      [p.a, res === 'draw' ? 'Draw' : res === 'a' ? 'Win' : res === 'b' ? 'Loss' : null],
      [p.b, res === 'draw' ? 'Draw' : res === 'b' ? 'Win' : res === 'a' ? 'Loss' : null],
    ];
    for (const [teamId, result] of sides) {
      const t = team(teamId);
      if (!t) continue;
      for (const id of t.players) {
        const pl = player(id);
        if (pl) rows.push({ name: pl.name, team: t.name, result, bye: p.b === null });
      }
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

const resultsText = n => roundResults(n)
  .map(r => `${r.name} — ${r.result || 'not reported'}`).join('\n');

// ---------------------------------------------------------------- messages

function msg(sel, text, kind = '') {
  const el = $(sel);
  el.textContent = text;
  el.className = 'msg ' + kind;
  if (text) setTimeout(() => { if (el.textContent === text) { el.textContent = ''; el.className = 'msg'; } }, 6000);
}

// ---------------------------------------------------------------- import

async function importSignups(id) {
  const base = apiBase();
  if (base === null) throw new Error('Signup import needs the Worker deployed and PROXY set in app.js (or run the app from localhost).');
  const res = await fetch(`${base}/riot/events/${id}`);
  if (!res.ok) throw new Error(`Event ${id} not found on playriftbound.com.`);
  return parseEventPage(await res.text());
}

// Riot's API is closed to anonymous callers, but the public event page is
// server-rendered with the same data embedded as escaped JSON. Only REGISTERED
// players are taken -- waitlisted ones have no seat, and the waitlist promotes
// itself, so importing again later picks up anyone who moved up.
function parseEventPage(html) {
  const s = html.replace(/\\"/g, '"');
  const unescape = t => { try { return JSON.parse(`"${t}"`); } catch { return t; } };
  let names = [...new Set([...s.matchAll(/"status":"REGISTERED"[^{}]*"player":\{[^}]*"displayName":"((?:[^"\\]|\\.)*)"/g)]
    .map(m => unescape(m[1])))];
  // Once the event starts the registrant list gives way to the participant list,
  // where no-shows are DROPPED -- so this is who is actually playing.
  if (!names.length) names = (riotTournament(html)?.tournamentParticipants || [])
    .filter(p => p.status === 'ACTIVE').map(p => p.player.displayName);
  const name = (/<h1[^>]*>([^<]*)<\/h1>/.exec(html)?.[1] || '')
    .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return { name, minutes: state.minutes, names };
}

// ------------------------------------------------------------ 1v1 mirror
//
// For 1v1 nights -- Nexus Nights, skirmishes, store events -- the Riftbound
// event page does the pairing and the players report their own results, so this
// app is purely a display and a clock. Nothing is scored here and nothing is
// pushed back; the pairings and standings are mirrored onto the TV as Riot has
// them. (The state still says "uvs" -- the mirror was built for UVS, which Riot
// replaced in 2026-10.)
//
// It reads the same public page as signup import, keyed on the same event id.

// The clock hangs off a round object, so mirroring keeps an otherwise empty
// round around purely to own the timer.
const bareRound = n => ({ n, pairings: [], endsAt: 0, pausedMs: (state.minutes || 50) * 60000, running: false });

async function fetchUvs(id) {
  const base = apiBase();
  if (base === null) throw new Error('Reading the event needs the app to be running from localhost.');
  const res = await fetch(`${base}/riot/events/${id}`);
  if (!res.ok) throw new Error(`Event ${id} not found on playriftbound.com.`);
  return riotFeed(await res.text());
}

// Once an event starts, the page embeds the whole tournament (rounds, matches,
// standings) in Next.js's flight payload: JSON inside JS string literals pushed
// to self.__next_f. Decode those, then cut the CompeteTournament object out by
// bracket matching. Before the start it isn't there, and nothing is paired yet.
function riotTournament(html) {
  let flight = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) flight += JSON.parse(m[1]);
  const i = flight.indexOf('{"__typename":"CompeteTournament"');
  if (i < 0) return null;
  let depth = 0, str = false, j = i;
  for (; j < flight.length; j++) {
    const c = flight[j];
    if (str) { if (c === '\\') j++; else if (c === '"') str = false; continue; }
    if (c === '"') str = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) break;
  }
  return JSON.parse(flight.slice(i, j + 1));
}

function riotFeed(html) {
  const t = riotTournament(html);
  if (!t) return { name: parseEventPage(html).name, round: 0, pairings: [], rounds: [], standings: [] };

  // Players inside matches are often back-references into an earlier part of
  // the payload rather than objects, but every team carries its id, and the
  // participant list maps ids to names.
  const who = Object.fromEntries((t.tournamentParticipants || []).map(p => [p.esportsTeamId, p.player.displayName]));
  const rounds = (t.stages || []).flatMap(s => s.sections.flatMap(x => x.rounds));
  const cur = rounds[rounds.length - 1];
  const last = [...rounds].reverse().find(r => r.endOfRoundStandings?.length);
  const pairs = r => [
    // A bye also arrives as a pseudo-match ("bye-…" id, no table, a placeholder
    // opponent, already won); byeTeamIds below is the one to show.
    ...(r?.matches || []).filter(m => !String(m.esportsMatchId).startsWith('bye-')).map(m => ({
      table: m.tableNumber,
      bye: false,
      names: m.teams.map(x => who[x.esportsTeamId] ?? '?'),
      winner: who[m.teamOutcomes?.find(o => o.outcome === 'WIN')?.esportsTeamId] || null,
      // match.status stays IN_PROGRESS even after its round is finalized, so
      // "reported" is having an outcome at all.
      done: !!m.teamOutcomes?.length,
    })),
    ...(r?.byeTeamIds || []).map(id => ({ table: null, bye: true, names: [who[id] ?? '?'], winner: null, done: true })),
  ].sort((a, b) => (a.table ?? Infinity) - (b.table ?? Infinity));   // Riot's order isn't by table

  return {
    name: t.name,
    round: cur?.roundNumber ?? 0,
    pairings: pairs(cur),
    // Every round, for 2v2: its results live in this app, so one missed poll
    // between rounds must not lose the last results of the round before.
    rounds: rounds.map(r => ({ n: r.roundNumber, pairings: pairs(r) })),
    standings: (last?.endOfRoundStandings || []).map(s => ({
      rank: s.rank, name: who[s.esportsTeamId] ?? '?',
      w: s.matchWins, l: s.matchLosses, d: s.matchDraws, pts: s.matchPoints,
    })),
  };
}

function applyUvs(feed) {
  state.uvsRound = feed.round;
  state.uvsStandings = feed.standings;
  state.uvsPairings = feed.pairings;
  // A new round number gets a fresh clock; refreshing the same one leaves the
  // clock alone, so a mid-round poll cannot reset the timer on the TV.
  const r = currentRound();
  if (!r || r.n !== feed.round) state.rounds.push(bareRound(feed.round));
  save();
  return { count: feed.pairings.length, unmatched: [] };
}

// ------------------------------------------------------------ 2v2 on Riot
//
// Riot has no team events yet and no "shop pairs it" mode, so a 2v2 runs as a
// 1v1 of captains: the organiser drops each teammate from the Riot event, the
// page pairs the captains, and they report the winner. Dropped players vanish
// from Riot's list entirely, so teams are made here from a signup import taken
// before the drops (re-importing only adds); a Riot name is mapped to
// whichever team it is on, so there is no separate captain to mark. Results land
// in the app's own rounds, which keeps game points, the archive and both
// teammates' records working exactly as on a night paired here.
function applyTeamFeed(feed) {
  const teamOf = {};
  for (const t of state.teams) for (const id of t.players) {
    const n = player(id)?.name;
    if (n) teamOf[n.toLowerCase()] = t.id;
  }
  const unmatched = new Set(), twice = new Set();
  for (const fr of feed.rounds) {
    let r = state.rounds.find(x => x.n === fr.n);
    if (!r) state.rounds.push(r = bareRound(fr.n));
    const seen = new Set(), prev = r.pairings;
    // Rebuilt on every poll, so fixing a team on the Teams tab fixes the next
    // read; typed points and a tapped winner carry over by matchup.
    r.pairings = fr.pairings.flatMap(fp => {
      const ids = fp.names.map(n => teamOf[n.toLowerCase()]);
      fp.names.forEach((n, i) => { if (!ids[i]) unmatched.add(n); });
      if (ids.some(id => !id)) return [];
      ids.forEach(id => { if (seen.has(id)) twice.add(teamName(id)); seen.add(id); });
      const [a, b = null] = ids;
      const old = prev.find(p => p.a === a && p.b === b) || {};
      const won = fp.winner && teamOf[fp.winner.toLowerCase()];
      return [{
        a, b, table: fp.table,
        winner: b === null ? null : won ? (won === a ? 'a' : 'b') : fp.done ? 'draw' : (old.winner ?? null),
        pa: old.pa ?? (b === null ? state.byePoints ?? 8 : null), pb: old.pb ?? null,
      }];
    });
  }
  save();
  return { count: feed.pairings.length, unmatched: [...unmatched], twice: [...twice] };
}

// ---------------------------------------------------------------- archive

function finishEvent() {
  if (!state.teams.length) return msg('#danger-msg', 'Nothing to archive yet.', 'err');
  const final = standings();
  state.archive.unshift({
    date: Date.now(),
    name: state.name,
    players: state.players.map(p => ({ name: p.name })),
    teams: playedTeams().map(t => ({ name: t.name, players: t.players.map(id => player(id)?.name ?? '?') })),
    rounds: state.rounds.length,
    // No legend is written here, by design -- see purgeMeta().
    standings: final.map((s, i) => ({
      place: i + 1, name: s.team.name,
      players: s.team.players.map(id => player(id)?.name ?? '?'),
      w: s.w, l: s.l, d: s.d, pts: s.pts, gp: s.gp,
    })),
    matches: state.rounds.flatMap(r => r.pairings.filter(reported).map(p => ({
      round: r.n,
      teamA: teamName(p.a), pointsA: p.pa,
      teamB: p.b === null ? null : teamName(p.b), pointsB: p.pb,
    }))),
  });
  // The mode and how the night runs belong to the room, not the event, so they
  // survive archiving -- otherwise finishing a night drops you back to the splash.
  Object.assign(state, blank(), {
    archive: state.archive, minutes: state.minutes,
    mode: state.mode, manual: state.manual, uvsMode: state.uvsMode, ...venue(),
  });
  save();
  download(`riftbound-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(state.archive[0], null, 2), 'application/json');
  msg('#danger-msg', 'Event archived and a backup file downloaded.', 'ok');
}

// ------------------------------------------------------- where files go
//
// A shop wants its archives landing in one folder, not scattered through
// Downloads. The only way a web page can write to a chosen folder is a directory
// handle from showDirectoryPicker(), and a handle cannot be JSON-serialised, so
// it lives in IndexedDB rather than localStorage. Everything degrades: no API,
// no permission, or a folder that has moved all fall back to a normal download.
const DIR_DB = KEY + '-fs';
const hasFS = () => typeof window.showDirectoryPicker === 'function';

function dirStore(mode, value) {
  return new Promise(resolve => {
    if (!window.indexedDB) return resolve(null);
    const open = indexedDB.open(DIR_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('h');
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const tx = open.result.transaction('h', mode === 'get' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('h');
      const req = mode === 'get' ? store.get('dir')
        : value ? store.put(value, 'dir') : store.delete('dir');
      req.onsuccess = () => resolve(mode === 'get' ? req.result || null : true);
      req.onerror = () => resolve(null);
    };
  });
}

let saveDir = null;        // the live handle, once permission is confirmed
let saveDirName = '';      // shown in Settings; known even before permission is

// Permission does not survive a reload, and re-asking needs a user gesture --
// which every caller of this has, since they are all button presses.
async function ensureDir(ask = false) {
  const handle = saveDir || await dirStore('get');
  if (!handle) return null;
  const opts = { mode: 'readwrite' };
  let perm = await handle.queryPermission?.(opts);
  if (perm !== 'granted' && ask) perm = await handle.requestPermission?.(opts);
  if (perm !== 'granted') return null;
  saveDir = handle;
  return handle;
}

async function download(filename, text, type) {
  const dir = await ensureDir(true);
  if (dir) {
    try {
      const file = await dir.getFileHandle(filename, { create: true });
      const w = await file.createWritable();
      await w.write(new Blob([text], { type }));
      await w.close();
      msg('#settings-msg', `Saved ${filename} to ${dir.name}.`, 'ok');
      return;
    } catch { /* folder moved, or write refused -- fall through to the browser */ }
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

// Per-player records, derived by giving both team-mates their team's results.
// The locator models events as individual players with no team
// concept, so this is the shape any external system can actually accept.
function playerResults() {
  const rec = records();
  const rows = [];
  for (const t of playedTeams()) {
    const r = rec[t.id];
    if (!r) continue;
    for (const id of t.players) {
      const p = player(id);
      if (!p) continue;
      rows.push({
        player: p.name, team: t.name,
        w: r.w, l: r.l, d: r.d, matchPoints: r.pts, gamePoints: r.gp,
      });
    }
  }
  return rows.sort((a, b) => b.gamePoints - a.gamePoints || a.player.localeCompare(b.player));
}

function playerResultsCSV() {
  const head = ['player', 'team', 'wins', 'losses', 'draws', 'match_points', 'game_points'];
  const rows = playerResults().map(r =>
    [r.player, r.team, r.w, r.l, r.d, r.matchPoints, r.gamePoints]);
  return [head, ...rows]
    .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}

// Lifetime record per player, accumulated over archived events. Archived
// standings are per team, and both team-mates take their team's result -- the
// same rule the reporting list uses, so the two never disagree.
//
// Names are the only key we have across events (a locator import and a hand-typed
// entry share nothing else), so they are matched case-insensitively and trimmed.
function playerHistory() {
  const by = new Map();
  for (const ev of state.archive) {
    for (const s of ev.standings || []) {
      (s.players || []).forEach((raw, i) => {
        const name = String(raw || '').trim();
        if (!name || name === '?') return;
        const k = name.toLowerCase();
        const e = by.get(k) || { name, events: 0, w: 0, l: 0, d: 0, gp: 0, wins: 0, last: 0 };
        e.events++;
        e.w += s.w || 0; e.l += s.l || 0; e.d += s.d || 0; e.gp += s.gp || 0;
        if (s.place === 1) e.wins++;                       // nights finished in first
        e.last = Math.max(e.last, ev.date || 0);
        by.set(k, e);
      });
    }
  }
  return [...by.values()].map(e => {
    const played = e.w + e.l + e.d;
    return { ...e, played, winPct: played ? e.w / played : 0 };
  }).sort((a, b) => b.w - a.w || b.winPct - a.winPct || a.name.localeCompare(b.name));
}

function playerHistoryCSV() {
  const head = ['player', 'events', 'matches', 'wins', 'losses', 'draws', 'win_pct', 'game_points', 'event_wins'];
  const rows = playerHistory().map(e =>
    [e.name, e.events, e.played, e.w, e.l, e.d, (e.winPct * 100).toFixed(1), e.gp, e.wins]);
  return [head, ...rows]
    .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}

function toCSV() {
  const rows = [['event', 'date', 'place', 'team', 'players',
    'game_points', 'wins', 'losses', 'draws', 'match_points']];
  for (const ev of state.archive)
    for (const s of ev.standings)
      rows.push([ev.name, new Date(ev.date).toISOString().slice(0, 10), s.place, s.name,
        s.players.join(' & '),
        s.gp ?? '', s.w, s.l, s.d, s.pts]);
  return rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}

// ---------------------------------------------------------------- events

if (!isDisplay) {
  $$('.tabs button[data-tab]').forEach(b => b.onclick = () => showTab(b.dataset.tab));

  $$('#splash .splash-card').forEach(b =>
    b.onclick = () => setMode(b.dataset.mode, $('#splash-manual').checked));

  // Shop settings from the splash: no mode, no event, just the venue's own setup.
  $('#splash-settings').onclick = () => { settingsOnly = true; showTab('settings'); render(); };
  $('#btn-back-splash').onclick = () => { settingsOnly = false; render(); };

  $('#btn-change-mode').onclick = () => {
    const to = state.mode === '1v1' ? '2v2' : '1v1';
    if (!confirm(`Switch to ${to}? The round in progress will be cleared.`)) return;
    setMode(to);
  };

  // Flipping this mid-event changes who owns the pairings, so it clears the round
  // exactly like switching mode does -- setMode() already handles that.
  $('#ev-manual').onchange = e => {
    const on = e.target.checked;
    if (state.rounds.length && !confirm('Change how this night runs? The round in progress will be cleared.')) {
      e.target.checked = !on;
      return;
    }
    setMode(state.mode, on);
  };

  $('#open-display').onclick = () => window.open('?display=1', 'rb-display', 'width=1280,height=720');

  $('#ev-name').oninput = e => { state.name = e.target.value; localStorage.setItem(KEY, JSON.stringify(state)); chan.postMessage(state); };
  $('#ev-minutes').onchange = e => { state.minutes = Math.max(1, +e.target.value || 50); save(); };
  $('#ev-bye').onchange = e => { state.byePoints = Math.max(0, +e.target.value || 0); save(); };
  $('#ev-tables').onchange = e => { state.tables = Math.max(1, +e.target.value || 1); save(); };
  $('#ev-pairing-mins').onchange = e => { state.pairingMinutes = Math.max(0, +e.target.value || 0); save(); };
  $('#ev-overtime').onchange = e => { state.overtime = Math.max(0, +e.target.value || 0); save(); };

  // Same shape as #ev-name: skip render() so re-setting .value cannot move the caret.
  $('#ev-shop').oninput = e => { state.shopName = e.target.value; localStorage.setItem(KEY, JSON.stringify(state)); chan.postMessage(state); };
  $('#brand-text').onchange = () => { state.brandMode = 'text'; save(); };
  $('#brand-logo').onchange = () => {
    state.brandMode = 'logo';
    save();
    if (!logoUrl()) msg('#brand-msg', 'No logo yet — choose an image below.', 'err');
  };

  $('#btn-logo').onclick = () => $('#logo-input').click();
  $('#btn-logo-clear').onclick = () => {
    setLogo('');
    // Nothing left to show in logo mode, so fall back rather than going blank.
    if (state.brandMode === 'logo') { state.brandMode = 'text'; save(); }
    msg('#brand-msg', 'Logo removed.', 'ok');
  };
  $('#logo-input').onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    msg('#brand-msg', 'Reading image…');
    try {
      const url = await shrinkImage(file);
      if (!setLogo(url)) return msg('#brand-msg', 'That image is too large to store. Try a smaller file.', 'err');
      state.brandMode = 'logo';
      save();
      msg('#brand-msg', 'Logo set. It is resized to fit the TV automatically.', 'ok');
    } catch { msg('#brand-msg', 'That file could not be read as an image.', 'err'); }
  };

  $('#btn-import').onclick = async () => {
    const id = $('#ev-id').value.trim().replace(/\D/g, '');
    if (!id) return msg('#import-msg', 'Enter an event ID.', 'err');
    msg('#import-msg', 'Importing…');
    try {
      const { name, minutes, names } = await importSignups(id);
      const existing = new Set(state.players.map(p => p.name.toLowerCase()));
      const added = names.filter(n => !existing.has(n.toLowerCase()));
      state.players.push(...added.map(n => ({ id: uid(), name: n, legend: '' })));
      if (!state.name) state.name = name;
      state.minutes = minutes;
      state.eventId = id;   // remembered, so pulling pairings never asks for it again
      save();
      msg('#import-msg', `Imported ${added.length} player${added.length === 1 ? '' : 's'} from "${name}".`, 'ok');
    } catch (err) {
      msg('#import-msg', err.message, 'err');
    }
  };

  $('#btn-uvs').onclick = () => pullUvs();

  async function pullUvs() {
    // The id is whatever was used for signup import, so there is nothing to paste.
    const id = state.eventId || $('#ev-id').value.trim().replace(/\D/g, '');
    if (!id) return msg('#uvs-msg', 'Put the event ID on the Setup tab first — the same one used for Import signups.', 'err');
    msg('#uvs-msg', 'Reading the Riftbound event page…');
    try {
      const feed = await fetchUvs(id);
      const { count, unmatched = [], twice = [] } = (teamsOnRiot() ? applyTeamFeed : applyUvs)(feed);
      state.eventId = id;
      if (unmatched.length) return msg('#uvs-msg', `Not on any team: ${unmatched.join(', ')}. Add them on the Teams tab, then refresh.`, 'err');
      if (twice.length) return msg('#uvs-msg', `Both players are still in the Riftbound event for ${twice.join(', ')}. Drop the teammate there.`, 'err');
      msg('#uvs-msg', count
        ? `Round ${feed.round}: showing ${count} match${count === 1 ? '' : 'es'} from "${feed.name}".`
        : `Connected to "${feed.name}", but the Riftbound page has not paired a round yet.`, count ? 'ok' : 'err');
    } catch (err) { msg('#uvs-msg', err.message, 'err'); }
  }

  // Players report on their own phones, so poll to pick that up without anyone
  // pressing anything. Quietly -- a failed poll must not stamp on the message line.
  // Once a minute: each poll is a whole ~200KB page, not a small JSON feed.
  setInterval(() => {
    if ((state.uvsMode || teamsOnRiot()) && state.eventId) {
      fetchUvs(state.eventId).then(teamsOnRiot() ? applyTeamFeed : applyUvs).catch(() => {});
    }
  }, 60000);

  $('#btn-add-player').onclick = () => {
    const name = $('#new-player').value.trim();
    if (!name) return;
    state.players.push({ id: uid(), name, legend: '' });
    $('#new-player').value = '';
    save();
  };
  $('#new-player').onkeydown = e => { if (e.key === 'Enter') $('#btn-add-player').click(); };

  $('#player-list').onclick = e => {
    const id = e.target.dataset.delPlayer;
    if (!id) return;
    state.players = state.players.filter(p => p.id !== id);
    state.teams = state.teams.filter(t => !t.players.includes(id));
    save();
  };
  $('#player-list').onchange = e => {
    const id = e.target.dataset.legend;
    if (!id) return;
    const p = player(id);
    if (p) { p.legend = e.target.value; save(); }
  };

  $('#btn-make-team').onclick = () => {
    const a = $('#pick-a').value, b = $('#pick-b').value;
    if (!a || !b || a === b) return msg('#team-msg', 'Pick two different players.', 'err');
    addTeam(a, b, $('#new-team-name').value);
    $('#new-team-name').value = '';
    save();
  };
  $('#new-team-name').onkeydown = e => { if (e.key === 'Enter') $('#btn-make-team').click(); };

  $('#btn-auto-team').onclick = () => {
    const free = [...unassigned()];
    while (free.length >= 2) addTeam(free.shift().id, free.shift().id);
    save();
    msg('#team-msg', free.length ? 'One player left over — add them manually or they sit out.' : 'Teams created.', free.length ? 'err' : 'ok');
  };

  $('#res-round').onchange = () => renderResults();
  $('#btn-copy-results').onclick = async () => {
    const text = resultsText(+$('#res-round').value);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      msg('#results-msg', 'Copied. Paste it anywhere you like.', 'ok');
    } catch {
      // Clipboard needs a secure context and permission; a download always works.
      download('round-results.txt', text, 'text/plain');
      msg('#results-msg', 'Clipboard was blocked, so it downloaded as a text file instead.', 'ok');
    }
  };

  $('#team-list').onclick = e => {
    const del = e.target.dataset.delTeam, ren = e.target.dataset.rename;
    if (del) { state.teams = state.teams.filter(t => t.id !== del); save(); }
    if (ren) {
      const t = team(ren);
      const name = prompt('Team name', t.name);
      if (name && name.trim()) { t.name = name.trim(); t.custom = true; save(); }
    }
  };

  $('#btn-pair').onclick = () => {
    if (state.uvsMode) return msg('#round-msg', 'The Riftbound page is providing the pairings — press Refresh from Riftbound instead.', 'err');
    if (soloMode()) syncSoloTeams();
    if (state.teams.length < 2)
      return msg('#round-msg', soloMode() ? 'Need at least two players.' : 'Need at least two teams.', 'err');
    const r = currentRound();
    if (r && r.pairings.some(p => !reported(p))) return msg('#round-msg', 'Enter both scores for every match first.', 'err');
    const pairings = makePairings();
    if (!pairings) return msg('#round-msg', 'Could not build pairings.', 'err');
    state.rounds.push({ n: state.rounds.length + 1, pairings, endsAt: 0, pausedMs: state.minutes * 60000, running: false });
    save();
    const needed = pairings.filter(p => p.b !== null).length;
    if (needed > (state.tables ?? 8))
      msg('#round-msg', `Round ${state.rounds.length} paired, but it needs ${needed} tables and only ${state.tables} are set up.`, 'err');
    else
      msg('#round-msg', `Round ${state.rounds.length} paired across ${needed} table${needed === 1 ? '' : 's'}.`, 'ok');
  };

  $('#btn-start').onclick = () => {
    // Mirroring UVS there may be no round yet, but the clock is the whole point,
    // so give it one to live on rather than refusing.
    if (!currentRound() && state.uvsMode) state.rounds.push(bareRound(state.uvsRound || 1));
    const r = currentRound();
    if (!r) return msg('#round-msg', 'Generate pairings first.', 'err');
    r.endsAt = Date.now() + (r.pausedMs ?? state.minutes * 60000);
    r.running = true;
    save();
  };
  $('#btn-pause').onclick = () => {
    const r = currentRound();
    if (!r || !r.running) return;
    r.pausedMs = Math.max(0, r.endsAt - Date.now());
    r.running = false;
    save();
  };
  $('#btn-reset-timer').onclick = () => {
    const r = currentRound();
    if (!r) return;
    r.running = false;
    r.pausedMs = state.minutes * 60000;
    save();
  };
  $('#btn-next-round').onclick = () => {
    if (state.uvsMode) return msg('#round-msg', 'The Riftbound page is providing the pairings — pair the next round there, then press Refresh from Riftbound.', 'err');
    const r = currentRound();
    if (!r) return msg('#round-msg', 'No round in progress.', 'err');
    if (r.pairings.some(p => !reported(p))) return msg('#round-msg', 'Enter both scores for every match first.', 'err');
    r.running = false;
    save();
    $('#btn-pair').click();
  };

  $('#pairing-list').onclick = e => {
    const val = e.target.dataset.pick;
    if (val === undefined) return;
    const [i, side] = val.split(':');
    const r = currentRound();
    if (!r) return;
    r.pairings[+i].winner = side || null;
    save();
  };

  // 'change' rather than 'input': re-rendering on every keystroke would steal focus.
  $('#pairing-list').onchange = e => {
    const val = e.target.dataset.pts;
    if (val === undefined) return;
    const [i, side] = val.split(':');
    const r = currentRound();
    if (!r) return;
    const raw = e.target.value.trim();
    r.pairings[+i][side === 'a' ? 'pa' : 'pb'] = raw === '' ? null : Math.max(0, +raw || 0);
    save();
  };

  $('#btn-clear-order').onclick = () => { state.order = null; save(); };

  // drag to reorder the TV standings
  let dragged = null;
  const list = $('#ctl-standings');
  list.addEventListener('dragstart', e => { dragged = e.target.closest('li'); dragged?.classList.add('dragging'); });
  list.addEventListener('dragend', () => { dragged?.classList.remove('dragging'); dragged = null; });
  list.addEventListener('dragover', e => {
    e.preventDefault();
    const over = e.target.closest('li');
    if (!over || !dragged || over === dragged) return;
    const rect = over.getBoundingClientRect();
    list.insertBefore(dragged, (e.clientY - rect.top) / rect.height > 0.5 ? over.nextSibling : over);
  });
  list.addEventListener('drop', e => {
    e.preventDefault();
    state.order = [...list.querySelectorAll('li[data-team]')].map(li => li.dataset.team);
    save();
  });

  $('#btn-finish').onclick = () => { if (confirm('Archive this event and start fresh?')) finishEvent(); };
  $('#btn-reset').onclick = () => {
    if (!confirm('Erase the current event? Archived events are kept.')) return;
    Object.assign(state, blank(), { archive: state.archive, mode: state.mode, manual: state.manual, uvsMode: state.uvsMode, ...venue() });
    save();
  };

  $('#btn-export').onclick = () => download('riftbound-all-events.json', JSON.stringify(state.archive, null, 2), 'application/json');
  $('#btn-export-csv').onclick = () => download('riftbound-all-events.csv', toCSV(), 'text/csv');
  $('#btn-export-players').onclick = () => {
    if (!state.teams.length) return msg('#settings-msg', 'No teams in the current event.', 'err');
    download('hextech-ledger-player-results.csv', playerResultsCSV(), 'text/csv');
  };
  $('#btn-export-history').onclick = () => {
    if (!state.archive.length) return msg('#stats-msg', 'No archived events yet.', 'err');
    download('hextech-ledger-player-records.csv', playerHistoryCSV(), 'text/csv');
  };
  // Remembered across restarts; the browser still asks to confirm access once
  // per session the first time something is written.
  dirStore('get').then(h => { if (h) { saveDirName = h.name; render(); } });

  $('#btn-save-dir').onclick = async () => {
    if (!hasFS()) return msg('#settings-msg', 'This browser cannot pick a folder — files will go to Downloads. Chrome or Edge can.', 'err');
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await dirStore('put', handle);
      saveDir = handle;
      saveDirName = handle.name;
      render();
      msg('#settings-msg', `Archives and exports will be saved to ${handle.name}.`, 'ok');
    } catch { /* picker dismissed */ }
  };
  $('#btn-save-dir-clear').onclick = async () => {
    await dirStore('del');
    saveDir = null;
    saveDirName = '';
    render();
    msg('#settings-msg', 'Files will go to your Downloads folder again.', 'ok');
  };

  $('#btn-import-file').onclick = () => $('#file-input').click();
  $('#file-input').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = Array.isArray(data) ? data : [data];
      const seen = new Set(state.archive.map(a => a.date));
      const fresh = incoming.filter(a => a && a.date && !seen.has(a.date));
      state.archive.push(...fresh);
      state.archive.sort((a, b) => b.date - a.date);
      save();
      msg('#settings-msg', `Merged ${fresh.length} event${fresh.length === 1 ? '' : 's'}.`, 'ok');
    } catch { msg('#settings-msg', 'That file could not be read.', 'err'); }
    e.target.value = '';
  };

  $$('.subtabs button[data-sub]').forEach(b => b.onclick = () => {
    $$('.subtabs button[data-sub]').forEach(x => x.classList.toggle('on', x === b));
    $$('[data-subpanel]').forEach(p => { p.hidden = p.dataset.subpanel !== b.dataset.sub; });
  });

  $('#stats-msg').closest('section').onclick = e => {
    const head = e.target.closest?.('[data-event]');
    if (head) {                              // one night open at a time
      const i = +head.dataset.event;
      openEvent = openEvent === i ? -1 : i;
      render();
      return;
    }
    const i = e.target.dataset.delArchive;
    if (i !== undefined && confirm('Delete this saved event?')) {
      state.archive.splice(+i, 1);
      openEvent = -1;
      save();
    }
  };
}

function showTab(tab) {
  $$('.tabs button[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $$('section[data-panel]').forEach(s => { s.hidden = s.dataset.panel !== tab; });
}

// Shop settings opened from the splash, before any mode has been picked. Not
// saved: it is a detour, not a state the app should come back up in.
let settingsOnly = false;

// An unofficial night has no Riftbound event to read, so only an official 1v1 is
// the mirror (uvsMode: nothing scored here). An official 2v2 takes its pairings
// from Riot but is scored here (teamsOnRiot); a manual night of either kind is
// run entirely here.
function setMode(mode, manual = state.manual) {
  const changed = state.mode !== mode || !!state.manual !== !!manual;
  state.mode = mode;
  state.manual = !!manual;
  state.uvsMode = mode === '1v1' && !state.manual;
  settingsOnly = false;
  if (changed) {
    state.rounds = [];
    state.uvsPairings = null;
    state.uvsStandings = null;
    state.uvsRound = 0;
  }
  save();
  showTab('setup');
  if ((state.uvsMode || teamsOnRiot()) && state.eventId) $('#btn-uvs').click();
}

function applyMode() {
  const m = state.mode;
  $('#splash').hidden = !!m || settingsOnly;
  $('#control').hidden = !m && !settingsOnly;
  $('#btn-back-splash').hidden = !!m || !settingsOnly;
  $('#splash-manual').checked = !!state.manual;
  if (!m && !settingsOnly) return;

  // With no mode yet, the only thing there is to show is the shop settings.
  const allowed = !m ? ['settings'] : (MODE_TABS[tabKey()] || MODE_TABS['2v2']);
  let openTab = null;
  $$('.tabs button[data-tab]').forEach(b => {
    b.hidden = !allowed.includes(b.dataset.tab);
    if (b.classList.contains('on') && !b.hidden) openTab = b.dataset.tab;
  });
  // Switching modes can hide the tab you were on; don't leave a blank panel.
  if (!openTab) showTab(allowed[0]);

  const tokens = viewTokens();
  $$('[data-only]').forEach(el => {
    el.hidden = !el.dataset.only.split(/\s+/).every(t => tokens.includes(t));
  });
  $('#mode-badge').textContent = m || 'shop';
  $('#mode-name').textContent = m ? (state.manual ? `manual ${m}` : m) : '—';
  $('#btn-change-mode').textContent = `Switch to ${m === '1v1' ? '2v2' : '1v1'}`;
}

// Manual 1v1 is scored with the same team machinery as 2v2, with each player in
// a team of one. Doing it here rather than forking the pairing, scoring and
// reporting code is the whole reason 1v1 gets those tabs for free.
function syncSoloTeams() {
  state.teams = state.teams.filter(t => t.players.length === 1 && player(t.players[0]));
  for (const p of state.players) {
    const t = state.teams.find(x => x.players[0] === p.id);
    if (t) t.name = p.name;
    else state.teams.push({ id: uid(), name: p.name, players: [p.id], custom: false });
  }
}

function addTeam(a, b, name = '') {
  const na = player(a)?.name ?? '?', nb = player(b)?.name ?? '?';
  const custom = !!name.trim();
  state.teams.push({ id: uid(), name: custom ? name.trim() : `${na} & ${nb}`, players: [a, b], custom });
}

// ---------------------------------------------------------------- display chrome

// Text scale is a property of the room, not the event -- how far away the far end
// of the table is, how the TV is mounted. Kept per-screen rather than in the shared
// state so the control laptop never inherits the TV's setting.
const SCALE_KEY = KEY + '-tvscale';

function initScale() {
  applyScale(+localStorage.getItem(SCALE_KEY) || 1, false);
  addEventListener('keydown', e => {
    const cur = +localStorage.getItem(SCALE_KEY) || 1;
    if (e.key === '+' || e.key === '=') applyScale(cur + 0.05);
    else if (e.key === '-' || e.key === '_') applyScale(cur - 0.05);
    else if (e.key === '0') applyScale(1);
  });
}

function applyScale(v, toast = true) {
  const scale = Math.min(1.8, Math.max(0.6, Math.round(v * 100) / 100));
  localStorage.setItem(SCALE_KEY, scale);
  $('#display').style.setProperty('--tv', scale);
  if (toast) showToast(`Text size ${Math.round(scale * 100)}%`);
}

let toastTimer = 0;
function showToast(text) {
  let el = $('.tv-toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'tv-toast';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
}

// Creep the list down so more teams than fit on the TV still get seen, then hold
// at the bottom and snap back to the top. One direction only -- a list that
// crawls back upwards reads as broken.
const SCROLL_PX_PER_SEC = 18, SCROLL_HOLD_MS = 4000;
let scrollAt = 0, holdUntil = 0, lastFrame = 0, atBottom = false;

function autoScroll(ts) {
  requestAnimationFrame(autoScroll);
  const box = $('.dsp-body');
  if (!box) return;
  const dt = lastFrame ? Math.min((ts - lastFrame) / 1000, 0.1) : 0;
  lastFrame = ts;

  const max = box.scrollHeight - box.clientHeight;
  if (max <= 1) { scrollAt = 0; atBottom = false; box.scrollTop = 0; return; }
  if (ts < holdUntil) return;

  if (atBottom) {                      // hold expired at the bottom -- back to the top
    atBottom = false;
    scrollAt = 0;
    box.scrollTop = 0;
    holdUntil = ts + SCROLL_HOLD_MS;   // and pause again before setting off
    return;
  }

  scrollAt += SCROLL_PX_PER_SEC * dt;
  if (scrollAt >= max) {
    scrollAt = max;
    atBottom = true;
    holdUntil = ts + SCROLL_HOLD_MS;
  }
  box.scrollTop = scrollAt;
}

// The TV leads with pairings so players can find their table, then falls back to
// the leaderboard for the rest of the round.
// Rows for the TV pairings view: the locator's when mirroring, otherwise local
// the one running the event.
function displayPairings() {
  if (state.uvsMode) return state.uvsPairings || [];
  const r = currentRound();
  if (r && r.pairings.length) return r.pairings.map(p => ({
    table: p.table,
    names: p.b === null ? [teamName(p.a)] : [teamName(p.a), teamName(p.b)],
    bye: p.b === null,
  }));
  return [];
}

// Everything finished is the cue to move on to standings, whoever supplies the
// rows: locally that means both scores in, mirroring UVS it means the players
// have reported.
function allIn(rows) {
  if (state.uvsMode) return rows.length > 0 && rows.every(p => p.done);
  const r = currentRound();
  return !!r && r.pairings.length > 0 && r.pairings.every(reported);
}

function displayMode() {
  const rows = displayPairings();
  const r = currentRound();
  if (!rows.length) return 'standings';
  if (!r) return 'pairings';           // mirroring, before the clock exists
  // Riot has no standings until round 1 is finalized; an empty standings
  // screen is worse than leaving the pairings up.
  if (state.uvsMode && !state.uvsStandings?.length) return 'pairings';
  const mins = state.pairingMinutes ?? 8;
  if (mins <= 0) return 'standings';
  if (allIn(rows)) return 'standings';

  const total = (state.minutes || 50) * 60000;
  const left = r.running ? Math.max(0, r.endsAt - Date.now()) : (r.pausedMs ?? total);
  return (total - left) < mins * 60000 ? 'pairings' : 'standings';
}

// ---------------------------------------------------------------- boot
//
// Must stay at the very bottom. initScale() and autoScroll() read module-level
// const/let declared above them, and calling either before those lines evaluate
// throws a temporal-dead-zone ReferenceError that aborts the rest of this file.

if (isDisplay) {
  $('#display').hidden = false;
  initScale();
  setInterval(tick, 250);
  requestAnimationFrame(autoScroll);
}

fetch('data/legends.json')
  .then(r => r.json())
  .then(d => { legends = d; render(); })
  .catch(() => render());

render();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
