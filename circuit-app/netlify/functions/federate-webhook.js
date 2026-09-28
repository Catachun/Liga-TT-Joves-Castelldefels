// Netlify serverless function that receives Jotform's webhook when someone
// submits the "Sol·licitud de federació" form, and marks that player's
// federation request as pending in Firestore (matched by email).
//
// It does NOT set the real federation number automatically — FCTT assigns
// that after processing the request, so a club admin still enters it later
// from the app's management panel. This function only records that a
// request was sent, so David doesn't have to cross-check Jotform by hand.
//
// Required Netlify environment variables (Site settings -> Environment variables):
//   FIREBASE_SERVICE_ACCOUNT  -> the full JSON of a Firebase service account
//                                key, as a single-line string (see README).
//   JOTFORM_WEBHOOK_SECRET    -> any random string you choose; must match
//                                the "?secret=" query param configured on
//                                the Jotform webhook URL.

const admin = require("firebase-admin");

function getApp() {
  if (admin.apps.length) return admin.apps[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT env var");
  const serviceAccount = JSON.parse(raw);
  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

// Jotform posts multipart/form-data with a "rawRequest" field containing
// the submission as a JSON string keyed by internal question IDs, plus
// separate top-level fields like "q7_correuElectronic" depending on the
// form. We parse leniently and look for anything email-shaped.
function extractEmail(payload) {
  const tryFields = [];
  if (payload.rawRequest) {
    try {
      const parsed = JSON.parse(payload.rawRequest);
      tryFields.push(...Object.values(parsed));
    } catch {
      // rawRequest wasn't JSON (older Jotform format) — fall through
    }
  }
  tryFields.push(...Object.values(payload));

  const emailRegex = /[^\s@]+@[^\s@]+\.[^\s@]+/;
  for (const v of tryFields) {
    if (typeof v === "string") {
      const m = v.match(emailRegex);
      if (m) return m[0].toLowerCase();
    }
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const secret = event.queryStringParameters && event.queryStringParameters.secret;
  if (!secret || secret !== process.env.JOTFORM_WEBHOOK_SECRET) {
    return { statusCode: 401, body: "Unauthorized" };
  }

  let payload = {};
  try {
    const contentType = event.headers["content-type"] || "";
    if (contentType.includes("application/json")) {
      payload = JSON.parse(event.body);
    } else {
      // application/x-www-form-urlencoded or multipart — Netlify hands us
      // the raw body; parse it as URL-encoded params (Jotform's default).
      const params = new URLSearchParams(event.body);
      payload = Object.fromEntries(params.entries());
    }
  } catch (e) {
    return { statusCode: 400, body: "Bad payload: " + e.message };
  }

  const email = extractEmail(payload);
  if (!email) {
    return { statusCode: 200, body: "No email found in submission — nothing to match, ignored." };
  }

  try {
    getApp();
    const db = admin.firestore();
    const snap = await db
      .collection("players")
      .where("familyEmail", "==", email)
      .get();

    if (snap.empty) {
      return {
        statusCode: 200,
        body: `No player found for ${email} — request logged but not linked.`,
      };
    }

    const batch = db.batch();
    snap.docs.forEach((doc) => {
      batch.update(doc.ref, {
        federationRequestStatus: "pending",
        federationRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();

    return {
      statusCode: 200,
      body: `Marked ${snap.size} profile(s) for ${email} as federation-pending.`,
    };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: "Error: " + e.message };
  }
};
