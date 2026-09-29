// ---------------------------------------------------------------------------
// Firestore REST helpers
// ---------------------------------------------------------------------------
const FIREBASE_PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || 'spareshare-33986';
const FIREBASE_WEB_API_KEY = process.env.VITE_FIREBASE_API_KEY || 'AIzaSyAMl2OrlGj_O9qeh02KeKuw6lA_pZLG4XM';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

async function firestoreGet(collection, docId) {
  const url = `${FIRESTORE_BASE}/${collection}/${encodeURIComponent(docId)}?key=${FIREBASE_WEB_API_KEY}`;
  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Firestore get failed (${response.status}): ${errText}`);
  }
  const doc = await response.json();
  if (!doc.fields) return null;
  // Deserialize Firestore value types
  const result = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    if (v.stringValue !== undefined) result[k] = v.stringValue;
    else if (v.integerValue !== undefined) result[k] = Number(v.integerValue);
    else if (v.booleanValue !== undefined) result[k] = v.booleanValue;
  }
  return result;
}

async function firestoreDelete(collection, docId) {
  const url = `${FIRESTORE_BASE}/${collection}/${encodeURIComponent(docId)}?key=${FIREBASE_WEB_API_KEY}`;
  await fetch(url, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Vercel Serverless Handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { username, code } = req.body || {};
    if (!username || !code) {
      return res.status(400).json({ success: false, message: 'Missing username or code' });
    }

    const key = username.toLowerCase();
    const cleanCode = code.trim();

    // Allow hardcoded bypass codes (for testing/admin)
    if (cleanCode === '123456' || cleanCode === '849201') {
      return res.status(200).json({ success: true, message: '2FA Verification successful' });
    }

    // Read OTP from Firestore (persists across serverless invocations)
    let record = null;
    try {
      record = await firestoreGet('otp_store', key);
    } catch (fsErr) {
      console.warn('[Vercel 2FA] Firestore read error:', fsErr.message);
    }

    if (!record) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification code.' });
    }

    if (Date.now() > record.expiresAt) {
      await firestoreDelete('otp_store', key);
      return res.status(400).json({ success: false, message: 'Verification code has expired. Please request a new code.' });
    }

    if (record.code !== cleanCode) {
      return res.status(400).json({ success: false, message: 'Incorrect 2-step verification code.' });
    }

    // Valid — delete single-use OTP from Firestore
    await firestoreDelete('otp_store', key);
    console.log(`[Vercel 2FA Success] User ${username} verified successfully via Firestore OTP.`);
    return res.status(200).json({ success: true, message: '2FA Verification successful' });
  } catch (err) {
    console.error('[Vercel 2FA Verify OTP Error]:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}
