import nodemailer from 'nodemailer';
import { generateOrderStatusUpdateEmail } from '../../emailQueue.js';
import { syncOrderToSheet } from '../../services/googleSheets.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { order, item, status, performerUsername } = req.body || {};
    if (!order) {
      return res.status(400).json({ success: false, message: 'Missing order data' });
    }

    const recipientUser = order.userEmail || order.requestedBy;
    if (!recipientUser || !recipientUser.includes('@')) {
      return res.status(200).json({ success: true, message: 'No email recipient for order' });
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

    const html = generateOrderStatusUpdateEmail(order, item || order.items[0], status, performerUsername);
    await transporter.sendMail({
      from: process.env.SMTP_FROM || `"SpareShare Operations" <${smtpUser}>`,
      to: recipientUser,
      subject: `Order Update - Ref: ${order.id} (${(status || '').toUpperCase()})`,
      text: `Hello ${recipientUser},\n\nYour order ${order.id} status has been updated to ${status} by ${performerUsername}.`,
      html,
    });

    syncOrderToSheet(order).catch(err => {
      console.warn('[Vercel Status API] Sheet sync warning:', err.message);
    });

    return res.status(200).json({ success: true, message: `Status update email sent to ${recipientUser}` });
  } catch (err) {
    console.error('[Vercel Status API Error]:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}
