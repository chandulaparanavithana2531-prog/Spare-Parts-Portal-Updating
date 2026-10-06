import crypto from 'crypto';
import { getAdmin } from './_lib/firebaseAdmin.js';

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * POST /api/login  { identifier, password }
 * Checks the password on the server and returns a Firebase custom token.
 * The browser signs in with that token, so Firestore rules can tell who is who.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  const admin = getAdmin();
  if (!admin) {
    return res.status(503).json({
      success: false,
      code: 'AUTH_NOT_CONFIGURED',
      message: 'Server login is not configured (FIREBASE_SERVICE_ACCOUNT missing).',
    });
  }

  const { identifier, password } = req.body || {};
  if (!identifier || !password) {
    return res.status(400).json({ success: false, message: 'Enter your email/username and password.' });
  }

  try {
    const db = admin.firestore();
    const users = db.collection('users');
    const id = String(identifier).trim();
    const lower = id.toLowerCase();

    // 1. Find the account: by document id, then email, then username
    let snap = id.includes('/') ? null : await users.doc(id).get();
    if (!snap || !snap.exists) {
      let q = await users.where('email', '==', lower).limit(1).get();
      if (q.empty) q = await users.where('username', '==', id).limit(1).get();
      snap = q.empty ? null : q.docs[0];
    }

    // 2. One-time admin bootstrap (only when no admin document exists yet)
    if ((!snap || !snap.exists) && lower === 'admin' && process.env.ADMIN_INITIAL_PASSWORD &&
        safeEqual(password, process.env.ADMIN_INITIAL_PASSWORD)) {
      const ref = users.doc('admin');
      await ref.set({
        username: 'admin',
        email: (process.env.ADMIN_EMAIL || '').toLowerCase(),
        role: 'admin',
        approved: true,
        password: sha256(password),
      });
      snap = await ref.get();
    }

    if (!snap || !snap.exists) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const user = snap.data();
    const hash = sha256(password);
    const isHashMatch = safeEqual(user.password, hash);
    const isLegacyPlain = !isHashMatch && user.password && safeEqual(user.password, password);

    if (!isHashMatch && !isLegacyPlain) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }
    if (user.approved === false) {
      return res.status(403).json({ success: false, message: 'Account pending approval' });
    }

    // Upgrade any old plain-text password to a hash
    if (isLegacyPlain) {
      await snap.ref.update({ password: hash });
    }

    const role = user.role === 'admin' ? 'admin' : 'user';
    const token = await admin.auth().createCustomToken(snap.id, {
      role,
      plant: user.factoryAffiliation || null,
    });

    return res.status(200).json({
      success: true,
      token,
      user: {
        username: user.username || snap.id,
        email: user.email || user.username || snap.id,
        role,
        factoryAffiliation: user.factoryAffiliation,
        approved: true,
      },
    });
  } catch (err) {
    console.error('[Login API Error]:', err);
    return res.status(500).json({ success: false, message: 'Login failed on the server. Please try again.' });
  }
}
