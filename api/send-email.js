import { requireUser } from './_lib/auth.js';
import { getMailer, getSender, cleanRecipients } from './_lib/mailer.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  const caller = await requireUser(req, res);
  if (!caller) return;

  try {
    const { to, subject, text, html } = req.body || {};
    const recipients = cleanRecipients(to);
    if (!recipients.length || !subject || (!text && !html)) {
      return res.status(400).json({ success: false, message: 'Missing a valid recipient, subject, or message body' });
    }

    const info = await getMailer().sendMail({
      from: getSender(),
      replyTo: process.env.SMTP_REPLY_TO || process.env.SMTP_USER,
      to: recipients.join(', '),
      subject,
      text,
      html,
    });

    console.log(`[Send Email] Delivered to ${recipients.join(', ')} (by ${caller.uid || 'transition-mode'}), id ${info.messageId}`);
    return res.status(200).json({ success: true, messageId: info.messageId });
  } catch (err) {
    console.error('[Send Email Error]:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}
