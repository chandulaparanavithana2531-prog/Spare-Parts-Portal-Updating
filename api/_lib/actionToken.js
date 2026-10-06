import crypto from 'crypto';

const VALID_DAYS = 14;

function sign(orderId, action, exp) {
  return crypto
    .createHmac('sha256', process.env.ACTION_SECRET)
    .update(`${orderId}.${action}.${exp}`)
    .digest('hex');
}

/** Returns a signed token for an email approve/reject link, or null if ACTION_SECRET is not set. */
export function createActionToken(orderId, action) {
  if (!process.env.ACTION_SECRET) return null;
  const exp = Date.now() + VALID_DAYS * 24 * 60 * 60 * 1000;
  return `${exp}.${sign(orderId, action, exp)}`;
}

export function verifyActionToken(orderId, action, token) {
  if (!process.env.ACTION_SECRET || !token) return false;
  const [expStr, sig] = String(token).split('.');
  const exp = Number(expStr);
  if (!exp || !sig || Date.now() > exp) return false;
  const expected = sign(orderId, action, exp);
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
