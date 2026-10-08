import crypto from 'crypto';

export const ACTION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function isActionNonceConsumed(consumedNonces, nonce) {
  return Array.isArray(consumedNonces) && consumedNonces.includes(nonce);
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodePayload(tokenPart) {
  return JSON.parse(Buffer.from(tokenPart, 'base64url').toString('utf8'));
}

export function createSignedActionUrl(orderId, action, baseUrl = process.env.APP_URL || 'http://localhost:3000', secret = process.env.ACTION_SECRET, ttlMs = ACTION_TOKEN_TTL_MS) {
  if (!orderId || !['approve', 'reject'].includes(action)) {
    throw new Error('Order ID and action are required for the action URL.');
  }
  if (!secret) {
    throw new Error('Missing required environment variable: ACTION_SECRET');
  }

  const expiry = Date.now() + ttlMs;
  const payload = { orderId: String(orderId), action, exp: expiry, nonce: crypto.randomUUID() };
  const encodedPayload = encodePayload(payload);
  const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('hex');
  const token = `${encodedPayload}.${signature}`;
  const safeBaseUrl = String(baseUrl || '').replace(/\/$/, '');
  return `${safeBaseUrl}/api/orders/action?action=${encodeURIComponent(action)}&orderId=${encodeURIComponent(orderId)}&token=${encodeURIComponent(token)}`;
}

export function verifySignedActionToken(token, secret) {
  if (!token || typeof token !== 'string') {
    throw new Error('Missing action token.');
  }
  if (!secret) {
    throw new Error('Missing required environment variable: ACTION_SECRET');
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new Error('Invalid action token format.');
  }

  const [payloadPart, signature] = parts;
  const expectedSignature = crypto.createHmac('sha256', secret).update(payloadPart).digest('hex');

  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new Error('Invalid action token signature.');
  }

  const payload = decodePayload(payloadPart);
  if (!payload || !payload.orderId || !['approve', 'reject'].includes(payload.action) || !payload.nonce) {
    throw new Error('Malformed action token payload.');
  }

  if (Date.now() > Number(payload.exp)) {
    throw new Error('Action link has expired.');
  }

  return payload;
}

export function verifySignedActionUrl(rawUrl, secret) {
  if (!rawUrl) {
    throw new Error('Missing action URL.');
  }
  const url = new URL(rawUrl, 'https://example.invalid');
  const token = url.searchParams.get('token');
  return verifySignedActionToken(token, secret);
}
