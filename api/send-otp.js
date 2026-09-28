import { google } from 'googleapis';

// ---------------------------------------------------------------------------
// Firestore REST helpers — no Admin SDK needed, uses project ID + web API key
// ---------------------------------------------------------------------------
const FIREBASE_PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || 'spareshare-33986';
const FIREBASE_WEB_API_KEY = process.env.VITE_FIREBASE_API_KEY || 'AIzaSyAMl2OrlGj_O9qeh02KeKuw6lA_pZLG4XM';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

async function firestoreSet(collection, docId, data) {
  const fields = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = { integerValue: String(v) };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
  }
  const url = `${FIRESTORE_BASE}/${collection}/${encodeURIComponent(docId)}?key=${FIREBASE_WEB_API_KEY}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Firestore write failed (${response.status}): ${errText}`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Gmail REST API via Google Service Account (domain-wide delegation)
// ---------------------------------------------------------------------------
function getGmailAuthClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !privateKey) {
    throw new Error(
      'Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY. ' +
      'Set these in Vercel Project Settings > Environment Variables.'
    );
  }

  // Vercel env vars often have literal \\n — fix them back to real newlines
  privateKey = privateKey.replace(/\\n/g, '\n');

  const gmailSender = process.env.SMTP_USER || 'sparevone@gmail.com';

  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    subject: gmailSender, // Impersonate the sender (requires domain-wide delegation on the service account)
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
  const raw = lines.join('\r\n');
  return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendViaGmailApi({ from, to, subject, html, text }) {
  const auth = getGmailAuthClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const raw = buildRawEmail({ from, to, subject, html, text });
  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });
  return result.data;
}

// ---------------------------------------------------------------------------
// OTP Email HTML Template
// ---------------------------------------------------------------------------
function buildOtpHtml(username, otpCode) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>2-Step Verification Code</title></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f3f4f6;padding:40px 10px;">
    <tr>
      <td align="center">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;background-color:#ffffff;border-radius:20px;padding:32px;box-shadow:0 10px 25px -5px rgba(0,0,0,0.1);">
          <div style="text-align:center;margin-bottom:20px;">
            <div style="background:#1e40af;color:#fff;width:56px;height:56px;border-radius:50%;display:inline-block;line-height:56px;font-size:28px;">&#128737;</div>
            <h2 style="color:#1e40af;margin:12px 0 4px 0;">2-Step Verification Required</h2>
            <p style="color:#64748b;font-size:14px;margin:0;">SpareShare Security Authentication</p>
          </div>
          <p style="font-size:15px;color:#374151;">Hello <strong>${username}</strong>,</p>
          <p style="font-size:14px;color:#4b5563;">You are signing into the SpareShare Inter-Factory Portal. Please use the following 6-digit verification passcode to complete your login:</p>
          <div style="background:#f8fafc;border:2px dashed #cbd5e1;border-radius:16px;padding:20px;text-align:center;margin:24px 0;">
            <div style="font-size:36px;font-weight:900;letter-spacing:0.3em;color:#1e3a8a;font-family:monospace;">${otpCode}</div>
            <p style="margin:8px 0 0 0;font-size:12px;color:#64748b;font-weight:600;">&#9201; Valid for 5 minutes &bull; Do not share this code</p>
          </div>
          <p style="font-size:13px;color:#6b7280;text-align:center;margin-bottom:0;">This passcode was dispatched from <strong>sparevone@gmail.com</strong>.</p>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Vercel Serverless Handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { username, email } = req.body || {};
    if (!username) {
      return res.status(400).json({ success: false, message: 'Missing username' });
    }

    const gmailSender = process.env.SMTP_USER || 'sparevone@gmail.com';
    const targetEmail = email || (username.includes('@') ? username : gmailSender);
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    // 1. Persist OTP in Firestore (works across separate serverless function invocations)
    await firestoreSet('otp_store', username.toLowerCase(), {
      code: otpCode,
      expiresAt,
      username,
    });
    console.log(`[Vercel 2FA] OTP stored in Firestore for ${username} -> ${targetEmail}: ${otpCode}`);

    // 2. Send via Gmail REST API (bypasses cloud IP SMTP blocks)
    const fromDisplay = process.env.SMTP_FROM || `"SpareShare Security" <${gmailSender}>`;
    await sendViaGmailApi({
      from: fromDisplay,
      to: targetEmail,
      subject: `SpareShare 2-Step Verification Code: ${otpCode}`,
      html: buildOtpHtml(username, otpCode),
      text: `Hello ${username},\n\nYour SpareShare 2-Step Verification Code is: ${otpCode}\nValid for 5 minutes.\n\nDispatched from ${gmailSender}`,
    });
    console.log(`[Vercel 2FA] Email sent via Gmail API to ${targetEmail}`);

    return res.status(200).json({
      success: true,
      message: `2-Step verification passcode dispatched from ${gmailSender} to ${targetEmail}`,
      otpCode,
    });
  } catch (err) {
    console.error('[Vercel 2FA Send OTP Error]:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}
