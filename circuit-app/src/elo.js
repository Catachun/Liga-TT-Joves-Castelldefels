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
export function makeGroups(sortedPlayers, targetSize = 4) {
  const n = sortedPlayers.length;
  const numGroups = Math.max(1, Math.round(n / targetSize));
  const groups = Array.from({ length: numGroups }, (_, i) => ({
    id: uid(),
    name: `Grup ${String.fromCharCode(65 + i)}`,
    playerIds: [],
  }));
  // snake seeding so groups are balanced by strength
  let dir = 1, g = 0;
  sortedPlayers.forEach((p) => {
    groups[g].playerIds.push(p.id);
    g += dir;
    if (g === numGroups) { g = numGroups - 1; dir = -1; }
    else if (g < 0) { g = 0; dir = 1; }
  });
  return groups.map((grp) => ({ ...grp, matches: roundRobin(grp.playerIds) }));
}

export function roundRobin(playerIds) {
  const matches = [];
  for (let i = 0; i < playerIds.length; i++) {
    for (let j = i + 1; j < playerIds.length; j++) {
      const others = playerIds.filter((id) => id !== playerIds[i] && id !== playerIds[j]);
      const refereeId = others.length > 0 ? others[matches.length % others.length] : null;
      matches.push({ id: uid(), p1: playerIds[i], p2: playerIds[j], s1: null, s2: null, winner: null, refereeId });
    }
  }
  return matches;
}

export function groupStandings(group, playersById) {
  const stats = {};
  (group.playerIds || []).forEach((id) => { stats[id] = { id, w: 0, l: 0, setsWon: 0, setsLost: 0 }; });
  (group.matches || []).forEach((m) => {
    if (m.winner == null) return;
    const loser = m.winner === m.p1 ? m.p2 : m.p1;
    if (stats[m.winner]) stats[m.winner].w++;
    if (stats[loser]) stats[loser].l++;
    if (stats[m.p1]) { stats[m.p1].setsWon += m.s1 || 0; stats[m.p1].setsLost += m.s2 || 0; }
    if (stats[m.p2]) { stats[m.p2].setsWon += m.s2 || 0; stats[m.p2].setsLost += m.s1 || 0; }
  });
  return Object.values(stats).sort((a, b) => {
    if (b.w !== a.w) return b.w - a.w;
    const diffA = a.setsWon - a.setsLost, diffB = b.setsWon - b.setsLost;
    return diffB - diffA;
  });
}

export function groupComplete(group) {
  return (group.matches || []).every((m) => m.winner != null);
}

// ---------- Grups Nivellats (level-reseeded second round) ----------
export function buildLevelGroups(round1Groups, playersById) {
  const maxSize = Math.max(0, ...round1Groups.map((g) => g.playerIds.length));
  const tiers = Array.from({ length: maxSize }, () => []);
  round1Groups.forEach((g) => {
    const standings = groupStandings(g, playersById);
    standings.forEach((s, rankIdx) => { tiers[rankIdx].push(s.id); });
  });
  return tiers
    .filter((t) => t.length > 0)
    .map((ids, i) => ({ id: uid(), name: `Nivell ${i + 1}`, playerIds: ids, matches: roundRobin(ids) }));
}

// ---------- Bracket (Quadre Or/Plata) ----------
export function buildBracket(playerIds) {
  let size = 2;
  while (size < playerIds.length) size *= 2;
  const seeded = [...playerIds];
  while (seeded.length < size) seeded.push(null); // bye
  const round1 = [];
  for (let i = 0; i < size / 2; i++) {
    const p1 = seeded[i];
    const p2 = seeded[size - 1 - i];
    const isBye = p1 == null || p2 == null;
    round1.push({
      id: uid(), round: 1, p1, p2,
      s1: null, s2: null,
      winner: isBye ? (p1 ?? p2) : null,
      bye: isBye,
    });
  }
  const rounds = [round1];
  let currentSize = round1.length;
  let roundNum = 2;
  while (currentSize > 1) {
    const nextRound = [];
    for (let i = 0; i < currentSize / 2; i++) {
      nextRound.push({ id: uid(), round: roundNum, p1: null, p2: null, s1: null, s2: null, winner: null, bye: false });
    }
    rounds.push(nextRound);
    currentSize = nextRound.length;
    roundNum++;
  }
  return propagateBracket(rounds);
}

// Advances winners into the next round's slots. Only auto-resolves a bye when
// the sibling feeder match is a PERMANENT structural bye (both slots empty) —
// never merely undecided — to avoid prematurely awarding a walkover to someone
// whose real opponent just hasn't finished their earlier match yet.
export function propagateBracket(rounds) {
  const newRounds = rounds.map((r) => r.map((m) => ({ ...m })));
  for (let ri = 0; ri < newRounds.length - 1; ri++) {
    const round = newRounds[ri];
    const nextRound = newRounds[ri + 1];
    for (let i = 0; i < round.length; i++) {
      const match = round[i];
      const nextMatch = nextRound[Math.floor(i / 2)];
      const slot = i % 2 === 0 ? "p1" : "p2";
      if (match.winner != null) {
        nextMatch[slot] = match.winner;
      } else {
        nextMatch[slot] = null;
      }
    }
  }
  // resolve structural byes (both slots empty is impossible at leaf; byes only
  // happen when the OTHER slot of a next-round match is also a permanent bye)
  for (let ri = 1; ri < newRounds.length; ri++) {
    newRounds[ri].forEach((m) => {
      const structuralBye = (m.p1 == null) !== (m.p2 == null) &&
        // only treat as resolved bye if the feeding match itself was a bye (permanent),
        // not simply because the previous match hasn't been played yet
        newRounds[ri - 1].some((fm) => fm.bye && (fm.winner === m.p1 || fm.winner === m.p2));
      if (structuralBye && m.winner == null) {
        m.winner = m.p1 ?? m.p2;
        m.bye = true;
      }
    });
  }
  return newRounds;
}

export function bracketRoundName(roundIdx, totalRounds, t) {
  const fromEnd = totalRounds - roundIdx;
  if (fromEnd === 1) return t("final");
  if (fromEnd === 2) return t("semifinal");
  if (fromEnd === 3) return t("quarts");
  return t("round_of", { n: roundIdx + 1 });
}

// ---------- Sistema Suís ----------
export function generateSwissRound(playerIds, previousRounds) {
  const played = new Set();
  previousRounds.forEach((r) => r.matches.forEach((m) => {
    if (m.p2) played.add(`${m.p1}|${m.p2}`), played.add(`${m.p2}|${m.p1}`);
  }));
  const available = [...playerIds];
  const matches = [];
  while (available.length > 1) {
    const p1 = available.shift();
    let idx = available.findIndex((p2) => !played.has(`${p1}|${p2}`));
    if (idx === -1) idx = 0;
    const p2 = available.splice(idx, 1)[0];
    matches.push({ id: uid(), p1, p2, s1: null, s2: null, winner: null });
  }
  if (available.length === 1) {
    matches.push({ id: uid(), p1: available[0], p2: null, s1: null, s2: null, winner: available[0], bye: true });
  }
  return matches;
}

// ---------- Podium ----------
export function computePodium(jornada) {
  if (jornada.format === "nivellats") return null; // no single champion by design
  if (jornada.format === "suis" && jornada.swiss) {
    const wins = {};
    jornada.swiss.playerIds.forEach((id) => { wins[id] = 0; });
    jornada.swiss.rounds.forEach((r) => r.matches.forEach((m) => {
      if (m.winner && wins[m.winner] != null) wins[m.winner]++;
    }));
    const sorted = Object.entries(wins).sort((a, b) => b[1] - a[1]);
    return sorted.slice(0, 3).map(([id]) => id);
  }
  if (jornada.brackets) {
    const gold = jornada.brackets.gold;
    if (gold && gold.length) {
      const final = gold[gold.length - 1][0];
      if (final && final.winner) {
        const champion = final.winner;
        const runnerUp = final.p1 === champion ? final.p2 : final.p1;
        const semis = gold[gold.length - 2] || [];
        const thirds = semis
          .filter((m) => m.winner && ![champion, runnerUp].includes(m.winner))
          .map((m) => (m.winner === m.p1 ? m.p2 : m.p1))
          .filter(Boolean);
        return [champion, runnerUp, thirds[0]].filter(Boolean);
      }
    }
  }
  return null;
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
    if (m.result === "V") { streak++; maxStreak = Math.max(maxStreak, streak); }
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

  const cleanSweeps = history.filter((m) => m.result === "V" && (m.setsLost || 0) === 0).length;
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
