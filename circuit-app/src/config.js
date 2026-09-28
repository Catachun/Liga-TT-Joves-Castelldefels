// Constants extracted/verified from the last production bundle.
export const MASTER_PIN = "011328";
export const MAX_PARTICIPANTS = 40;
export const MAX_WAITLIST = 5;
export const REFEREE_PIN = "1111"; // present in bundle, currently unused in UI
export const MAX_FAMILY_MEMBERS = 5;

export const VENUES = {
  joves: {
    name: "Institut Josep Lluís Sert (Joves)",
    pin: "1470",
    quotaClub: 0,
  },
  espronceda: {
    name: "Espronceda",
    pin: "3690",
    quotaClub: 2,
  },
};

export const JORNADA_PRICE = 7;

// Given a PIN, returns { type: 'master' } | { type: 'referee' } | { type: 'venue', venueKey } | null
export function resolvePin(pin) {
  if (pin === MASTER_PIN) return { type: "master" };
  if (pin === REFEREE_PIN) return { type: "referee" };
  for (const [key, v] of Object.entries(VENUES)) {
    if (pin === v.pin) return { type: "venue", venueKey: key };
  }
  return null;
}

// Room opening / competition start time based on day of week.
// Saturday -> 8:20 / 9:00 · Sunday (and default) -> 16:15 / 17:00
export function scheduleForDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0 = Sunday, 6 = Saturday
  if (day === 6) return { opening: "8:20", start: "9:00" };
  return { opening: "16:15", start: "17:00" };
}
