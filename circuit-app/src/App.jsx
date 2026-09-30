import React, { useEffect, useMemo, useState, useRef } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  where,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  writeBatch,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
} from "firebase/firestore";
import { ref, uploadString, getDownloadURL } from "firebase/storage";
import { db, storage } from "./firebase";
import { useLang, LangProvider } from "./i18n";
import { MASTER_PIN, MAX_PARTICIPANTS, MAX_WAITLIST, VENUES, JORNADA_PRICE, resolvePin, scheduleForDate } from "./config";
import {
  ELO_START,
  uid,
  slugEmail,
  calcELO,
  peakEloFor,
  DIVISIONS,
  divisionFor,
  makeGroups,
  roundRobin,
  groupStandings,
  groupComplete,
  buildLevelGroups,
  buildBracket,
  propagateBracket,
  bracketRoundName,
  generateSwissRound,
  computePodium,
  BADGE_ICONS,
  BADGE_POINTS,
  computeBadges,
  SEASON_AWARD_BONUS,
  computeSeasonReset,
} from "./elo";

// ---------------------------------------------------------------------------
// Local storage hooks
// ---------------------------------------------------------------------------
function usePersistedPlayer() {
  const [player, setPlayerState] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("ttj_player") || "null");
    } catch {
      return null;
    }
  });
  const setPlayer = (p) => {
    setPlayerState(p);
    if (p) localStorage.setItem("ttj_player", JSON.stringify(p));
    else localStorage.removeItem("ttj_player");
  };
  return [player, setPlayer];
}

function useAdminMode() {
  const [admin, setAdminState] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem("ttj_admin") || "null");
    } catch {
      return null;
    }
  });
  const setAdmin = (a) => {
    setAdminState(a);
    if (a) sessionStorage.setItem("ttj_admin", JSON.stringify(a));
    else sessionStorage.removeItem("ttj_admin");
  };
  return [admin, setAdmin];
}

// ---------------------------------------------------------------------------
// Firestore live data
// ---------------------------------------------------------------------------
function usePlayers() {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "players"), (snap) => {
      setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, []);
  return { players, loading };
}

// Live window: jornadas from ~30 days ago onward, ordered by date ascending.
// Historic (older) jornadas are fetched on demand to cap Firestore reads.
function useJornadas() {
  const [jornadas, setJornadas] = useState([]);
  const [historic, setHistoric] = useState([]);
  const [historicLoaded, setHistoricLoaded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const q = query(
      collection(db, "jornadas"),
      where("date", ">=", cutoffStr),
      orderBy("date", "asc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setJornadas(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, []);

  const loadHistoric = async () => {
    if (historicLoaded) return;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const q = query(
      collection(db, "jornadas"),
      where("date", "<", cutoffStr),
      orderBy("date", "asc")
    );
    const snap = await getDocs(q);
    setHistoric(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    setHistoricLoaded(true);
  };

  const all = useMemo(() => {
    const map = new Map();
    [...historic, ...jornadas].forEach((j) => map.set(j.id, j));
    return Array.from(map.values()).sort((a, b) => (a.date > b.date ? 1 : -1));
  }, [jornadas, historic]);

  return { jornadas: all, loading, loadHistoric, historicLoaded };
}

// ---------------------------------------------------------------------------
// Selfie capture
// ---------------------------------------------------------------------------
function SelfieCapture({ value, onChange }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [streaming, setStreaming] = useState(false);
  const fileInputRef = useRef(null);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
      });
      streamRef.current = stream;
      setStreaming(true);
    } catch {
      fileInputRef.current?.click();
    }
  };

  // The <video> element only mounts once `streaming` is true. Attaching the
  // stream here (after React has committed the DOM) guarantees the ref is
  // set, unlike doing it inline in startCamera where the element doesn't
  // exist yet. play() is called explicitly too: iOS Safari won't reliably
  // autoplay a stream attached outside a synchronous user-gesture call
  // stack (startCamera is async, so the await above already breaks that
  // chain), even with the autoPlay/playsInline/muted attributes set.
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!streaming || !video || !stream) return;
    video.srcObject = stream;
    video.muted = true;
    const playPromise = video.play();
    if (playPromise?.catch) playPromise.catch(() => {});
  }, [streaming]);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    []
  );

  const capture = () => {
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 480;
    const ctx = canvas.getContext("2d");
    const size = Math.min(video.videoWidth, video.videoHeight);
    ctx.drawImage(
      video,
      (video.videoWidth - size) / 2,
      (video.videoHeight - size) / 2,
      size,
      size,
      0,
      0,
      480,
      480
    );
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    onChange(dataUrl);
    const stream = video.srcObject;
    stream?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStreaming(false);
  };

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange(reader.result);
    reader.readAsDataURL(file);
  };

  return (
    <div className="selfie-capture">
      {value ? (
        <img src={value} alt="selfie" className="selfie-preview" onClick={startCamera} />
      ) : streaming ? (
        <div className="selfie-live">
          <video ref={videoRef} autoPlay playsInline muted />
          <button type="button" onClick={capture}>📸</button>
        </div>
      ) : (
        <button type="button" className="selfie-btn" onClick={startCamera}>
          🤳
        </button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="user"
        style={{ display: "none" }}
        onChange={onFile}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Login / family profile flow
// ---------------------------------------------------------------------------
function LoginScreen({ onLogin }) {
  const { t, lang, setLang } = useLang();
  const [step, setStep] = useState("email"); // email -> picker|new
  const [email, setEmail] = useState("");
  const [familyMembers, setFamilyMembers] = useState([]);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [selfie, setSelfie] = useState(null);
  const [consent, setConsent] = useState(false);
  const [federatNumber, setFederatNumber] = useState("");
  const [noFederat, setNoFederat] = useState(false);
  const [error, setError] = useState("");

  const loadFamily = async () => {
    if (!email.trim()) return;
    setLoading(true);
    setError("");
    try {
      const q = query(collection(db, "players"), where("familyEmail", "==", email.trim().toLowerCase()));
      const snap = await getDocs(q);
      const members = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setFamilyMembers(members);
      setStep(members.length ? "picker" : "new");
    } catch {
      setError(t("err_connection"));
    }
    setLoading(false);
  };

  const submitNewProfile = async () => {
    if (!name.trim() || !email.trim()) {
      setError(t("err_name_email"));
      return;
    }
    if (!selfie) {
      setError(t("err_selfie_required"));
      return;
    }
    if (!consent) {
      setError(t("err_consent_required"));
      return;
    }
    if (!noFederat && !federatNumber.trim()) {
      setError(t("err_federat_required"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      let selfieUrl = selfie;
      try {
        const path = `selfies/${uid()}.jpg`;
        const sref = ref(storage, path);
        await uploadString(sref, selfie, "data_url");
        selfieUrl = await getDownloadURL(sref);
      } catch {
        // keep the data URL inline if storage upload fails
      }
      const newPlayer = {
        name: name.trim(),
        familyEmail: email.trim().toLowerCase(),
        selfieUrl,
        consent: true,
        federatNumber: noFederat ? null : federatNumber.trim(),
        federat: !noFederat,
        club: "",
        hand: "dreta",
        style: "allround",
        elo: ELO_START,
        peakElo: ELO_START,
        wins: 0,
        losses: 0,
        played: 0,
        earnedBadges: [],
        matchHistory: [],
        opponents: [],
        seasonAwards: [],
        active: true,
        createdAt: serverTimestamp(),
      };
      const docRef = await addDoc(collection(db, "players"), newPlayer);
      onLogin({ id: docRef.id, ...newPlayer });
    } catch {
      setError(t("err_connection"));
    }
    setLoading(false);
  };

  return (
    <div className="login-screen">
      <div className="lang-switch">
        {["ca", "es", "en"].map((l) => (
          <button key={l} className={lang === l ? "active" : ""} onClick={() => setLang(l)}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
      <h1>{t("login_title")}</h1>
      <p className="club-name">{t("club")}</p>

      {step === "email" && (
        <div className="login-step">
          <input
            type="email"
            placeholder={t("login_email_ph")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <p className="hint">{t("family_hint")}</p>
          {error && <p className="error">{error}</p>}
          <button disabled={loading} onClick={loadFamily}>
            {loading ? t("entering") : t("continue_btn")}
          </button>
        </div>
      )}

      {step === "picker" && (
        <div className="login-step">
          <h2>{t("family_picker_title")}</h2>
          <div className="family-list">
            {familyMembers.map((m) => (
              <button key={m.id} className="family-member" onClick={() => onLogin(m)}>
                {m.selfieUrl && <img src={m.selfieUrl} alt={m.name} />}
                <span>{m.name}</span>
              </button>
            ))}
          </div>
          {familyMembers.length < 5 ? (
            <button className="secondary" onClick={() => setStep("new")}>
              {t("add_family_member")}
            </button>
          ) : (
            <p className="hint">{t("max_family_reached")}</p>
          )}
        </div>
      )}

      {step === "new" && (
        <div className="login-step">
          <h2>{t("new_profile_title")}</h2>
          <input
            type="text"
            placeholder={t("login_name_ph")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <SelfieCapture value={selfie} onChange={setSelfie} />
          <p className="selfie-cta">{t("login_selfie_cta")}</p>

          <div className="federat-field">
            <label>{t("reg_federat_label")}</label>
            <input
              type="text"
              placeholder={t("reg_federat_ph")}
              value={federatNumber}
              disabled={noFederat}
              onChange={(e) => setFederatNumber(e.target.value)}
            />
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={noFederat}
                onChange={(e) => {
                  setNoFederat(e.target.checked);
                  if (e.target.checked) setFederatNumber("");
                }}
              />
              {t("reg_no_federat")}
            </label>
          </div>

          <label className="checkbox-line">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            {t("login_consent")}
          </label>
          <p className="hint small">{t("login_consent_minor")}</p>
          <p className="hint">{t("login_hint")}</p>
          {error && <p className="error">{error}</p>}
          <button disabled={loading} onClick={submitNewProfile}>
            {loading ? t("entering") : t("create_profile_btn")}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ranking tab
// ---------------------------------------------------------------------------
function RankingTab({ players }) {
  const { t } = useLang();
  const [filterClub, setFilterClub] = useState("");
  const [filterHand, setFilterHand] = useState("");
  const [filterStyle, setFilterStyle] = useState("");
  const [showCalc, setShowCalc] = useState(false);
  const [calcRivalId, setCalcRivalId] = useState("");

  const active = players.filter((p) => p.active !== false).sort((a, b) => (b.elo || ELO_START) - (a.elo || ELO_START));
  const clubs = Array.from(new Set(players.map((p) => p.club).filter(Boolean)));

  const filtered = active.filter((p) => {
    if (filterClub && p.club !== filterClub) return false;
    if (filterHand && p.hand !== filterHand) return false;
    if (filterStyle && p.style !== filterStyle) return false;
    return true;
  });

  const stats = {
    players: active.length,
    matches: active.reduce((s, p) => s + (p.played || 0), 0) / 2,
    avgElo: active.length ? Math.round(active.reduce((s, p) => s + (p.elo || ELO_START), 0) / active.length) : 0,
  };

  return (
    <div className="ranking-tab">
      <div className="tab-header">
        <h2>{t("ranking_title")}</h2>
        <button onClick={() => setShowCalc(true)}>{t("calc_btn")}</button>
      </div>

      <div className="stats-bar">
        <div><b>{stats.players}</b> {t("stats_players")}</div>
        <div><b>{Math.round(stats.matches)}</b> {t("stats_matches")}</div>
        <div><b>{stats.avgElo}</b> {t("stats_avgelo")}</div>
      </div>

      <div className="filters">
        <select value={filterClub} onChange={(e) => setFilterClub(e.target.value)}>
          <option value="">{t("filter_clubs")}</option>
          {clubs.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={filterHand} onChange={(e) => setFilterHand(e.target.value)}>
          <option value="">{t("filter_hands")}</option>
          <option value="dreta">{t("ma_dreta")}</option>
          <option value="esquerra">{t("ma_esquerra")}</option>
        </select>
        <select value={filterStyle} onChange={(e) => setFilterStyle(e.target.value)}>
          <option value="">{t("filter_styles")}</option>
          <option value="allround">{t("estil_allround")}</option>
          <option value="atac">{t("estil_atac")}</option>
          <option value="defensiu">{t("estil_defensiu")}</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="empty">{active.length ? t("no_match_filter") : t("no_players")}</p>
      ) : (
        <ol className="ranking-list">
          {filtered.map((p, i) => {
            const div = divisionFor(p.elo || ELO_START);
            return (
              <li key={p.id} className="ranking-row">
                <span className="pos">{i + 1}</span>
                {p.selfieUrl && <img src={p.selfieUrl} alt={p.name} className="avatar" />}
                <span className="name">{p.name}</span>
                <span className="division">{div.icon}</span>
                <span className="elo">{Math.round(p.elo || ELO_START)}</span>
              </li>
            );
          })}
        </ol>
      )}

      {showCalc && (
        <div className="modal-overlay" onClick={() => setShowCalc(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t("calc_title")}</h3>
            <select value={calcRivalId} onChange={(e) => setCalcRivalId(e.target.value)}>
              <option value="">{t("calc_rival")}</option>
              {active.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({Math.round(p.elo || ELO_START)})</option>
              ))}
            </select>
            <button onClick={() => setShowCalc(false)}>{t("calc_close")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Jornades tab (list) + detail
// ---------------------------------------------------------------------------
function JornadesTab({ player, players, jornadas, loadHistoric, admin }) {
  const { t } = useLang();
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState("list");
  const [newForm, setNewForm] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [venue, setVenue] = useState("joves");
  const [isTest, setIsTest] = useState(false);

  if (selected) {
    const j = jornadas.find((x) => x.id === selected) || selected;
    return (
      <JornadaDetail
        jornada={j}
        player={player}
        players={players}
        admin={admin}
        onBack={() => setSelected(null)}
      />
    );
  }

  const createJornada = async () => {
    if (!name.trim() || !date) return;
    if (isTest && !window.confirm(t("confirm_test_jornada"))) return;
    const schedule = scheduleForDate(date);
    await addDoc(collection(db, "jornadas"), {
      name: name.trim(),
      date,
      venueKey: venue,
      isTest,
      status: "inscripcio",
      schedule,
      participants: [],
      waitlist: [],
      createdAt: serverTimestamp(),
    });
    setNewForm(false);
    setName("");
    setDate("");
    setIsTest(false);
  };

  return (
    <div className="jornades-tab">
      <div className="tab-header">
        <h2>{t("jornades_title")}</h2>
        <div className="view-switch">
          <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>{t("view_list")}</button>
          <button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}>{t("view_calendar")}</button>
        </div>
        {admin?.type === "master" && (
          <button onClick={() => setNewForm(true)}>{t("new_jornada")}</button>
        )}
      </div>

      {newForm && (
        <div className="modal-overlay" onClick={() => setNewForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <label>{t("jornada_name_label")}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("new_jornada_prompt")} />
            <label>{t("jornada_date_label")}</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <label>{t("jornada_venue_label")}</label>
            <select value={venue} onChange={(e) => setVenue(e.target.value)}>
              {Object.entries(VENUES).map(([key, v]) => (
                <option key={key} value={key}>{v.name}</option>
              ))}
            </select>
            <label className="checkbox-line">
              <input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} />
              {t("jornada_test_label")}
            </label>
            <button onClick={createJornada}>{t("create_jornada_btn")}</button>
          </div>
        </div>
      )}

      {jornadas.length === 0 ? (
        <p className="empty">{t("no_jornades")}</p>
      ) : (
        <ul className="jornada-list">
          {jornadas.map((j) => (
            <li key={j.id} className="jornada-row" onClick={() => setSelected(j.id)}>
              <span className="jornada-name">
                {j.name}{j.isTest ? t("tag_test") : ""}
              </span>
              <span className="jornada-date">{j.date}</span>
              <span className={`jornada-status status-${j.status}`}>
                {t(`status_${j.status === "grups_r1" ? "grups_r1" : j.status}`)}
              </span>
              <span className="jornada-count">
                {(j.participants || []).length} {t("inscrits_suffix")}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!admin && (
        <button className="secondary load-historic" onClick={loadHistoric}>
          {t("load_historic")}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Jornada detail — registration, quota panel, formats, rounds, closing
// ---------------------------------------------------------------------------
function JornadaDetail({ jornada, player, players, admin, onBack }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);

  const participants = jornada.participants || [];
  const waitlist = jornada.waitlist || [];
  const isParticipant = player && participants.some((p) => p.playerId === player.id);
  const isWaitlisted = player && waitlist.some((p) => p.playerId === player.id);
  const venue = VENUES[jornada.venueKey] || VENUES.joves;
  const schedule = jornada.schedule || scheduleForDate(jornada.date);

  const playerById = (id) => players.find((p) => p.id === id);

  const join = async () => {
    if (!player) return;
    setBusy(true);
    const jref = doc(db, "jornadas", jornada.id);
    if (participants.length >= MAX_PARTICIPANTS) {
      if (waitlist.length >= MAX_WAITLIST) {
        alert(t("jornada_full"));
        setBusy(false);
        return;
      }
      await updateDoc(jref, {
        waitlist: arrayUnion({ playerId: player.id, joinedAt: Date.now() }),
      });
      alert(t("added_to_waitlist", { pos: waitlist.length + 1 }));
    } else {
      await updateDoc(jref, {
        participants: arrayUnion({ playerId: player.id, confirmed: true, paid: false, joinedAt: Date.now() }),
      });
    }
    setBusy(false);
  };

  const leave = async () => {
    if (!player) return;
    setBusy(true);
    const jref = doc(db, "jornadas", jornada.id);
    const entry = participants.find((p) => p.playerId === player.id);
    if (entry) await updateDoc(jref, { participants: arrayRemove(entry) });
    const wentry = waitlist.find((p) => p.playerId === player.id);
    if (wentry) await updateDoc(jref, { waitlist: arrayRemove(wentry) });
    // promote first waitlisted player if a confirmed spot opened
    if (entry && waitlist.length) {
      const promoted = waitlist[0];
      await updateDoc(jref, {
        waitlist: arrayRemove(promoted),
        participants: arrayUnion({ ...promoted, confirmed: true, paid: false, promoted: true }),
      });
    }
    setBusy(false);
  };

  const markPaid = async (playerId) => {
    const jref = doc(db, "jornadas", jornada.id);
    const entry = participants.find((p) => p.playerId === playerId);
    if (!entry) return;
    await updateDoc(jref, { participants: arrayRemove(entry) });
    await updateDoc(jref, { participants: arrayUnion({ ...entry, paid: true }) });
  };

  const removeParticipant = async (playerId) => {
    const p = playerById(playerId);
    if (!window.confirm(t("confirm_remove_participant", { name: p?.name || "" }))) return;
    const jref = doc(db, "jornadas", jornada.id);
    const entry = participants.find((x) => x.playerId === playerId);
    if (entry) await updateDoc(jref, { participants: arrayRemove(entry) });
  };

  const startTournament = async (format) => {
    setBusy(true);
    const jref = doc(db, "jornadas", jornada.id);
    const ids = participants.map((p) => p.playerId);
    const ratings = {};
    ids.forEach((id) => (ratings[id] = playerById(id)?.elo || ELO_START));

    if (format === "grups" || format === "nivellats") {
      const groups = makeGroups(ids, ratings);
      const groupsData = groups.map((g, i) => ({
        id: `g${i}`,
        players: g,
        matches: roundRobin(g),
      }));
      await updateDoc(jref, {
        format,
        status: format === "nivellats" ? "grups_r1" : "grups",
        groups: groupsData,
      });
    } else if (format === "suis") {
      const round1 = generateSwissRound(ids, ratings, []);
      await updateDoc(jref, {
        format: "suis",
        status: "suis",
        swissRounds: [{ round: 1, matches: round1 }],
      });
    }
    setBusy(false);
  };

  const saveMatchResult = async (field, groupId, matchId, s1, s2) => {
    const jref = doc(db, "jornadas", jornada.id);
    const list = [...(jornada[field] || [])];
    const gIdx = list.findIndex((g) => g.id === groupId);
    if (gIdx === -1) return;
    const group = { ...list[gIdx], matches: list[gIdx].matches.map((m) => (m.id === matchId ? { ...m, s1, s2, done: true } : m)) };
    list[gIdx] = group;
    await updateDoc(jref, { [field]: list });
  };

  const generateRound2Nivellats = async () => {
    const groups = jornada.groups || [];
    const standingsByGroup = groups.map((g) => groupStandings(g));
    const levelGroups = buildLevelGroups(standingsByGroup);
    const groupsR2 = levelGroups.map((g, i) => ({
      id: `g2_${i}`,
      players: g,
      matches: roundRobin(g),
    }));
    await updateDoc(doc(db, "jornadas", jornada.id), {
      status: "grups_r2",
      groupsR2,
    });
  };

  const generateBrackets = async () => {
    const groups = jornada.groups || [];
    const allComplete = groups.every((g) => groupComplete(g));
    if (!allComplete) {
      alert(t("alert_groups_incomplete"));
      return;
    }
    const standingsByGroup = groups.map((g) => groupStandings(g));
    const gold = [];
    const silver = [];
    standingsByGroup.forEach((s) => {
      s.forEach((row, idx) => {
        if (idx === 0 || idx === 1) gold.push(row.playerId);
        else silver.push(row.playerId);
      });
    });
    await updateDoc(doc(db, "jornadas", jornada.id), {
      status: "eliminatories",
      bracketGold: buildBracket(gold),
      bracketSilver: buildBracket(silver),
    });
  };

  const closeJornada = async () => {
    if (!window.confirm(t("confirm_close_jornada"))) return;
    setBusy(true);
    const podium = computePodium(jornada, players);
    const batch = writeBatch(db);
    // recompute ELO for all participants based on match history in this jornada
    const involvedIds = participants.map((p) => p.playerId);
    involvedIds.forEach((id) => {
      const p = playerById(id);
      if (!p) return;
      const pRef = doc(db, "players", id);
      const newBadges = computeBadges(p);
      batch.update(pRef, {
        matchHistory: p.matchHistory || [],
        earnedBadges: newBadges.earned,
        elo: p.elo,
        peakElo: peakEloFor(p),
      });
    });
    if (!jornada.isTest) {
      batch.update(doc(db, "jornadas", jornada.id), {
        status: "tancada",
        closedAt: serverTimestamp(),
        podium,
      });
    } else {
      batch.update(doc(db, "jornadas", jornada.id), { status: "tancada", closedAt: serverTimestamp() });
    }
    await batch.commit();
    setBusy(false);
  };

  const deleteJornada = async () => {
    if (!window.confirm(t("confirm_delete_jornada", { name: jornada.name }))) return;
    try {
      await deleteDoc(doc(db, "jornadas", jornada.id));
      onBack();
    } catch {
      alert(t("delete_jornada_error"));
    }
  };

  return (
    <div className="jornada-detail">
      <button className="back-btn" onClick={onBack}>{t("back")}</button>
      <h2>{jornada.name}{jornada.isTest ? t("tag_test") : ""}</h2>
      <p className="jornada-meta">
        {jornada.date} · {venue.name} · {t("schedule_opening")}: {schedule.opening} · {t("schedule_start")}: {schedule.start}
      </p>
      <p className="jornada-status-label">{t(`status_${jornada.status}`) || jornada.status}</p>

      {jornada.status === "inscripcio" && (
        <div className="registration-box">
          <p>{participants.length} / {MAX_PARTICIPANTS} {t("players_count_suffix")}</p>
          {player && (
            isParticipant ? (
              <button disabled={busy} className="danger" onClick={leave}>{t("leave_btn")}</button>
            ) : isWaitlisted ? (
              <p className="hint">{t("you_are_waitlisted")}</p>
            ) : participants.length >= MAX_PARTICIPANTS ? (
              <button disabled={busy} onClick={join}>{t("join_waitlist_btn")}</button>
            ) : (
              <button disabled={busy} onClick={join}>
                {jornada.isTest ? t("join_btn_free") : t("join_btn")}
              </button>
            )
          )}

          <ul className="participant-list">
            {participants.map((entry) => {
              const p = playerById(entry.playerId);
              return (
                <li key={entry.playerId}>
                  {p?.name || "?"}
                  {entry.paid && <span className="tag paid">{t("paid")}</span>}
                  {admin?.type === "venue" || admin?.type === "master" ? (
                    <>
                      {!entry.paid && (
                        <button onClick={() => markPaid(entry.playerId)}>{t("mark_paid")}</button>
                      )}
                      <button className="danger small" onClick={() => removeParticipant(entry.playerId)}>
                        {t("remove_participant")}
                      </button>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {waitlist.length > 0 && (
            <div className="waitlist-box">
              <h4>{t("waitlist_title")}</h4>
              <ul>
                {waitlist.map((entry) => (
                  <li key={entry.playerId}>{playerById(entry.playerId)?.name || "?"}</li>
                ))}
              </ul>
            </div>
          )}

          {admin?.type === "master" && participants.length >= 3 && (
            <div className="start-tournament-box">
              <h4>{t("start_tournament_title")}</h4>
              <p>{t("choose_format", { n: participants.length })}</p>
              <button onClick={() => startTournament("grups")}>{t("format_grups")}</button>
              <button onClick={() => startTournament("suis")}>{t("format_suis")}</button>
              <button onClick={() => startTournament("nivellats")}>{t("format_nivellats")}</button>
            </div>
          )}
        </div>
      )}

      {(jornada.status === "grups" || jornada.status === "grups_r1" || jornada.status === "grups_r2") && (
        <GroupsView
          jornada={jornada}
          field={jornada.status === "grups_r2" ? "groupsR2" : "groups"}
          players={players}
          admin={admin}
          onSaveResult={saveMatchResult}
          onNextStep={
            jornada.status === "grups_r1"
              ? generateRound2Nivellats
              : jornada.status === "grups"
              ? generateBrackets
              : null
          }
          nextStepLabel={jornada.status === "grups_r1" ? t("generate_round2") : t("generate_brackets")}
          onCloseNoBrackets={jornada.status === "grups_r2" ? closeJornada : null}
        />
      )}

      {jornada.status === "suis" && (
        <SwissView jornada={jornada} players={players} admin={admin} onSaveResult={saveMatchResult} onClose={closeJornada} />
      )}

      {jornada.status === "eliminatories" && (
        <BracketsView jornada={jornada} players={players} admin={admin} onSaveResult={saveMatchResult} onClose={closeJornada} />
      )}

      {jornada.status === "tancada" && jornada.podium && (
        <PodiumView jornada={jornada} players={players} />
      )}

      {admin?.type === "master" && jornada.status !== "tancada" && (
        <button className="danger delete-jornada" onClick={deleteJornada}>{t("delete_jornada_btn")}</button>
      )}
    </div>
  );
}

function GroupsView({ jornada, field, players, admin, onSaveResult, onNextStep, nextStepLabel, onCloseNoBrackets }) {
  const { t } = useLang();
  const groups = jornada[field] || [];
  const playerById = (id) => players.find((p) => p.id === id);
  const canEdit = admin?.type === "master" || admin?.type === "venue" || admin?.type === "referee";
  const allComplete = groups.every((g) => groupComplete(g));

  return (
    <div className="groups-view">
      {groups.map((g) => {
        const standings = groupStandings(g);
        return (
          <div key={g.id} className="group-card">
            <h4>Grup {g.id.toUpperCase()}</h4>
            <table className="standings-table">
              <tbody>
                {standings.map((row, i) => (
                  <tr key={row.playerId}>
                    <td>{i + 1}</td>
                    <td>{playerById(row.playerId)?.name}</td>
                    <td>{row.wins}-{row.losses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="match-list">
              {g.matches.map((m) => (
                <MatchRow
                  key={m.id}
                  match={m}
                  p1={playerById(m.p1)}
                  p2={playerById(m.p2)}
                  canEdit={canEdit}
                  onSave={(s1, s2) => onSaveResult(field, g.id, m.id, s1, s2)}
                />
              ))}
            </ul>
          </div>
        );
      })}
      {canEdit && allComplete && onNextStep && (
        <button onClick={onNextStep}>{nextStepLabel}</button>
      )}
      {canEdit && allComplete && onCloseNoBrackets && (
        <button onClick={onCloseNoBrackets}>{t("close_no_brackets")}</button>
      )}
    </div>
  );
}

function SwissView({ jornada, players, admin, onSaveResult, onClose }) {
  const { t } = useLang();
  const rounds = jornada.swissRounds || [];
  const playerById = (id) => players.find((p) => p.id === id);
  const canEdit = admin?.type === "master" || admin?.type === "venue" || admin?.type === "referee";
  const last = rounds[rounds.length - 1];
  const lastComplete = last ? last.matches.every((m) => m.done || m.bye) : false;

  const nextRound = async () => {
    const ratings = {};
    players.forEach((p) => (ratings[p.id] = p.elo || ELO_START));
    const ids = jornada.participants.map((p) => p.playerId);
    const played = rounds.flatMap((r) => r.matches.map((m) => [m.p1, m.p2].sort().join("-")));
    const matches = generateSwissRound(ids, ratings, played);
    const jref = doc(db, "jornadas", jornada.id);
    await updateDoc(jref, {
      swissRounds: [...rounds, { round: rounds.length + 1, matches }],
    });
  };

  return (
    <div className="swiss-view">
      {rounds.map((r) => (
        <div key={r.round} className="round-card">
          <h4>{t("round_label", { n: r.round })}</h4>
          <ul className="match-list">
            {r.matches.map((m) => (
              <MatchRow
                key={m.id}
                match={m}
                p1={playerById(m.p1)}
                p2={playerById(m.p2)}
                canEdit={canEdit}
                onSave={(s1, s2) =>
                  onSaveResult("swissRounds", null, m.id, s1, s2) /* handled specially below */
                }
                swissRound={r.round}
                jornadaId={jornada.id}
                allRounds={rounds}
              />
            ))}
          </ul>
        </div>
      ))}
      {canEdit && lastComplete && (
        <>
          <button onClick={nextRound}>{t("next_round")}</button>
          <button onClick={onClose}>{t("close_jornada")}</button>
        </>
      )}
    </div>
  );
}

function BracketsView({ jornada, players, admin, onSaveResult, onClose }) {
  const { t } = useLang();
  const playerById = (id) => players.find((p) => p.id === id);
  const canEdit = admin?.type === "master" || admin?.type === "venue" || admin?.type === "referee";

  const saveBracketMatch = async (bracketKey, matchId, s1, s2) => {
    const jref = doc(db, "jornadas", jornada.id);
    const bracket = propagateBracket(jornada[bracketKey], matchId, s1, s2);
    await updateDoc(jref, { [bracketKey]: bracket });
  };

  const renderBracket = (bracket, key, title) => {
    if (!bracket) return null;
    const rounds = bracket.rounds || [];
    return (
      <div className="bracket-card">
        <h4>{title}</h4>
        {rounds.map((round, ri) => (
          <div key={ri} className="bracket-round">
            <h5>{bracketRoundName(rounds.length, ri)}</h5>
            {round.map((m) => (
              <div key={m.id} className="bracket-match">
                <span>{m.p1 ? playerById(m.p1)?.name : m.bye ? t("bye_label") : "?"}</span>
                <span>{m.s1 ?? ""} - {m.s2 ?? ""}</span>
                <span>{m.p2 ? playerById(m.p2)?.name : m.bye ? t("bye_label") : "?"}</span>
                {canEdit && m.p1 && m.p2 && !m.done && (
                  <ResultEditor onSave={(s1, s2) => saveBracketMatch(key, m.id, s1, s2)} />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  const bothDone =
    jornada.bracketGold?.rounds?.every((r) => r.every((m) => m.done || m.bye)) &&
    jornada.bracketSilver?.rounds?.every((r) => r.every((m) => m.done || m.bye));

  return (
    <div className="brackets-view">
      {renderBracket(jornada.bracketGold, "bracketGold", t("quadre_or"))}
      {renderBracket(jornada.bracketSilver, "bracketSilver", t("quadre_plata"))}
      {canEdit && bothDone && <button onClick={onClose}>{t("close_jornada")}</button>}
    </div>
  );
}

function MatchRow({ match, p1, p2, canEdit, onSave }) {
  const { t } = useLang();
  if (match.bye) {
    return <li className="match-row bye">{p1?.name || p2?.name} — {t("bye_win")}</li>;
  }
  return (
    <li className="match-row">
      <span>{p1?.name}</span>
      {match.done ? (
        <span className="result">{match.s1} - {match.s2}</span>
      ) : canEdit ? (
        <ResultEditor onSave={onSave} />
      ) : (
        <span className="result pending">vs</span>
      )}
      <span>{p2?.name}</span>
    </li>
  );
}

function ResultEditor({ onSave }) {
  const { t } = useLang();
  const [s1, setS1] = useState("");
  const [s2, setS2] = useState("");
  return (
    <span className="result-editor">
      <input type="number" min="0" value={s1} onChange={(e) => setS1(e.target.value)} />
      -
      <input type="number" min="0" value={s2} onChange={(e) => setS2(e.target.value)} />
      <button
        onClick={() => {
          if (s1 === "" || s2 === "") {
            alert(t("invalid_result"));
            return;
          }
          onSave(Number(s1), Number(s2));
        }}
      >
        {t("save")}
      </button>
    </span>
  );
}

function PodiumView({ jornada, players }) {
  const { t } = useLang();
  const playerById = (id) => players.find((p) => p.id === id);
  const podium = jornada.podium || {};
  return (
    <div className="podium-view">
      <h3>{t("podium_title")}</h3>
      <p>{t("podium_done")}</p>
      {podium.gold && (
        <ol className="podium-list">
          {[podium.gold?.first, podium.gold?.second, podium.gold?.third].filter(Boolean).map((id, i) => (
            <li key={id}>{i + 1}. {playerById(id)?.name}</li>
          ))}
        </ol>
      )}
      {podium.mvp && (
        <p className="mvp">{t("mvp_title")}: {t("mvp_line", { name: playerById(podium.mvp)?.name || "", gain: podium.mvpGain || 0 })}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Perfil tab
// ---------------------------------------------------------------------------
function PerfilTab({ player, players, onLogout, onUpdate }) {
  const { t } = useLang();
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(player.name);
  const [club, setClub] = useState(player.club || "");
  const [hand, setHand] = useState(player.hand || "dreta");
  const [style, setStyle] = useState(player.style || "allround");

  const div = divisionFor(player.elo || ELO_START);
  const badges = player.earnedBadges || [];

  const saveInfo = async () => {
    try {
      await updateDoc(doc(db, "players", player.id), { club, hand, style });
      onUpdate({ ...player, club, hand, style });
    } catch {
      alert(t("err_saveinfo"));
    }
  };

  const saveName = async () => {
    if (!name.trim()) return;
    try {
      await updateDoc(doc(db, "players", player.id), { name: name.trim() });
      onUpdate({ ...player, name: name.trim() });
      setEditingName(false);
    } catch {
      alert(t("err_savename"));
    }
  };

  return (
    <div className="perfil-tab">
      <div className="perfil-header">
        {player.selfieUrl && <img src={player.selfieUrl} alt={player.name} className="perfil-avatar" />}
        {editingName ? (
          <span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <button onClick={saveName}>{t("save")}</button>
          </span>
        ) : (
          <h2 onClick={() => setEditingName(true)}>{player.name}</h2>
        )}
        <p className="division-badge">{div.icon} {t(`division_${div.key}`)}</p>
        <p className="elo-line">{Math.round(player.elo || ELO_START)} ELO · {t("peak_elo")}: {Math.round(peakEloFor(player))}</p>
        {player.federationRequestStatus === "pending" && !player.federat && (
          <p className="tag pending-federation">{t("federation_pending_tag")}</p>
        )}
      </div>

      <div className="stats-row">
        <div><b>{player.wins || 0}</b> {t("victories")}</div>
        <div><b>{player.losses || 0}</b> {t("defeats")}</div>
      </div>

      {(player.seasonAwards || []).length > 0 && (
        <div className="trophies">
          <p>{t("trophies_label")}</p>
          {player.seasonAwards.map((a, i) => (
            <span key={i} className="trophy">S{a.season} #{a.position}</span>
          ))}
        </div>
      )}

      <div className="playerinfo-box">
        <h4>{t("playerinfo_title")}</h4>
        <label>{t("playerinfo_club")}</label>
        <input value={club} placeholder={t("playerinfo_club_ph")} onChange={(e) => setClub(e.target.value)} />
        <label>{t("playerinfo_hand")}</label>
        <select value={hand} onChange={(e) => setHand(e.target.value)}>
          <option value="dreta">{t("ma_dreta")}</option>
          <option value="esquerra">{t("ma_esquerra")}</option>
        </select>
        <label>{t("playerinfo_style")}</label>
        <select value={style} onChange={(e) => setStyle(e.target.value)}>
          <option value="allround">{t("estil_allround")}</option>
          <option value="atac">{t("estil_atac")}</option>
          <option value="defensiu">{t("estil_defensiu")}</option>
        </select>
        <button onClick={saveInfo}>{t("save")}</button>
      </div>

      <div className="badges-box">
        <h4>{t("badges_title")}</h4>
        <div className="badges-grid">
          {Object.keys(BADGE_ICONS).map((key) => {
            const earned = badges.includes(key);
            return (
              <div key={key} className={`badge ${earned ? "earned" : "locked"}`} title={t(`badge_${key}_desc`)}>
                <span className="badge-icon">{BADGE_ICONS[key]}</span>
                <span className="badge-name">{t(`badge_${key}_name`)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="history-box">
        <h4>{t("history_title")}</h4>
        {(player.matchHistory || []).length === 0 ? (
          <p className="empty">{t("history_empty")}</p>
        ) : (
          <ul>
            {(player.matchHistory || []).slice().reverse().map((m, i) => (
              <li key={i}>
                {players.find((p) => p.id === m.opponentId)?.name || "?"} — {m.result === "win" ? "W" : "L"} ({m.s1}-{m.s2})
              </li>
            ))}
          </ul>
        )}
      </div>

      <button className="logout-btn" onClick={onLogout}>{t("perfil_logout")}</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Normes tab
// ---------------------------------------------------------------------------
function NormesTab() {
  const { t } = useLang();
  return (
    <div className="normes-tab">
      <h2>{t("normes_title")}</h2>
      <section>
        <h3>{t("normes_howworks_title")}</h3>
        <p>{t("normes_1")}</p>
        <p>{t("normes_4")}</p>
      </section>
      <section>
        <h3>{t("normes_price_title")}</h3>
        <p>{t("normes_2")}</p>
      </section>
      <section>
        <h3>{t("normes_elo_title")}</h3>
        <p>{t("normes_3")}</p>
        <p>{t("normes_6")}</p>
      </section>
      <section>
        <h3>{t("normes_results_title")}</h3>
        <p>{t("normes_5")}</p>
      </section>
      <section>
        <h3>{t("normes_zones_title")}</h3>
        <p>{t("normes_zones_desc")}</p>
      </section>
      <section>
        <h3>{t("normes_trophies_title")}</h3>
        <p>{t("normes_trophies_desc", { first: SEASON_AWARD_BONUS.first, second: SEASON_AWARD_BONUS.second, third: SEASON_AWARD_BONUS.third })}</p>
      </section>
      <section>
        <h3>{t("normes_location_title")}</h3>
        <p>{t("normes_location")}</p>
      </section>
      <section>
        <h3>{t("normes_rights_title")}</h3>
        <p>{t("normes_rights_text")}</p>
      </section>
      <p className="copyright">{t("copyright")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin panels: player management, quota summary, reset stats, season
// ---------------------------------------------------------------------------
function AdminPanel({ admin, players, jornadas, onExit }) {
  const { t } = useLang();
  const [resetStep, setResetStep] = useState(0);

  if (admin.type === "venue") {
    const venue = VENUES[admin.venueKey];
    const pending = jornadas
      .filter((j) => j.venueKey === admin.venueKey && !j.isTest)
      .reduce((sum, j) => sum + (j.participants || []).filter((p) => !p.paid).length, 0);
    return (
      <div className="admin-panel">
        <p>{venue?.name}</p>
        <p>{pending} {t("inscrits_suffix")} pendents de pagament</p>
        <button onClick={onExit}>{t("admin_exit")}</button>
      </div>
    );
  }

  if (admin.type !== "master") {
    return (
      <div className="admin-panel">
        <button onClick={onExit}>{t("admin_exit")}</button>
      </div>
    );
  }

  const quotaByVenue = {};
  Object.entries(VENUES).forEach(([key, v]) => {
    quotaByVenue[key] = { name: v.name, total: 0 };
  });
  jornadas.forEach((j) => {
    if (j.isTest) return;
    const v = VENUES[j.venueKey];
    if (!v) return;
    const paidCount = (j.participants || []).filter((p) => p.paid).length;
    quotaByVenue[j.venueKey].total += paidCount * v.quotaClub;
  });

  const doReset = async () => {
    if (resetStep === 0) {
      if (!window.confirm(t("reset_stats_confirm", { n: players.length }))) return;
      setResetStep(1);
      return;
    }
    if (!window.confirm(t("reset_stats_confirm2"))) return;
    const batch = writeBatch(db);
    players.forEach((p) => {
      batch.update(doc(db, "players", p.id), {
        elo: ELO_START,
        peakElo: ELO_START,
        wins: 0,
        losses: 0,
        played: 0,
        earnedBadges: [],
        matchHistory: [],
        opponents: [],
        seasonAwards: [],
      });
    });
    try {
      await batch.commit();
      alert(t("reset_stats_done"));
    } catch {
      alert(t("reset_stats_error"));
    }
    setResetStep(0);
  };

  return (
    <div className="admin-panel master">
      <h3>{t("admin_active")}</h3>

      <div className="quota-panel">
        <h4>Quota per seu</h4>
        <ul>
          {Object.entries(quotaByVenue).map(([key, v]) => (
            <li key={key}>{v.name}: {v.total}€</li>
          ))}
        </ul>
      </div>

      <div className="pm-panel">
        <h4>{t("pm_title")}</h4>
        <p>{t("pm_desc", { n: players.length })}</p>
        <ul>
          {players.map((p) => (
            <PlayerManageRow key={p.id} player={p} />
          ))}
        </ul>
      </div>

      <div className="reset-stats-panel">
        <h4>{t("reset_stats_title")}</h4>
        <p>{t("reset_stats_desc")}</p>
        <button className="danger" onClick={doReset}>{t("reset_stats_btn")}</button>
      </div>

      <button onClick={onExit}>{t("admin_exit")}</button>
    </div>
  );
}

function PlayerManageRow({ player }) {
  const { t } = useLang();
  const [editingFed, setEditingFed] = useState(false);
  const [fedNum, setFedNum] = useState(player.federatNumber || "");

  const toggle = async () => {
    const action = player.active === false ? t("pm_confirm_reactivate") : t("pm_confirm_deactivate");
    if (!window.confirm(t("pm_confirm_q", { action, name: player.name, email: player.familyEmail }))) return;
    try {
      await updateDoc(doc(db, "players", player.id), { active: player.active === false });
    } catch {
      alert(t("pm_error"));
    }
  };

  const saveFederation = async () => {
    await updateDoc(doc(db, "players", player.id), {
      federatNumber: fedNum.trim() || null,
      federat: !!fedNum.trim(),
      federationRequestStatus: fedNum.trim() ? "confirmed" : player.federationRequestStatus || null,
    });
    setEditingFed(false);
  };

  return (
    <li>
      {player.name}
      {player.active === false && <span className="tag">{t("pm_off_tag")}</span>}
      {player.federationRequestStatus === "pending" && !player.federat && (
        <span className="tag pending-federation">{t("federation_pending_tag")}</span>
      )}
      <button onClick={toggle}>{player.active === false ? t("pm_reactivate") : t("pm_deactivate")}</button>
      {editingFed ? (
        <span className="fed-editor">
          <input
            value={fedNum}
            placeholder={t("reg_federat_ph")}
            onChange={(e) => setFedNum(e.target.value)}
          />
          <button onClick={saveFederation}>{t("save")}</button>
        </span>
      ) : (
        <button className="secondary small" onClick={() => setEditingFed(true)}>
          {player.federat ? `#${player.federatNumber}` : t("reg_federat_label")}
        </button>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Admin PIN entry (shown in Perfil tab or a small gear icon)
// ---------------------------------------------------------------------------
function AdminGate({ admin, setAdmin }) {
  const { t } = useLang();
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  if (admin) return null;

  const submit = () => {
    const resolved = resolvePin(pin);
    if (resolved) {
      setAdmin(resolved);
      setPin("");
      setError(false);
    } else {
      setError(true);
    }
  };

  return (
    <div className="admin-gate">
      <p>{t("admin_access")}</p>
      <input
        type="password"
        placeholder={t("admin_pin_ph")}
        value={pin}
        onChange={(e) => setPin(e.target.value)}
      />
      <button onClick={submit}>{t("admin_enter")}</button>
      {error && <p className="error">{t("admin_wrong_pin")}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------
function AppShell() {
  const { t } = useLang();
  const [player, setPlayer] = usePersistedPlayer();
  const [admin, setAdmin] = useAdminMode();
  const [tab, setTab] = useState("ranking");
  const { players, loading: playersLoading } = usePlayers();
  const { jornadas, loading: jornadasLoading, loadHistoric } = useJornadas();

  const liveePlayer = player ? players.find((p) => p.id === player.id) || player : null;

  if (playersLoading && jornadasLoading) {
    return <div className="loading-screen">{t("loading")}</div>;
  }

  if (!player && !admin) {
    return <LoginScreen onLogin={setPlayer} />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>{t("appName")}</h1>
        <span className="club-label">{t("club")}</span>
      </header>

      <nav className="tab-nav">
        <button className={tab === "ranking" ? "active" : ""} onClick={() => setTab("ranking")}>{t("tab_ranking")}</button>
        <button className={tab === "jornades" ? "active" : ""} onClick={() => setTab("jornades")}>{t("tab_jornades")}</button>
        {liveePlayer && (
          <button className={tab === "perfil" ? "active" : ""} onClick={() => setTab("perfil")}>{t("tab_perfil")}</button>
        )}
        <button className={tab === "normes" ? "active" : ""} onClick={() => setTab("normes")}>{t("tab_normes")}</button>
        <button className={tab === "admin" ? "active" : ""} onClick={() => setTab("admin")}>
          {admin ? t("admin") : "⚙️"}
        </button>
      </nav>

      <main className="tab-content">
        {tab === "ranking" && <RankingTab players={players} />}
        {tab === "jornades" && (
          <JornadesTab
            player={liveePlayer}
            players={players}
            jornadas={jornadas}
            loadHistoric={loadHistoric}
            admin={admin}
          />
        )}
        {tab === "perfil" && liveePlayer && (
          <PerfilTab player={liveePlayer} players={players} onLogout={() => setPlayer(null)} onUpdate={setPlayer} />
        )}
        {tab === "normes" && <NormesTab />}
        {tab === "admin" && (
          admin ? (
            <AdminPanel admin={admin} players={players} jornadas={jornadas} onExit={() => setAdmin(null)} />
          ) : (
            <AdminGate admin={admin} setAdmin={setAdmin} />
          )
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <LangProvider>
      <AppShell />
    </LangProvider>
  );
}
