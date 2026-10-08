import admin from 'firebase-admin';

let initialised = false;
let initError = null;

/**
 * Returns the initialised firebase-admin namespace, or null when the
 * FIREBASE_SERVICE_ACCOUNT environment variable is not configured.
 *
 * FIREBASE_SERVICE_ACCOUNT must contain the full service-account JSON
 * (Firebase Console > Project settings > Service accounts > Generate new private key).
 */
export function getAdmin() {
  if (initialised) return admin;
  if (initError) return null;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    initError = 'Missing required environment variable: FIREBASE_SERVICE_ACCOUNT.';
    console.warn('[firebaseAdmin] ' + initError);
    return null;
  }

  try {
    const serviceAccount = JSON.parse(raw);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    initialised = true;
    return admin;
  } catch (err) {
    initError = 'Firebase Admin initialization failed; verify the server service-account configuration.';
    console.error('[firebaseAdmin] Failed to initialize Firebase Admin; check server configuration.');
    return null;
  }
}

export function getAdminError() {
  return initError;
}
