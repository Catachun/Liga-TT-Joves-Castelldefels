// Checks an organiser PIN on the server so the PINs never live in the public
// repository or in the browser bundle.
//
// Netlify environment variables (Site settings -> Environment variables):
//   ADMIN_PIN_MASTER   -> PIN of the main administrator
//   ADMIN_PIN_REFEREE  -> (optional) PIN of the referee role
//   ADMIN_PINS_VENUES  -> JSON with one PIN per venue, e.g.
//                         {"joves":"<pin>","espronceda":"<pin>"}
//
// POST {"pin":"..."}  ->  {"type":"master"} | {"type":"referee"}
//                      |  {"type":"venue","venueKey":"joves"} | {"type":null}
const crypto = require("crypto");

function same(a, b) {
  if (!a || !b) return false;
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  let pin = "";
  try {
    pin = String(JSON.parse(event.body || "{}").pin || "").trim();
  } catch {
    return json(400, { error: "Bad request" });
  }
  if (!pin || pin.length > 32) return json(200, { type: null });

  const master = process.env.ADMIN_PIN_MASTER;
  const referee = process.env.ADMIN_PIN_REFEREE;
  let venues = {};
  try {
    venues = JSON.parse(process.env.ADMIN_PINS_VENUES || "{}");
  } catch {
    venues = {};
  }
  if (!master && !referee && !Object.keys(venues).length) {
    return json(503, { error: "PINs not configured" });
  }

  let result = { type: null };
  if (same(pin, master)) result = { type: "master" };
  else if (same(pin, referee)) result = { type: "referee" };
  else {
    for (const [venueKey, vp] of Object.entries(venues)) {
      if (same(pin, vp)) { result = { type: "venue", venueKey }; break; }
    }
  }
  if (!result.type) await new Promise((r) => setTimeout(r, 600)); // slow down brute force
  return json(200, result);
};
