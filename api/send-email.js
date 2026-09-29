import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { to, subject, text, html } = req.body || {};
    if (!to || !subject || (!text && !html)) {
      return res.status(400).json({ success: false, message: 'Missing to, subject, or message body' });
    }

    const smtpUser = process.env.SMTP_USER || 'sparevone@gmail.com';
    const smtpPass = process.env.SMTP_PASS || 'wpuk rddy frix kjiu';

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || `"SpareShare Portal" <${smtpUser}>`,
      to,
      subject,
      text,
      html,
    });

    console.log(`[Vercel Send Email Success] Delivered email to ${to}, Message ID: ${info.messageId}`);
    return res.status(200).json({ success: true, messageId: info.messageId });
  } catch (err) {
    console.error('[Vercel Send Email Error]:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}
