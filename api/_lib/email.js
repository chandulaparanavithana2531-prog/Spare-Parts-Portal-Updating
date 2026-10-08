import nodemailer from 'nodemailer';

const REQUIRED_ENV_VARS = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
  'APP_URL',
  'ACTION_SECRET'
];

let transporter;

export function getRequiredEnv(name) {
  const value = process.env[name];
  if (value === undefined || String(value).trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function ensureRequiredServerEnv() {
  for (const name of REQUIRED_ENV_VARS) {
    getRequiredEnv(name);
  }
  return true;
}

export function getSenderAddress() {
  const smtpUser = getRequiredEnv('SMTP_USER').trim().toLowerCase();
  const sender = getRequiredEnv('SMTP_FROM');
  const fromAddress = (sender.match(/<([^>]+)>/)?.[1] || sender).trim().toLowerCase();
  if (smtpUser !== 'sparevone@gmail.com' || fromAddress !== 'sparevone@gmail.com') {
    throw new Error('Email must be configured to send only from sparevone@gmail.com.');
  }
  return sender;
}

export function isDryRunEnabled() {
  return (process.env.EMAIL_DRY_RUN || '').toLowerCase() === 'true';
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function getSmtpTransportConfig() {
  return {
    host: getRequiredEnv('SMTP_HOST'),
    port: Number(getRequiredEnv('SMTP_PORT')),
    secure: String(process.env.SMTP_SECURE || 'true').toLowerCase() === 'true',
    auth: {
      user: getRequiredEnv('SMTP_USER'),
      pass: getRequiredEnv('SMTP_PASS')
    }
  };
}

export async function sendTransactionalEmail({ to, subject, text, html, from } = {}) {
  const sender = getSenderAddress();
  if (!to || !subject) {
    throw new Error('Missing required email fields: to and subject');
  }

  if (from && from !== sender) {
    throw new Error('Email sender must match the configured SMTP_FROM address.');
  }

  if (isDryRunEnabled()) {
    console.warn(`[EMAIL_DRY_RUN] Would send email from ${sender} to ${to} with subject: ${subject}`);
    return { dryRun: true, from: sender, to, messageId: 'dry-run' };
  }

  if (!transporter) transporter = nodemailer.createTransport(getSmtpTransportConfig());
  const mailResult = await transporter.sendMail({
    from: sender,
    replyTo: process.env.SMTP_FROM || sender,
    to,
    subject,
    text: text || '',
    html: html || text || ''
  });

  return {
    dryRun: false,
    from: sender,
    to,
    messageId: mailResult.messageId
  };
}
