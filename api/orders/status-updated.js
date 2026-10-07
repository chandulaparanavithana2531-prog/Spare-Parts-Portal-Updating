import { ensureRequiredServerEnv, sendTransactionalEmail, escapeHtml } from '../_lib/email.js';
import { syncOrderToSheet } from '../../services/googleSheets.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    ensureRequiredServerEnv();
    const { order, item, status, performerUsername } = req.body || {};
    if (!order) {
      return res.status(400).json({ success: false, message: 'Missing order data' });
    }

    const recipientUser = order.userEmail || order.requestedBy;
    if (!recipientUser || !recipientUser.includes('@')) {
      return res.status(200).json({ success: true, message: 'No email recipient for order' });
    }

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:24px;background:#0b1120;color:#e2e8f0;font-family:Arial,sans-serif;">
      <table width="100%"><tr><td align="center"><div style="max-width:640px;background:#0f172a;border:1px solid #334155;border-radius:12px;padding:28px;">
        <h1 style="margin:0 0 12px;color:#38bdf8;">Order Update</h1>
        <p style="margin:0 0 12px;">Hello ${escapeHtml(recipientUser)},</p>
        <p style="margin:0 0 12px;">Your order <strong>${escapeHtml(order.id || 'Unknown')}</strong> has been updated to <strong>${escapeHtml(String(status || 'pending')).toUpperCase()}</strong> by ${escapeHtml(performerUsername || 'Plant Manager')}.</p>
        <p style="margin:0;">Item: ${escapeHtml((item && item.sparePartDescription) || (order.items && order.items[0] && order.items[0].sparePartDescription) || 'N/A')}</p>
      </div></td></tr></table>
    </body></html>`;

    await sendTransactionalEmail({
      to: recipientUser,
      subject: `Order Update - Ref: ${order.id} (${(status || '').toUpperCase()})`,
      text: `Your order ${order.id} status has been updated to ${status} by ${performerUsername}.`,
      html,
      from: process.env.SMTP_FROM || 'SpareShare Enterprise Portal <sparevone@gmail.com>'
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
