// Core ELO / competition logic for TT Circuit

export const ELO_START = 500;
const K_NORMAL = 32;
const K_PROVISIONAL = 60;
const PROVISIONAL_GAMES = 5;

export function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function slugEmail(email) {
  return (email || "").trim().toLowerCase();
}

function kFor(player) {
  const played = player?.played || 0;
  return played < PROVISIONAL_GAMES ? K_PROVISIONAL : K_NORMAL;
}

export function calcELO(playerA, playerB, scoreA) {
  // scoreA: 1 = A wins, 0 = A loses
  const ra = playerA.elo ?? ELO_START;
  const rb = playerB.elo ?? ELO_START;
  const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  const eb = 1 - ea;
  const ka = kFor(playerA);
  const kb = kFor(playerB);
  const newA = Math.round(ra + ka * (scoreA - ea));
  const newB = Math.round(rb + kb * (1 - scoreA - eb));
  return { newA, newB };
}

export function peakEloFor(player) {
  return Math.max(player.peakElo || ELO_START, player.elo || ELO_START);
}

// ---------- Divisions ----------
export const DIVISIONS = [
  { key: "llegenda", min: 1300, icon: "👑" },
  { key: "diamant", min: 1170, icon: "💎" },
  { key: "plati", min: 1040, icon: "💠" },
  { key: "or", min: 860, icon: "🥇" },
  { key: "plata", min: 680, icon: "🥈" },
  { key: "bronze", min: -Infinity, icon: "🥉" },
];

export function divisionFor(elo) {
  const e = elo ?? ELO_START;
  return DIVISIONS.find((d) => e >= d.min) || DIVISIONS[DIVISIONS.length - 1];
}

// ---------- Groups (round robin) ----------
function shuffle(arr) {
  const r = [...arr];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

// ids: array of player ids. ratings: { id: elo }. Returns an array of groups,
// each group being an array of player ids (snake seeding by rating; ties random).
export function makeGroups(ids, ratings = {}) {
  const n = ids.length;
  let numGroups;
  if (n <= 9) numGroups = 1;
  else if (n <= 16) numGroups = 2;
  else numGroups = Math.max(2, Math.round(n / 5));
  const sorted = shuffle(ids).sort((a, b) => (ratings[b] ?? ELO_START) - (ratings[a] ?? ELO_START));
  const groups = Array.from({ length: numGroups }, () => []);
  let dir = 1, g = 0;
  sorted.forEach((id) => {
    groups[g].push(id);
    g += dir;
    if (g === numGroups) { g = numGroups - 1; dir = -1; }
    else if (g < 0) { g = 0; dir = 1; }
  });
  return groups;
}

// Round robin scheduled by rounds (circle method): everybody plays once per round.
// With an odd number of players one rests each round and acts as referee.
export function roundRobin(playerIds) {
  const list = [...playerIds];
  if (list.length % 2) list.push(null);
  const n = list.length;
  const matches = [];
  for (let r = 0; r < n - 1; r++) {
    let resting = null;
    for (let i = 0; i < n / 2; i++) {
      const a = list[i], b = list[n - 1 - i];
      if (a == null || b == null) { resting = a ?? b; continue; }
      matches.push({ id: uid(), round: r + 1, p1: a, p2: b, s1: null, s2: null, done: false, refereeId: null });
    }
    if (resting != null) {
      matches.forEach((m) => { if (m.round === r + 1) m.refereeId = resting; });
    }
    list.splice(1, 0, list.pop());
  }
  return matches;
}

function matchPoints(m) {
  // total points scored by p1 / p2 in a match (0/0 if the match has no per-set detail)
  let a = 0, b = 0;
  (m.sets || []).forEach((st) => { a += st.a; b += st.b; });
  return [a, b];
}

function tally(ids, matches) {
  const stats = {};
  ids.forEach((id) => { stats[id] = { playerId: id, wins: 0, losses: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0 }; });
  matches.forEach((m) => {
    if (!m.done || m.bye || m.s1 == null || m.s2 == null) return;
    if (!stats[m.p1] || !stats[m.p2]) return;
    const [pa, pb] = matchPoints(m);
    const w = m.s1 > m.s2 ? m.p1 : m.p2;
    const l = m.s1 > m.s2 ? m.p2 : m.p1;
    stats[w].wins++; stats[l].losses++;
    stats[m.p1].setsWon += m.s1; stats[m.p1].setsLost += m.s2;
    stats[m.p2].setsWon += m.s2; stats[m.p2].setsLost += m.s1;
    stats[m.p1].pointsFor += pa; stats[m.p1].pointsAgainst += pb;
    stats[m.p2].pointsFor += pb; stats[m.p2].pointsAgainst += pa;
  });
  return stats;
}

const diffs = (r) => [r.wins, r.setsWon - r.setsLost, r.pointsFor - r.pointsAgainst];

// Table tennis tie-break: players level on wins are ranked by a mini-league among
// themselves (wins, set difference, point difference), then by overall set / point difference.
export function groupStandings(group) {
  const ids = group.players || [];
  const matches = group.matches || [];
  const overall = tally(ids, matches);
  const rows = Object.values(overall).sort((x, y) => y.wins - x.wins);
  const out = [];
  let i = 0;
  while (i < rows.length) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1].wins === rows[i].wins) j++;
    const tied = rows.slice(i, j + 1);
    if (tied.length > 1) {
      const tiedIds = tied.map((r) => r.playerId);
      const mini = tally(tiedIds, matches.filter((m) => tiedIds.includes(m.p1) && tiedIds.includes(m.p2)));
      tied.sort((x, y) => {
        const mx = diffs(mini[x.playerId]), my = diffs(mini[y.playerId]);
        for (let k = 0; k < 3; k++) if (my[k] !== mx[k]) return my[k] - mx[k];
        const ox = diffs(x), oy = diffs(y);
        for (let k = 1; k < 3; k++) if (oy[k] !== ox[k]) return oy[k] - ox[k];
        return y.setsWon - x.setsWon;
      });
    }
    out.push(...tied);
    i = j + 1;
  }
  return out;
}

export function groupComplete(group) {
  return (group.matches || []).every((m) => m.done || m.bye);
}

// standingsByGroup: array of arrays of standing rows. Returns arrays of ids:
// tier 1 = every group's 1st, tier 2 = every group's 2nd, ...
export function buildLevelGroups(standingsByGroup) {
  const maxSize = Math.max(0, ...standingsByGroup.map((s) => s.length));
  const tiers = Array.from({ length: maxSize }, () => []);
  standingsByGroup.forEach((s) => s.forEach((row, rank) => tiers[rank].push(row.playerId)));
  return tiers.filter((t) => t.length > 1);
}

// ---------- Bracket (Quadre Or/Plata) ----------
function seedOrder(size) {
  let arr = [1];
  while (arr.length < size) {
    const n = arr.length * 2;
    arr = arr.flatMap((x) => [x, n + 1 - x]);
  }
  return arr;
}

// playerIds in seed order (best first). Returns { rounds: [[match]] } or null if < 2 players.
export function buildBracket(playerIds) {
  if (!playerIds || playerIds.length < 2) return null;
  let size = 2;
  while (size < playerIds.length) size *= 2;
  const order = seedOrder(size);
  const round1 = [];
  for (let i = 0; i < order.length; i += 2) {
    const p1 = playerIds[order[i] - 1] ?? null;
    const p2 = playerIds[order[i + 1] - 1] ?? null;
    const bye = p1 == null || p2 == null;
    round1.push({ id: uid(), p1, p2, s1: null, s2: null, winner: bye ? (p1 ?? p2) : null, done: bye, bye });
  }
  const rounds = [{ matches: round1 }];
  let count = round1.length;
  while (count > 1) {
    count /= 2;
    rounds.push({ matches: Array.from({ length: count }, () => ({ id: uid(), p1: null, p2: null, s1: null, s2: null, winner: null, done: false, bye: false })) });
  }
  return fillBracket({ rounds });
}

function fillBracket(bracket) {
  const rounds = bracket.rounds.map((r) => ({ ...r, matches: r.matches.map((m) => ({ ...m })) }));
  for (let ri = 0; ri < rounds.length - 1; ri++) {
    rounds[ri].matches.forEach((m, i) => {
      const next = rounds[ri + 1].matches[Math.floor(i / 2)];
      next[i % 2 === 0 ? "p1" : "p2"] = m.winner ?? null;
    });
  }
  return { ...bracket, rounds };
}

// Set (or clear, with s1 == null) the result of one match and propagate winners.
// Throws Error("downstream_done") if a later match depends on a result that would change.
export function propagateBracket(bracket, matchId, s1, s2, sets) {
  const rounds = bracket.rounds.map((r) => ({ ...r, matches: r.matches.map((m) => ({ ...m })) }));
  let found = false;
  rounds.forEach((r) => r.matches.forEach((m) => {
    if (m.id !== matchId) return;
    found = true;
    if (s1 == null) { m.s1 = null; m.s2 = null; m.sets = []; m.winner = null; m.done = false; }
    else { m.s1 = s1; m.s2 = s2; m.sets = sets || []; m.winner = s1 > s2 ? m.p1 : m.p2; m.done = true; }
  }));
  if (!found) return bracket;
  const next = fillBracket({ ...bracket, rounds });
  for (let ri = 1; ri < next.rounds.length; ri++) {
    next.rounds[ri].matches.forEach((m, i) => {
      const before = bracket.rounds[ri].matches[i];
      if (before.done && (before.p1 !== m.p1 || before.p2 !== m.p2)) throw new Error("downstream_done");
      if (!m.p1 || !m.p2) { if (!m.done) { m.winner = null; } }
    });
  }
  return next;
}

export function bracketRoundName(total, idx, t) {
  const fromEnd = total - idx;
  if (fromEnd === 1) return t("final");
  if (fromEnd === 2) return t("semifinals");
  if (fromEnd === 3) return t("quarts");
  return t("round_label", { n: idx + 1 });
}

// ---------- Sistema Suís ----------
// ratings: score used for pairing (higher first). played: array of "a-b" (ids sorted) pairs.
export function generateSwissRound(playerIds, ratings = {}, played = []) {
  const done = new Set(played);
  const key = (a, b) => [a, b].sort().join("-");
  const hadBye = new Set();
  played.forEach((k) => {
    const parts = k.split("-");
    if (parts.length === 2 && (parts[0] === "" || parts[1] === "")) hadBye.add(parts[0] || parts[1]);
  });
  const pool = [...playerIds].sort((a, b) => (ratings[b] ?? 0) - (ratings[a] ?? 0));
  const matches = [];
  if (pool.length % 2) {
    // bye: lowest-ranked player who has not had one yet (else lowest-ranked)
    let idx = -1;
    for (let i = pool.length - 1; i >= 0; i--) { if (!hadBye.has(pool[i])) { idx = i; break; } }
    if (idx === -1) idx = pool.length - 1;
    const bye = pool.splice(idx, 1)[0];
    matches.push({ id: uid(), p1: bye, p2: null, s1: null, s2: null, winner: bye, done: true, bye: true });
  }
  // backtracking: pair the top player with the closest rival not met yet
  const solve = (rest, allowRepeat) => {
    if (!rest.length) return [];
    const [p1, ...others] = rest;
    for (let i = 0; i < others.length; i++) {
      if (!allowRepeat && done.has(key(p1, others[i]))) continue;
      const sub = solve([...others.slice(0, i), ...others.slice(i + 1)], allowRepeat);
      if (sub) return [[p1, others[i]], ...sub];
    }
    return null;
  };
  const pairs = solve(pool, false) || solve(pool, true) || [];
  pairs.forEach(([a, b]) => matches.push({ id: uid(), p1: a, p2: b, s1: null, s2: null, winner: null, done: false }));
  return matches;
}

// ---------- Results -> ELO ----------
function allMatchesInOrder(jornada) {
  const out = [];
  (jornada.groups || []).forEach((g) => (g.matches || []).forEach((m) => out.push(m)));
  (jornada.groupsR2 || []).forEach((g) => (g.matches || []).forEach((m) => out.push(m)));
  (jornada.swissRounds || []).forEach((r) => (r.matches || []).forEach((m) => out.push(m)));
  [jornada.bracketSilver, jornada.bracketGold].forEach((b) => {
    (b?.rounds || []).forEach((r) => r.matches.forEach((m) => out.push(m)));
  });
  return out;
}

// Applies every finished match of the jornada to the participants' ELO and stats.
// Returns { updates: {id: fields}, mvp, mvpGain }.
export function applyJornadaResults(jornada, players) {
  const byId = {};
  players.forEach((p) => { byId[p.id] = p; });
  const state = {};
  const get = (id) => {
    if (!state[id]) {
      const p = byId[id] || {};
      state[id] = {
        elo: p.elo ?? ELO_START, peakElo: p.peakElo ?? ELO_START, played: p.played || 0,
        wins: p.wins || 0, losses: p.losses || 0,
        matchHistory: [...(p.matchHistory || [])], opponents: [...(p.opponents || [])],
        earnedBadges: [...(p.earnedBadges || [])], startElo: p.elo ?? ELO_START, touched: false,
      };
    }
    return state[id];
  };
  allMatchesInOrder(jornada).forEach((m) => {
    if (!m.done || m.bye || !m.p1 || !m.p2 || m.s1 == null || m.s2 == null || m.s1 === m.s2) return;
    const a = get(m.p1), b = get(m.p2);
    const aWins = m.s1 > m.s2;
    const { newA, newB } = calcELO(a, b, aWins ? 1 : 0);
    const push = (me, opp, oppId, own, theirs, win, before, after) => {
      me.touched = true;
      me.played++; if (win) me.wins++; else me.losses++;
      me.matchHistory.push({ jornadaId: jornada.id, date: jornada.date || null, opponentId: oppId, result: win ? "win" : "loss", s1: own, s2: theirs, eloBefore: before, eloAfter: after });
      if (!me.opponents.includes(oppId)) me.opponents.push(oppId);
    };
    const aBefore = a.elo, bBefore = b.elo;
    push(a, b, m.p2, m.s1, m.s2, aWins, aBefore, newA);
    push(b, a, m.p1, m.s2, m.s1, !aWins, bBefore, newB);
    a.elo = newA; b.elo = newB;
    a.peakElo = Math.max(a.peakElo, a.elo); b.peakElo = Math.max(b.peakElo, b.elo);
  });
  const updates = {};
  let mvp = null, mvpGain = 0;
  Object.entries(state).forEach(([id, st]) => {
    if (!st.touched) return;
    const earned = computeBadges(st);
    const fresh = earned.filter((k) => !st.earnedBadges.includes(k));
    fresh.forEach((k) => { st.elo += BADGE_POINTS[k] || 0; });
    st.peakElo = Math.max(st.peakElo, st.elo);
    const gain = st.elo - st.startElo;
    if (gain > mvpGain) { mvp = id; mvpGain = gain; }
    updates[id] = {
      elo: st.elo, peakElo: st.peakElo, played: st.played, wins: st.wins, losses: st.losses,
      matchHistory: st.matchHistory, opponents: st.opponents, earnedBadges: earned,
    };
  });
  return { updates, mvp, mvpGain };
}

// ---------- Podium ----------
function bracketPodium(bracket) {
  const rounds = bracket?.rounds || [];
  if (!rounds.length) return null;
  const final = rounds[rounds.length - 1].matches[0];
  if (!final || !final.winner) return null;
  const first = final.winner;
  const second = final.p1 === first ? final.p2 : final.p1;
  const semis = rounds.length >= 2 ? rounds[rounds.length - 2].matches : [];
  const losers = semis
    .filter((m) => m.done && !m.bye && m.winner)
    .map((m) => ({ id: m.winner === m.p1 ? m.p2 : m.p1, games: m.winner === m.p1 ? m.s2 : m.s1 }))
    .sort((x, y) => (y.games || 0) - (x.games || 0));
  return { first, second, third: losers[0]?.id || null };
}

export function computePodium(jornada) {
  if (jornada.format === "nivellats") return null;
  if (jornada.format === "suis") {
    const wins = {};
    (jornada.swissRounds || []).forEach((r) => (r.matches || []).forEach((m) => {
      if (m.p1 && wins[m.p1] == null) wins[m.p1] = 0;
      if (m.p2 && wins[m.p2] == null) wins[m.p2] = 0;
      if (m.done && m.s1 != null && m.s2 != null && m.s1 !== m.s2) wins[m.s1 > m.s2 ? m.p1 : m.p2]++;
      else if (m.bye) wins[m.p1]++;
    }));
    const sorted = Object.entries(wins).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    if (!sorted.length) return null;
    return { gold: { first: sorted[0] || null, second: sorted[1] || null, third: sorted[2] || null } };
  }
  const gold = bracketPodium(jornada.bracketGold);
  return gold ? { gold } : null;
}

// ---------- Badges ----------
export const BADGE_ICONS = {
  first_win: "🏓", streak3: "🔥", streak5: "🌋", streak10: "☄️",
  giant: "⚔️", veteran: "🎖️", legend50: "🏅", six_hundred: "📈",
  elite700: "💎", clean_sweep: "🧹", cleansweep10: "✨", social10: "🤝",
  invicte: "🛡️", anotador: "🎯", superacio: "💪", revenja: "🔁",
};

export const BADGE_POINTS = {
  first_win: 5, streak3: 5, streak5: 10, streak10: 20,
  giant: 10, veteran: 10, legend50: 30, six_hundred: 10,
  elite700: 25, clean_sweep: 10, cleansweep10: 25, social10: 10,
  invicte: 15, anotador: 15, superacio: 15, revenja: 10,
};

export function computeBadges(player) {
  const history = player.matchHistory || [];
  const badges = new Set(player.earnedBadges || []);
  const wins = player.wins || 0;
  const played = player.played || 0;
  const elo = player.elo ?? ELO_START;

  if (wins >= 1) badges.add("first_win");

  let streak = 0, maxStreak = 0;
  history.forEach((m) => {
    if (m.result === "win") { streak++; maxStreak = Math.max(maxStreak, streak); }
    else streak = 0;
  });
  if (maxStreak >= 3) badges.add("streak3");
  if (maxStreak >= 5) badges.add("streak5");
  if (maxStreak >= 10) badges.add("streak10");

  if (played >= 20) badges.add("veteran");
  if (played >= 200) badges.add("legend50");
  if (elo >= 600) badges.add("six_hundred");
  if (elo >= 700) badges.add("elite700");

  const rivals = new Set(history.map((m) => m.opponentId).filter(Boolean));
  if (rivals.size >= 10) badges.add("social10");

  const cleanSweeps = history.filter((m) => m.result === "win" && (m.s2 || 0) === 0).length;
  if (cleanSweeps >= 5) badges.add("clean_sweep");
  if (cleanSweeps >= 10) badges.add("cleansweep10");

  return Array.from(badges);
}

// ---------- Seasons ----------
export const SEASON_AWARD_BONUS = { 1: 30, 2: 20, 3: 10 };

export function computeSeasonReset(players) {
  const withPlay = players.filter((p) => (p.played || 0) > 0).sort((a, b) => (a.elo || 0) - (b.elo || 0));
  const updates = {};
  withPlay.forEach((p, idx) => {
    updates[p.id] = { elo: ELO_START + idx };
  });
  players.filter((p) => !(p.played > 0)).forEach((p) => {
    updates[p.id] = { elo: ELO_START };
  });
  return updates;
}
