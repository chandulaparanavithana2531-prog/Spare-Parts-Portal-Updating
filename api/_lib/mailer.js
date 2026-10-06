import nodemailer from 'nodemailer';

/** Creates the SMTP transporter from environment variables only (no hardcoded credentials). */
export function getMailer() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    throw new Error('Email is not configured on the server: set SMTP_USER and SMTP_PASS.');
  }
  const port = Number(process.env.SMTP_PORT || 465);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export function getSender() {
  return process.env.SMTP_FROM || `"SpareShare Enterprise Portal" <${process.env.SMTP_USER}>`;
}

/** Public URL of the portal, used for links inside emails. */
export function getAppUrl() {
  const url =
    process.env.APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  return url.replace(/\/$/, '');
}

/** Placeholder addresses that must never receive real order data. */
export function isPlaceholderEmail(email) {
  const e = String(email || '').toLowerCase();
  return (
    !e.includes('@') ||
    e === 'admin@gmail.com' ||
    e === 'user@rcl.lk' ||
    /^(lankatiles|lankawalltiles|rocellhorana|rocelleheliyagoda)\.admin@gmail\.com$/.test(e)
  );
}

export function cleanRecipients(list) {
  const items = (Array.isArray(list) ? list : String(list || '').split(','))
    .map((e) => String(e).trim())
    .filter((e) => e && !isPlaceholderEmail(e));
  return Array.from(new Set(items));
}
