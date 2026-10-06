import { getAdmin } from './firebaseAdmin.js';

/**
 * Verifies the Firebase ID token sent by the portal in the Authorization header.
 * Returns the decoded token, or null after writing a 401 response.
 *
 * Transition mode: until FIREBASE_SERVICE_ACCOUNT is configured the server cannot
 * verify tokens, so requests are allowed (with a warning) to keep the portal working.
 */
export async function requireUser(req, res) {
  const admin = getAdmin();
  if (!admin) {
    console.warn('[auth] FIREBASE_SERVICE_ACCOUNT not configured - request allowed in transition mode.');
    return { uid: null, transition: true };
  }

  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    res.status(401).json({ success: false, message: 'Not signed in' });
    return null;
  }

  try {
    return await admin.auth().verifyIdToken(match[1]);
  } catch (err) {
    res.status(401).json({ success: false, message: 'Session expired. Please sign in again.' });
    return null;
  }
}
