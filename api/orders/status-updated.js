import { generateOrderStatusUpdateEmail } from '../../emailQueue.js';
import { syncOrderToSheet } from '../../services/googleSheets.js';
import { requireUser } from '../_lib/auth.js';
import { getMailer, getSender, cleanRecipients } from '../_lib/mailer.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  const caller = await requireUser(req, res);
  if (!caller) return;

  try {
    const { order, item, status, performerUsername } = req.body || {};
    if (!order || !Array.isArray(order.items)) {
      return res.status(400).json({ success: false, message: 'Missing order data' });
    }

    const recipientUser = cleanRecipients(order.userEmail || order.requestedBy)[0];
    let emailResult = 'no-recipient';

    if (recipientUser) {
      await getMailer().sendMail({
        from: getSender(),
        replyTo: process.env.SMTP_REPLY_TO || process.env.SMTP_USER,
        to: recipientUser,
        subject: `Order Update - Ref: ${order.id} (${String(status || '').toUpperCase()})`,
        text: `Hello ${recipientUser},\n\nYour order ${order.id} status has been updated to ${status} by ${performerUsername}.`,
        html: generateOrderStatusUpdateEmail(order, item || order.items[0], status, performerUsername),
      });
      emailResult = 'sent';
    }

    const sheetSync = await syncOrderToSheet(order).catch((err) => ({ success: false, message: err.message }));

    return res.status(200).json({ success: true, email: emailResult, recipient: recipientUser || null, sheetSync });
  } catch (err) {
    console.error('[Order Status Email Error]:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}
