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
  runTransaction,
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
import { getFaq, FAQ_TITLE } from "./faq";
import { MASTER_PIN, MAX_PARTICIPANTS, MAX_WAITLIST, VENUES, JORNADA_PRICE, TABLES_AVAILABLE, AFI_LICENSE_PRICE, JOTFORM_FEDERATION_URL, resolvePin, scheduleForDate } from "./config";
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
  applyJornadaResults,
  recommendTournament,
  scheduleGroups,
  estimateMinutes,
  BADGE_ICONS,
  BADGE_POINTS,
  computeBadges,
  SEASON_AWARD_BONUS,
  computeSeasonReset,
} from "./elo";

// Badge keys in elo.js (first_win, six_hundred, clean_sweep, elite700) don't
// all match their i18n slug (badge_firstwin_*, badge_600_*, badge_cleansweep_*,
// badge_700_*) — this maps the internal key to the right translation suffix.
const BADGE_I18N_KEY = {
  first_win: "firstwin",
  six_hundred: "600",
  clean_sweep: "cleansweep",
  elite700: "700",
};
const badgeI18nKey = (key) => BADGE_I18N_KEY[key] || key;

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
  const fileInputRef = useRef(null);

  // We used to build a live in-app camera preview with getUserMedia, but
  // that path is unreliable on iOS Safari (autoplay/ref-timing quirks mean
  // the preview can end up blank with the camera indicator on and no way
  // out). The native camera picker via a file input with capture="user" is
  // far more robust across iOS and Android, so we go straight to that.
  const openCamera = () => {
    fileInputRef.current?.click();
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
        <img src={value} alt="selfie" className="selfie-preview" onClick={openCamera} />
      ) : (
        <button type="button" className="selfie-btn" onClick={openCamera}>
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

function pickNextJornada(jornadas) {
  const today = new Date().toISOString().slice(0, 10);
  return (jornadas || [])
    .filter((x) => x.status === "inscripcio" && !x.isTest && (x.date || "") >= today)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))[0];
}

function LoginScreen({ onLogin, jornadas }) {
  const { t, lang, setLang } = useLang();
  const [step, setStep] = useState("welcome"); // welcome -> email -> picker|new
  const [clubMember, setClubMember] = useState(false);
  const [joinNow, setJoinNow] = useState(true);
  const nextJ = pickNextJornada(jornadas);
  const nextJLocale = lang === "ca" ? "ca-ES" : lang === "es" ? "es-ES" : "en-GB";
  const nextJDate = nextJ ? new Date(nextJ.date + "T00:00:00").toLocaleDateString(nextJLocale, { weekday: "long", day: "numeric", month: "long" }) : "";
  const nextJSchedule = nextJ ? nextJ.schedule || scheduleForDate(nextJ.date) : null;
  const nextJVenue = nextJ ? VENUES[nextJ.venueKey] || VENUES.joves : null;
  const nextJFull = nextJ ? (nextJ.participants || []).length >= MAX_PARTICIPANTS : false;
  const canJoinNow = !!nextJ && !nextJ.isFinal && !nextJFull;
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
    if (selfie && !consent) {
      setError(t("err_consent_required"));
      return;
    }
    if (!noFederat && !clubMember && !federatNumber.trim()) {
      setError(t("err_federat_required"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      let selfieUrl = selfie || null;
      if (selfie) try {
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
        consent: !!selfie && consent,
        federatNumber: noFederat || clubMember ? null : federatNumber.trim(),
        federat: !noFederat && !clubMember,
        ...(clubMember && !noFederat ? { federationRequestStatus: "club" } : {}),
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
      if (joinNow && canJoinNow) {
        try {
          await updateDoc(doc(db, "jornadas", nextJ.id), {
            participants: arrayUnion({ playerId: docRef.id, confirmed: true, paid: false, joinedAt: Date.now() }),
          });
        } catch {
          // el perfil ja està creat; es podrà apuntar des de la jornada
        }
      }
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

      {step === "welcome" && (
        <div className="login-step welcome-card">
          <p className="welcome-what">{t("welcome_what")}</p>
          {nextJ && (
            <div className="welcome-jornada">
              <div className="welcome-date">{nextJDate}</div>
              <div className="welcome-meta">
                {t("next_jornada_open", { opening: nextJSchedule.opening, start: nextJSchedule.start })} · {nextJVenue.name}
              </div>
              <div className="welcome-meta">{t("welcome_price", { price: JORNADA_PRICE })}</div>
              <div className="welcome-spots">{t("next_jornada_spots", { n: (nextJ.participants || []).length, max: MAX_PARTICIPANTS })}</div>
            </div>
          )}
          <p className="hint">{t("welcome_steps")}</p>
          <button onClick={() => setStep("email")}>{nextJ && canJoinNow ? t("welcome_cta") : t("welcome_no_jornada_cta")}</button>
          <button className="secondary" onClick={() => setStep("email")}>{t("welcome_have_profile")}</button>
        </div>
      )}

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
                {(m.selfieUrl || m.photoURL) && <img src={m.selfieUrl || m.photoURL} alt={m.name} />}
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
              disabled={noFederat || clubMember}
              onChange={(e) => setFederatNumber(e.target.value)}
            />
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={noFederat}
                onChange={(e) => {
                  setNoFederat(e.target.checked);
                  if (e.target.checked) { setFederatNumber(""); setClubMember(false); }
                }}
              />
              {t("reg_no_federat")}
            </label>
            {!noFederat && (
              <>
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={clubMember}
                    onChange={(e) => {
                      setClubMember(e.target.checked);
                      if (e.target.checked) setFederatNumber("");
                    }}
                  />
                  {t("reg_club_member")}
                </label>
                {clubMember && <p className="hint small">{t("reg_club_member_hint")}</p>}
              </>
            )}
            {noFederat && (
              <div className="notify-banner">
                <p className="hint small">
                  {t("reg_federat_notice", { price: AFI_LICENSE_PRICE, jornadaPrice: JORNADA_PRICE })}
                </p>
                <a
                  className="smallbtn"
                  href={JOTFORM_FEDERATION_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("reg_federat_jotform_btn")}
                </a>
              </div>
            )}
          </div>

          <label className="checkbox-line">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            {t("login_consent")}
          </label>
          <p className="hint small">{t("login_consent_minor")}</p>
          {canJoinNow && (
            <label className="checkbox-line">
              <input type="checkbox" checked={joinNow} onChange={(e) => setJoinNow(e.target.checked)} />
              {t("join_with_profile", { date: nextJDate })}
            </label>
          )}
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
    if (filterHand && (p.hand || p.ma) !== filterHand) return false;
    if (filterStyle && (p.style || p.estil) !== filterStyle) return false;
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

      <div className="division-ladder">
        <h3>{t("ranking_ladder_title")}</h3>
        <p className="hint">{t("ranking_ladder_desc")}</p>
        {DIVISIONS.map((d, idx) => {
          const n = active.filter((p) => divisionFor(p.elo || ELO_START).key === d.key).length;
          const label = d.min === -Infinity ? `< ${DIVISIONS[idx - 1].min}` : `≥ ${d.min}`;
          return (
            <div key={d.key} className={`ladder-row ladder-${d.key}`}>
              <span className="ladder-icon">{d.icon}</span>
              <span className="ladder-name">{t(`division_${d.key}`)}</span>
              <span className="ladder-elo">{label}</span>
              <span className="ladder-count">{n} {t("ranking_ladder_players")}</span>
            </div>
          );
        })}
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
                {(p.selfieUrl || p.photoURL) && <img src={p.selfieUrl || p.photoURL} alt={p.name} className="avatar" />}
                <span className="name">{p.name}{p.nickname ? <span className="nick"> "{p.nickname}"</span> : null}</span>
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
  const [isFinal, setIsFinal] = useState(false);

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
      isFinal,
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
    setIsFinal(false);
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
            <label className="checkbox-line">
              <input type="checkbox" checked={isFinal} onChange={(e) => setIsFinal(e.target.checked)} />
              {t("jornada_final_label")}
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
                {j.name}{j.isTest ? t("tag_test") : ""}{j.isFinal ? t("tag_final") : ""}
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
  const rec = recommendTournament((jornada.participants || []).length);
  const [bestOfSel, setBestOfSel] = useState(null); // null = follow the recommendation
  const [groupsSel, setGroupsSel] = useState(null);
  const bestOfChosen = bestOfSel ?? rec.bestOf;
  const groupsChosen = groupsSel ?? rec.numGroups;

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
    if (!window.confirm(`Format: ${format === "suis" ? "Sistema suís" : format === "nivellats" ? "Grups nivellats" : `${groupsChosen} grup(s) + Quadre Or/Plata`}\nPartits al millor de ${bestOfChosen} sets\n\nConfirmes? (després no es pot tornar enrere)`)) return;
    setBusy(true);
    const jref = doc(db, "jornadas", jornada.id);
    const ids = participants.map((p) => p.playerId);
    const ratings = {};
    ids.forEach((id) => (ratings[id] = playerById(id)?.elo || ELO_START));

    if (format === "grups" || format === "nivellats") {
      const groups = makeGroups(ids, ratings, groupsChosen);
      const groupsData = groups.map((g, i) => ({
        id: `g${i}`,
        players: g,
        matches: roundRobin(g),
      }));
      scheduleGroups(groupsData, TABLES_AVAILABLE);
      await updateDoc(jref, {
        format,
        bestOf: bestOfChosen,
        status: format === "nivellats" ? "grups_r1" : "grups",
        groups: groupsData,
      });
    } else if (format === "suis") {
      const round1 = generateSwissRound(ids, ratings, []);
      await updateDoc(jref, {
        format: "suis",
        bestOf: bestOfChosen,
        status: "suis",
        swissRounds: [{ round: 1, matches: round1 }],
      });
    }
    setBusy(false);
  };

  // s1 == null clears the result (admin correction).
  const saveMatchResult = async (field, groupId, matchId, s1, s2, sets) => {
    const jref = doc(db, "jornadas", jornada.id);
    const patch = (m) => (m.id === matchId
      ? (s1 == null ? { ...m, s1: null, s2: null, sets: [], done: false } : { ...m, s1, s2, sets: sets || [], done: true })
      : m);
    // transaction: re-read the latest data right before writing so simultaneous results
    // coming from several phones never overwrite each other
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(jref);
      const list = [...((snap.data() || {})[field] || [])];
      const gIdx = groupId == null
        ? list.findIndex((g) => (g.matches || []).some((m) => m.id === matchId))
        : list.findIndex((g) => g.id === groupId);
      if (gIdx === -1) return;
      list[gIdx] = { ...list[gIdx], matches: list[gIdx].matches.map(patch) };
      tx.update(jref, { [field]: list });
    });
  };

  const rescheduleGroups = async () => {
    const field = jornada.status === "grups_r2" ? "groupsR2" : "groups";
    const groups = JSON.parse(JSON.stringify(jornada[field] || []));
    // only the matches still to play are re-planned; played ones keep their result
    scheduleGroups(groups.map((g) => ({ ...g, matches: g.matches.filter((m) => !m.done) })), TABLES_AVAILABLE);
    await updateDoc(doc(db, "jornadas", jornada.id), { [field]: groups });
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
    scheduleGroups(groupsR2, TABLES_AVAILABLE);
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
    // The better half of every group goes to Gold (2 of 4, 3 of 5-6, 4 of 7),
    // seeded by finishing position so group winners are kept apart.
    const gold = [];
    const silver = [];
    const maxLen = Math.max(0, ...standingsByGroup.map((s) => s.length));
    for (let r = 0; r < maxLen; r++) {
      standingsByGroup.forEach((s) => {
        if (r >= s.length) return;
        (r < Math.ceil(s.length / 2) ? gold : silver).push(s[r].playerId);
      });
    }
    await updateDoc(doc(db, "jornadas", jornada.id), {
      status: "eliminatories",
      bracketGold: buildBracket(gold),
      bracketSilver: buildBracket(silver) || null,
    });
  };

  const closeJornada = async () => {
    if (!window.confirm(t("confirm_close_jornada"))) return;
    if (jornada.status === "tancada") return;
    setBusy(true);
    try {
      const podium = computePodium(jornada) || null;
      const batch = writeBatch(db);
      let mvp = null, mvpGain = 0;
      if (!jornada.isTest) {
        const res = applyJornadaResults(jornada, players);
        mvp = res.mvp; mvpGain = res.mvpGain;
        Object.entries(res.updates).forEach(([id, fields]) => {
          batch.update(doc(db, "players", id), fields);
        });
      }
      const jUpdate = { status: "tancada", closedAt: serverTimestamp() };
      if (!jornada.isTest) {
        jUpdate.podium = { ...(podium || {}), ...(mvp ? { mvp, mvpGain } : {}) };
      }
      batch.update(doc(db, "jornadas", jornada.id), jUpdate);
      await batch.commit();
    } catch (e) {
      alert("No s'ha pogut tancar la jornada: " + (e?.message || e));
    }
    setBusy(false);
  };

  const finalQualifiedIds = jornada.isFinal
    ? players
        .filter((p) => p.active !== false)
        .sort((a, b) => (b.elo || ELO_START) - (a.elo || ELO_START))
        .slice(0, MAX_PARTICIPANTS)
        .map((p) => p.id)
    : [];
  const finalQualified = !jornada.isFinal || (player && finalQualifiedIds.includes(player.id));

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
      <h2>{jornada.name}{jornada.isTest ? t("tag_test") : ""}{jornada.isFinal ? t("tag_final") : ""}</h2>
      <p className="jornada-meta">
        {jornada.date} · {venue.name} · {t("schedule_opening")}: {schedule.opening} · {t("schedule_start")}: {schedule.start}
      </p>
      <p className="jornada-status-label">{t(`status_${jornada.status}`) || jornada.status}</p>
      {jornada.bestOf && jornada.status !== "inscripcio" && (
        <p className="hint small">
          Partits al millor de {jornada.bestOf} sets
          {(admin?.type === "master" || admin?.type === "venue") && jornada.status !== "tancada" && (
            <>
              {" · "}
              <button className="secondary small" onClick={() => updateDoc(doc(db, "jornadas", jornada.id), { bestOf: jornada.bestOf === 5 ? 3 : 5 })}>
                Canviar a {jornada.bestOf === 5 ? 3 : 5} sets
              </button>
            </>
          )}
        </p>
      )}

      {jornada.status === "inscripcio" && (
        <div className="registration-box">
          <p>{participants.length} / {MAX_PARTICIPANTS} {t("players_count_suffix")}</p>
          {player && (
            isParticipant ? (
              <button disabled={busy} className="danger" onClick={leave}>{t("leave_btn")}</button>
            ) : isWaitlisted ? (
              <p className="hint">{t("you_are_waitlisted")}</p>
            ) : jornada.isFinal && !finalQualified ? (
              <p className="hint">{t("final_not_qualified", { n: MAX_PARTICIPANTS })}</p>
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

          {(admin?.type === "master" || admin?.type === "venue") && participants.length >= 3 && (
            <div className="start-tournament-box">
              <h4>{t("start_tournament_title")}</h4>
              <p>{t("choose_format", { n: participants.length })}</p>
              <p className="hint">
                Recomanat per a {participants.length} jugadors: {rec.numGroups} grup{rec.numGroups > 1 ? "s" : ""} + Quadre Or/Plata, partits al millor de {rec.bestOf} sets.
              </p>
              <label className="tourney-opt">
                Partits al millor de
                <select value={bestOfChosen} onChange={(e) => setBestOfSel(Number(e.target.value))}>
                  <option value={3}>3 sets (més ràpid)</option>
                  <option value={5}>5 sets</option>
                </select>
              </label>
              <label className="tourney-opt">
                Nombre de grups
                <select value={groupsChosen} onChange={(e) => setGroupsSel(Number(e.target.value))}>
                  {Array.from({ length: Math.max(1, Math.min(10, Math.floor(participants.length / 2))) }, (_, i) => i + 1).map((g) => (
                    <option key={g} value={g}>{g}{g === rec.numGroups ? " (recomanat)" : ""}</option>
                  ))}
                </select>
              </label>
              <p className="hint">
                Durada estimada (grups + quadres, {TABLES_AVAILABLE} taules): ~{Math.floor(estimateMinutes(participants.length, groupsChosen, bestOfChosen, TABLES_AVAILABLE) / 60)} h {estimateMinutes(participants.length, groupsChosen, bestOfChosen, TABLES_AVAILABLE) % 60} min
              </p>
              <button onClick={() => startTournament("grups")}>{t("format_grups")}</button>
              <button onClick={() => startTournament("suis")}>{t("format_suis")}</button>
              <button onClick={() => startTournament("nivellats")}>{t("format_nivellats")}</button>
            </div>
          )}
        </div>
      )}

      {(jornada.status === "grups" || jornada.status === "grups_r1" || jornada.status === "grups_r2") && (admin?.type === "master" || admin?.type === "venue") && (
        <p className="hint small">
          <button className="secondary small" onClick={() => window.confirm("Reajustar torns, taules i àrbitres dels partits pendents? Els resultats no es toquen.") && rescheduleGroups()}>
            🔄 Reajustar calendari ({TABLES_AVAILABLE} taules)
          </button>
        </p>
      )}
      {(jornada.status === "grups" || jornada.status === "grups_r1" || jornada.status === "grups_r2") && (
        <GroupsView
          jornada={jornada}
          field={jornada.status === "grups_r2" ? "groupsR2" : "groups"}
          players={players}
          admin={admin}
          player={player}
          bestOf={jornada.bestOf || 5}
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
        <SwissView jornada={jornada} players={players} admin={admin} player={player} bestOf={jornada.bestOf || 5} onSaveResult={saveMatchResult} onClose={closeJornada} />
      )}

      {jornada.status === "eliminatories" && (
        <BracketsView jornada={jornada} players={players} admin={admin} player={player} bestOf={jornada.bestOf || 5} onSaveResult={saveMatchResult} onClose={closeJornada} />
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

function GroupsView({ jornada, field, players, admin, player, bestOf, onSaveResult, onNextStep, nextStepLabel, onCloseNoBrackets }) {
  const { t } = useLang();
  const groups = jornada[field] || [];
  const playerById = (id) => players.find((p) => p.id === id);
  const staff = admin?.type === "master" || admin?.type === "venue" || admin?.type === "referee";
  const mine = (m) => !!player && (m.p1 === player.id || m.p2 === player.id);
  const allComplete = groups.every((g) => groupComplete(g));
  const turnsTotal = Math.max(0, ...groups.flatMap((g) => g.matches.map((m) => m.turn || 0)));

  return (
    <div className="groups-view">
      {turnsTotal > 0 && <p className="hint small">T = torn, M = mesa ({TABLES_AVAILABLE} mesas, {turnsTotal} torns en total). Els partits d'un mateix torn es juguen a la vegada.</p>}
      {groups.map((g, gi) => {
        const standings = groupStandings(g);
        return (
          <div key={g.id} className="group-card">
            <h4>{field === "groupsR2" ? `Nivell ${gi + 1}` : `Grup ${String.fromCharCode(65 + gi)}`}</h4>
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
              {[...g.matches].sort((x, y) => (x.turn || 0) - (y.turn || 0) || (x.table || 0) - (y.table || 0)).map((m) => (
                <MatchRow
                  key={m.id}
                  match={m}
                  p1={playerById(m.p1)}
                  p2={playerById(m.p2)}
                  referee={m.refereeId ? playerById(m.refereeId) : null}
                  canEdit={staff || mine(m) || (!!player && m.refereeId === player.id)}
                  canFix={staff}
                  mine={mine(m)}
                  turn={m.turn}
                  table={m.table}
                  bestOf={bestOf}
                  confirmEntry={!staff}
                  onSave={(s1, s2, sets) => onSaveResult(field, g.id, m.id, s1, s2, sets)}
                  onReset={() => onSaveResult(field, g.id, m.id, null, null)}
                />
              ))}
            </ul>
          </div>
        );
      })}
      {staff && allComplete && onNextStep && (
        <button onClick={onNextStep}>{nextStepLabel}</button>
      )}
      {staff && allComplete && onCloseNoBrackets && (
        <button onClick={onCloseNoBrackets}>{t("close_no_brackets")}</button>
      )}
    </div>
  );
}

function SwissView({ jornada, players, admin, player, bestOf, onSaveResult, onClose }) {
  const { t } = useLang();
  const rounds = jornada.swissRounds || [];
  const playerById = (id) => players.find((p) => p.id === id);
  const staff = admin?.type === "master" || admin?.type === "venue" || admin?.type === "referee";
  const mine = (m) => !!player && (m.p1 === player.id || m.p2 === player.id);
  const last = rounds[rounds.length - 1];
  const lastComplete = last ? last.matches.every((m) => m.done || m.bye) : false;

  const nextRound = async () => {
    const ratings = {};
    players.forEach((p) => (ratings[p.id] = p.elo || ELO_START));
    // pairing score: wins in this jornada first, ELO as tie-break
    const winsIn = {};
    rounds.forEach((r) => r.matches.forEach((m) => {
      if (m.bye && m.p1) winsIn[m.p1] = (winsIn[m.p1] || 0) + 1;
      else if (m.done && m.s1 != null && m.s2 != null && m.s1 !== m.s2) {
        const w = m.s1 > m.s2 ? m.p1 : m.p2;
        winsIn[w] = (winsIn[w] || 0) + 1;
      }
    }));
    Object.keys(ratings).forEach((id) => { ratings[id] = (winsIn[id] || 0) * 100000 + ratings[id]; });
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
                canEdit={staff || mine(m)}
                canFix={staff}
                mine={mine(m)}
                bestOf={bestOf}
                confirmEntry={!staff}
                onSave={(s1, s2, sets) => onSaveResult("swissRounds", null, m.id, s1, s2, sets)}
                onReset={() => onSaveResult("swissRounds", null, m.id, null, null)}
              />
            ))}
          </ul>
        </div>
      ))}
      {staff && lastComplete && (
        <>
          <button onClick={nextRound}>{t("next_round")}</button>
          <button onClick={onClose}>{t("close_jornada")}</button>
        </>
      )}
    </div>
  );
}

function BracketsView({ jornada, players, admin, player, bestOf, onSaveResult, onClose }) {
  const { t } = useLang();
  const playerById = (id) => players.find((p) => p.id === id);
  const staff = admin?.type === "master" || admin?.type === "venue" || admin?.type === "referee";
  const mine = (m) => !!player && (m.p1 === player.id || m.p2 === player.id);

  const saveBracketMatch = async (bracketKey, matchId, s1, s2, sets) => {
    try {
      const jref = doc(db, "jornadas", jornada.id);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(jref);
        const bracket = propagateBracket((snap.data() || {})[bracketKey], matchId, s1, s2, sets);
        tx.update(jref, { [bracketKey]: bracket });
      });
    } catch (e) {
      alert(e?.message === "downstream_done"
        ? "No es pot canviar: el partit següent ja s'ha jugat. Corregeix primer aquell."
        : "No s'ha pogut desar el resultat.");
    }
  };

  const renderBracket = (bracket, key, title) => {
    if (!bracket) return null;
    const rounds = bracket.rounds || [];
    return (
      <div className="bracket-card">
        <h4>{title}</h4>
        {rounds.map((round, ri) => (
          <div key={ri} className="bracket-round">
            <h5>{bracketRoundName(rounds.length, ri, t)}</h5>
            {round.matches.map((m) => (
              <div key={m.id} className="bracket-match">
                <span>{m.p1 ? playerById(m.p1)?.name : m.bye ? t("bye_label") : "?"}</span>
                <span>{m.s1 ?? ""} - {m.s2 ?? ""}{(m.sets || []).length > 0 && <small className="set-detail"> ({m.sets.map((x) => `${x.a}-${x.b}`).join(", ")})</small>}</span>
                <span>{m.p2 ? playerById(m.p2)?.name : m.bye ? t("bye_label") : "?"}</span>
                {m.p1 && m.p2 && !m.done && (staff || mine(m)) && (
                  <ResultEditor
                    names={[playerById(m.p1)?.name, playerById(m.p2)?.name]}
                    bestOf={bestOf}
                    confirmEntry={!staff}
                    onSave={(s1, s2, sets) => saveBracketMatch(key, m.id, s1, s2, sets)}
                  />
                )}
                {staff && m.done && !m.bye && (
                  <button className="secondary small" onClick={() => saveBracketMatch(key, m.id, null, null)}>Corregir</button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  const bracketDone = (b) => !b || b.rounds.every((r) => r.matches.every((m) => m.done || m.bye));
  const bothDone = !!jornada.bracketGold && bracketDone(jornada.bracketGold) && bracketDone(jornada.bracketSilver);

  return (
    <div className="brackets-view">
      {renderBracket(jornada.bracketGold, "bracketGold", t("quadre_or"))}
      {renderBracket(jornada.bracketSilver, "bracketSilver", t("quadre_plata"))}
      {staff && bothDone && <button onClick={onClose}>{t("close_jornada")}</button>}
    </div>
  );
}

function MatchRow({ match, p1, p2, referee, canEdit, canFix, mine, turn, table, bestOf, confirmEntry, onSave, onReset }) {
  const { t } = useLang();
  if (match.bye) {
    return <li className="match-row bye">{p1?.name || p2?.name} — {t("bye_win")}</li>;
  }
  const editing = !match.done && canEdit;
  return (
    <li className={"match-row" + (mine ? " mine" : "") + (editing ? " editing" : "") + (referee ? " has-ref" : "")}>
      {turn ? <span className="rnd">T{turn} · M{table}</span> : match.round ? <span className="rnd">R{match.round}</span> : null}
      <span>{p1?.name}</span>
      {match.done ? (
        <span className="result">
          {match.s1} - {match.s2}
          {(match.sets || []).length > 0 && (
            <small className="set-detail"> ({match.sets.map((x) => `${x.a}-${x.b}`).join(", ")})</small>
          )}
          {canFix && onReset && (
            <button className="secondary small" onClick={onReset}>Corregir</button>
          )}
        </span>
      ) : (
        <span className="result pending">vs</span>
      )}
      <span>{p2?.name}</span>
      {referee && !match.done && <small className="ref">⚖️ Àrbitre: {referee.name}</small>}
      {editing && (
        <ResultEditor names={[p1?.name, p2?.name]} bestOf={bestOf} confirmEntry={confirmEntry} onSave={onSave} />
      )}
    </li>
  );
}

// Table tennis set: first to 11 with a 2-point lead (so 12-10, 13-11 ... if it goes past 10-10).
function validSet(a, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a === b) return false;
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return hi >= 11 && (hi === 11 ? lo <= 9 : hi - lo === 2);
}

// Match = best of 5 sets. Enter the points of every set (e.g. 11-9); sets won are derived.
function ResultEditor({ onSave, names, confirmEntry, bestOf = 5 }) {
  const need = Math.ceil(bestOf / 2);
  const { t } = useLang();
  const [rows, setRows] = useState(() => Array.from({ length: bestOf }, () => ({ a: "", b: "" })));
  const refs = useRef([]);
  const [status, setStatus] = useState("idle");
  const num = (v) => (v === "" ? NaN : Number(v));
  let w1 = 0, w2 = 0, shown = 0;
  for (let i = 0; i < bestOf; i++) {
    shown = i + 1;
    const a = num(rows[i].a), b = num(rows[i].b);
    if (!validSet(a, b)) break;
    if (a > b) w1++; else w2++;
    if (w1 === need || w2 === need) break;
  }
  const over = w1 === need || w2 === need;
  const setRow = (i, k, v) => {
    const clean = v.replace(/[^0-9]/g, "").slice(0, 2);
    setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: clean } : x)));
    if (clean.length === 2) {
      const next = k === "a" ? refs.current[i * 2 + 1] : refs.current[(i + 1) * 2];
      next?.focus();
    }
  };
  const submit = () => {
    if (!over) { alert(`Introdueix els punts de cada set fins que algú guanyi ${need} sets (cada set: 11 punts amb 2 de diferència).`); return; }
    const sets = rows.slice(0, shown).map((x) => ({ a: Number(x.a), b: Number(x.b) }));
    const detail = sets.map((x) => `${x.a}-${x.b}`).join(", ");
    if (confirmEntry && !window.confirm(`${names?.[0] || ""} ${w1} - ${w2} ${names?.[1] || ""}\n(${detail})\n\nConfirmes el resultat?`)) return;
    setStatus("saving");
    (async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        try { await onSave(w1, w2, sets); return; } catch (e) {
          if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
      setStatus("error");
    })();
  };
  return (
    <div className="result-editor">
      {rows.slice(0, shown).map((r, i) => {
        const ok = validSet(num(r.a), num(r.b));
        return (
          <div key={i} className={"set-row" + (ok ? " ok" : "")}>
            <span className="set-label">Set {i + 1}</span>
            <input ref={(el) => (refs.current[i * 2] = el)} type="text" inputMode="numeric" pattern="[0-9]*" enterKeyHint="next" placeholder="0" value={r.a} onChange={(e) => setRow(i, "a", e.target.value)} />
            <span>-</span>
            <input ref={(el) => (refs.current[i * 2 + 1] = el)} type="text" inputMode="numeric" pattern="[0-9]*" enterKeyHint="next" placeholder="0" value={r.b} onChange={(e) => setRow(i, "b", e.target.value)} />
          </div>
        );
      })}
      <div className="set-footer">
        <span className="set-total">{w1} - {w2}</span>
        <button disabled={!over || status === "saving"} onClick={submit}>{status === "saving" ? "Desant…" : t("save")}</button>
      </div>
      {status === "saving" && <p className="hint small">Desant el resultat… no tanquis l'app.</p>}
      {status === "error" && <p className="hint small" style={{ color: "#c0392b", fontWeight: 700 }}>⚠️ No s'ha pogut desar (revisa la connexió). Torna a prémer «Desar»; el resultat continua escrit.</p>}
    </div>
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
// Downscale a photo to max 512px (JPEG) so it stays small in Firestore/Storage.
function resizeImage(file, max = 512) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    img.src = url;
  });
}

function PerfilTab({ player, players, onLogout, onUpdate }) {
  const { t } = useLang();
  const photoInput = useRef(null);
  const [savingPhoto, setSavingPhoto] = useState(false);

  const changePhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!player.consent && !window.confirm(t("login_consent") + "\n\n" + t("login_consent_minor"))) return;
    setSavingPhoto(true);
    try {
      const dataUrl = await resizeImage(file);
      let selfieUrl = dataUrl;
      try {
        const sref = ref(storage, `selfies/${uid()}.jpg`);
        await uploadString(sref, dataUrl, "data_url");
        selfieUrl = await getDownloadURL(sref);
      } catch {
        // keep the (small) data URL inline if storage upload fails
      }
      await updateDoc(doc(db, "players", player.id), { selfieUrl, consent: true });
      onUpdate({ ...player, selfieUrl, consent: true });
    } catch {
      alert(t("err_photo"));
    }
    setSavingPhoto(false);
  };
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(player.name);
  const [club, setClub] = useState(player.club || "");
  const [hand, setHand] = useState(player.hand || player.ma || "dreta");
  const [style, setStyle] = useState(player.style || player.estil || "allround");
  const [nickname, setNickname] = useState(player.nickname || "");

  const div = divisionFor(player.elo || ELO_START);
  const badges = player.earnedBadges || [];

  const saveInfo = async () => {
    try {
      const nick = nickname.replace(/["“”]/g, "").trim().slice(0, 20);
      setNickname(nick);
      await updateDoc(doc(db, "players", player.id), { club, hand, style, nickname: nick });
      onUpdate({ ...player, club, hand, style, nickname: nick });
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
        {(player.selfieUrl || player.photoURL) ? (
          <img src={player.selfieUrl || player.photoURL} alt={player.name} className="perfil-avatar" onClick={() => photoInput.current?.click()} />
        ) : (
          <div className="perfil-avatar perfil-avatar-empty" onClick={() => photoInput.current?.click()}>{(player.name || "?").slice(0, 1).toUpperCase()}</div>
        )}
        <input ref={photoInput} type="file" accept="image/*" style={{ display: "none" }} onChange={changePhoto} />
        <button className="secondary small photo-btn" disabled={savingPhoto} onClick={() => photoInput.current?.click()}>
          📷 {savingPhoto ? t("photo_saving") : (player.selfieUrl || player.photoURL) ? t("photo_change") : t("photo_add")}
        </button>
        {editingName ? (
          <span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <button onClick={saveName}>{t("save")}</button>
          </span>
        ) : (
          <h2 onClick={() => setEditingName(true)}>{player.name}{player.nickname ? <span className="nick"> "{player.nickname}"</span> : null}</h2>
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
        <label>{t("playerinfo_nick")}</label>
        <input value={nickname} maxLength={20} placeholder={t("playerinfo_nick_ph")} onChange={(e) => setNickname(e.target.value)} />
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
            const i18nKey = badgeI18nKey(key);
            return (
              <div key={key} className={`badge ${earned ? "earned" : "locked"}`} title={t(`badge_${i18nKey}_desc`)}>
                <span className="badge-icon">{BADGE_ICONS[key]}</span>
                <span className="badge-name">{t(`badge_${i18nKey}_name`)}</span>
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
  const { t, lang } = useLang();
  return (
    <div className="normes-tab">
      <h2>{t("normes_title")}</h2>
      <section>
        <h3>{FAQ_TITLE[lang] || FAQ_TITLE.ca}</h3>
        {getFaq(lang, { jornada: JORNADA_PRICE, afi: AFI_LICENSE_PRICE, max: MAX_PARTICIPANTS, wait: MAX_WAITLIST }).map(([q, a], i) => (
          <details key={i} className="faq-item">
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>
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
        <h3>{t("normes_finals_title")}</h3>
        <p>{t("normes_finals_desc")}</p>
      </section>
      <section>
        <h3>{t("normes_zones_title")}</h3>
        <p>{t("normes_zones_desc")}</p>
      </section>
      <section>
        <h3>{t("normes_trophies_title")}</h3>
        <p>{t("normes_trophies_desc", { first: SEASON_AWARD_BONUS[1], second: SEASON_AWARD_BONUS[2], third: SEASON_AWARD_BONUS[3] })}</p>
      </section>
      <section className="badges-ref-card">
        <h3>{t("badges_ref_title")}</h3>
        <p>{t("badges_ref_desc")}</p>
        <ul className="badges-ref-list">
          {Object.keys(BADGE_ICONS).map((key) => {
            const i18nKey = badgeI18nKey(key);
            return (
              <li key={key}>
                <span className="badges-ref-icon">{BADGE_ICONS[key]}</span>
                <span className="badges-ref-text">
                  <span className="badges-ref-name">{t(`badge_${i18nKey}_name`)}</span>
                  <br />
                  {t(`badge_${i18nKey}_desc`)}
                </span>
                <span className="badges-ref-points">+{BADGE_POINTS[key]}</span>
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <h3>{t("normes_location_title")}</h3>
        <p>{t("normes_location")}</p>
      </section>
      <section>
        <h3>{t("normes_rights_title")}</h3>
        <p>{t("normes_rights_text")}</p>
        <p>
          <a className="smallbtn" href="/privacitat.html" target="_blank" rel="noreferrer">
            {t("privacy_policy_link")}
          </a>
        </p>
      </section>
      <p className="copyright">{t("copyright")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin panels: player management, quota summary, reset stats, season
// ---------------------------------------------------------------------------

function EmailsPanel({ players, jornadas }) {
  const [onlyPending, setOnlyPending] = useState(true);
  const [msg, setMsg] = useState("");
  const [shown, setShown] = useState("");
  const nextJ = pickNextJornada(jornadas);
  const joined = new Set([...(nextJ?.participants || []), ...(nextJ?.waitlist || [])].map((p) => p.playerId));
  const list = players.filter((p) => p.active !== false && p.familyEmail && (!onlyPending || !nextJ || !joined.has(p.id)));
  const emails = [...new Set(list.map((p) => p.familyEmail.trim().toLowerCase()))];
  const text = emails.join(", ");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(emails.length + " emails copiats. Enganxa'ls al camp CCO (còpia oculta) del correu.");
      setShown("");
    } catch {
      setMsg("No s'ha pogut copiar automàticament: selecciona i copia el text de sota.");
      setShown(text);
    }
  };
  return (
    <div className="quota-panel">
      <h4>Emails de les famílies</h4>
      <label className="checkbox-line">
        <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
        Només els que encara no estan apuntats a la propera jornada
      </label>
      <p className="hint small">{emails.length} emails ({list.length} perfils)</p>
      <button className="secondary small" disabled={!emails.length} onClick={copy}>Copiar emails</button>
      <p className="hint small">Posa'ls sempre a CCO (còpia oculta) perquè no es vegin entre ells.</p>
      {msg && <p className="hint small">{msg}</p>}
      {shown && <textarea readOnly value={shown} rows={4} style={{ width: "100%" }} onFocus={(e) => e.target.select()} />}
    </div>
  );
}

function AdminPanel({ admin, players, jornadas, onExit, onImpersonate }) {
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

      <EmailsPanel players={players} jornadas={jornadas} />

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
            <PlayerManageRow key={p.id} player={p} onImpersonate={onImpersonate} />
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

function PlayerManageRow({ player, onImpersonate }) {
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

  const deletePlayer = async () => {
    if (!window.confirm(t("pm_confirm_delete", { name: player.name, email: player.familyEmail }))) return;
    if (!window.confirm(t("pm_confirm_delete2"))) return;
    try {
      await deleteDoc(doc(db, "players", player.id));
    } catch {
      alert(t("pm_delete_error"));
    }
  };

  return (
    <li>
      {player.name}
      {player.active === false && <span className="tag">{t("pm_off_tag")}</span>}
      {player.federationRequestStatus === "pending" && !player.federat && (
        <span className="tag pending-federation">{t("federation_pending_tag")}</span>
      )}
      {player.federationRequestStatus === "club" && !player.federat && (
        <span className="tag pending-federation">{t("club_license_tag")}</span>
      )}
      {onImpersonate && (
        <button className="secondary small" onClick={() => onImpersonate(player)}>Entrar com a</button>
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
      <button className="danger small" onClick={deletePlayer}>
        {t("pm_delete")}
      </button>
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
// Next-jornada banner: always-visible sign-up shortcut shown above every tab
// ---------------------------------------------------------------------------
function NextJornadaBanner({ player, players, jornadas, onOpen }) {
  const { t, lang } = useLang();
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const j = (jornadas || [])
    .filter((x) => x.status === "inscripcio" && !x.isTest && (x.date || "") >= today)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))[0];
  if (!j || !player) return null;

  const participants = j.participants || [];
  const waitlist = j.waitlist || [];
  const isIn = participants.some((p) => p.playerId === player.id);
  const isWait = waitlist.some((p) => p.playerId === player.id);
  const full = participants.length >= MAX_PARTICIPANTS;
  const schedule = j.schedule || scheduleForDate(j.date);
  const locale = lang === "ca" ? "ca-ES" : lang === "es" ? "es-ES" : "en-GB";
  const dateTxt = new Date(j.date + "T00:00:00").toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
  const qualified = !j.isFinal || (players || [])
    .filter((p) => p.active !== false)
    .sort((a, b) => (b.elo || ELO_START) - (a.elo || ELO_START))
    .slice(0, MAX_PARTICIPANTS)
    .some((p) => p.id === player.id);

  const join = async () => {
    setBusy(true);
    try {
      const jref = doc(db, "jornadas", j.id);
      if (full) {
        if (waitlist.length >= MAX_WAITLIST) {
          alert(t("jornada_full"));
        } else {
          await updateDoc(jref, { waitlist: arrayUnion({ playerId: player.id, joinedAt: Date.now() }) });
          alert(t("added_to_waitlist", { pos: waitlist.length + 1 }));
        }
      } else {
        await updateDoc(jref, {
          participants: arrayUnion({ playerId: player.id, confirmed: true, paid: false, joinedAt: Date.now() }),
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="next-banner">
      <div className="next-banner-top">
        <span className="next-banner-title">{t("next_jornada_title")}{j.isFinal ? t("tag_final") : ""}</span>
        <span className="next-banner-spots">{t("next_jornada_spots", { n: participants.length, max: MAX_PARTICIPANTS })}</span>
      </div>
      <div className="next-banner-date">{dateTxt}</div>
      <div className="next-banner-meta">
        {t("next_jornada_open", { opening: schedule.opening, start: schedule.start })}
      </div>
      {isIn ? (
        <p className="next-banner-ok">{t("next_jornada_joined")}</p>
      ) : isWait ? (
        <p className="next-banner-ok">{t("next_jornada_waitlisted")}</p>
      ) : !qualified ? (
        <p className="next-banner-ok">{t("final_not_qualified", { n: MAX_PARTICIPANTS })}</p>
      ) : (
        <button className="next-banner-btn" disabled={busy} onClick={join}>
          {full ? t("next_jornada_join_wait") : t("next_jornada_join", { price: JORNADA_PRICE })}
        </button>
      )}
      <button className="next-banner-link" onClick={onOpen}>{t("next_jornada_see")} ›</button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------
function AppShell() {
  const { t } = useLang();
  const [player, setPlayer] = usePersistedPlayer();
  const [admin, setAdmin] = useAdminMode();
  const [tab, setTab] = useState(() => {
    // Supports PWA shortcuts (manifest.json) that deep-link to a tab, e.g. /?tab=jornades
    const requested = new URLSearchParams(window.location.search).get("tab");
    return ["ranking", "jornades", "perfil", "normes", "admin"].includes(requested) ? requested : "ranking";
  });
  const { players, loading: playersLoading } = usePlayers();
  const { jornadas, loading: jornadasLoading, loadHistoric } = useJornadas();

  const liveePlayer = player ? players.find((p) => p.id === player.id) || player : null;

  if (playersLoading && jornadasLoading) {
    return <div className="loading-screen">{t("loading")}</div>;
  }

  if (!player && !admin) {
    return <LoginScreen onLogin={setPlayer} jornadas={jornadas} />;
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
        {liveePlayer && tab !== "admin" && (
          <NextJornadaBanner player={liveePlayer} players={players} jornadas={jornadas} onOpen={() => setTab("jornades")} />
        )}
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
            <AdminPanel admin={admin} players={players} jornadas={jornadas} onExit={() => setAdmin(null)} onImpersonate={(p) => { setPlayer(p); setTab("jornades"); }} />
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
