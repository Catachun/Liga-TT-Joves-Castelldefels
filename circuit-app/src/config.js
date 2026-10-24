// Constants extracted/verified from the last production bundle.
// Organiser PINs are NOT stored here: they are checked server-side by
// netlify/functions/check-pin.js (see ADMIN_PIN_* environment variables).
export const MAX_PARTICIPANTS = 40;
export const MAX_WAITLIST = 5;
export const MAX_FAMILY_MEMBERS = 5;

export const VENUES = {
  joves: {
    name: "Institut Josep Lluís Sert (Joves)",
    quotaClub: 0,
  },
  espronceda: {
    name: "Espronceda",
    quotaClub: 2,
  },
};

export const JORNADA_PRICE = 6;

// One-off AFI federation license, valid for the whole season, separate from
// the per-jornada JORNADA_PRICE above.
export const AFI_LICENSE_PRICE = 19;
export const JOTFORM_FEDERATION_URL = "https://form.jotform.com/262702301168045";

// Given a PIN, asks the server and returns
// { type: 'master' } | { type: 'referee' } | { type: 'venue', venueKey } | null
export async function resolvePin(pin) {
  try {
    const res = await fetch("/.netlify/functions/check-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.type ? data : null;
  } catch {
    return null;
  }
}

// Room opening / competition start time based on day of week.
// Saturday -> 8:20 / 9:00 · Sunday (and default) -> 16:15 / 17:00
export function scheduleForDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0 = Sunday, 6 = Saturday
  if (day === 6) return { opening: "8:20", start: "9:00" };
  return { opening: "16:15", start: "17:00" };
}

// Taules disponibles a la sala (per assignar taula a cada partit de grups)
export const TABLES_AVAILABLE = 6;
