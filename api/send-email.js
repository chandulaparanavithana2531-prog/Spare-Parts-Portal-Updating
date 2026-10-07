import { ensureRequiredServerEnv, sendTransactionalEmail } from '../_lib/email.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    ensureRequiredServerEnv();
    const { to, subject, text, html } = req.body || {};
    if (!to || !subject || (!text && !html)) {
      return res.status(400).json({ success: false, message: 'Missing to, subject, or message body' });
    }

    const result = await sendTransactionalEmail({
      to,
      subject,
      text,
      html,
      from: process.env.SMTP_FROM || 'SpareShare Enterprise Portal <sparevone@gmail.com>'
    });

    return res.status(200).json({ success: true, messageId: result.messageId, dryRun: result.dryRun });
  } catch (err) {
    console.warn('[Vercel Send Email Error]:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}
