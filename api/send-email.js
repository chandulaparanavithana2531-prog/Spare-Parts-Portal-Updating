import { google } from 'googleapis';

function getGmailAuthClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !privateKey) {
    throw new Error(
      'Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY. ' +
      'Set these in Vercel Project Settings > Environment Variables.'
    );
  }

  privateKey = privateKey.replace(/\\n/g, '\n');
  const gmailSender = process.env.SMTP_USER || 'sparevone@gmail.com';

  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    subject: gmailSender,
  });
}

function buildRawEmail({ from, to, subject, html, text }) {
  const boundary = `boundary_${Date.now()}`;
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    text || '',
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    html || '',
    '',
    `--${boundary}--`,
  ];
  return Buffer.from(lines.join('\r\n')).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { to, subject, text, html } = req.body || {};
    if (!to || !subject || (!text && !html)) {
      return res.status(400).json({ success: false, message: 'Missing to, subject, or message body' });
    }

    const gmailSender = process.env.SMTP_USER || 'sparevone@gmail.com';
    const from = process.env.SMTP_FROM || `"SpareShare Portal" <${gmailSender}>`;

    const auth = getGmailAuthClient();
    const gmail = google.gmail({ version: 'v1', auth });
    const raw = buildRawEmail({ from, to, subject, html, text });

    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    console.log(`[Vercel Send Email Success] Delivered email to ${to}, Message ID: ${result.data.id}`);
    return res.status(200).json({ success: true, messageId: result.data.id });
  } catch (err) {
    console.error('[Vercel Send Email Error]:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}
