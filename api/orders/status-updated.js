import { ensureRequiredServerEnv, escapeHtml, sendTransactionalEmail } from '../_lib/email.js';
import { getAdmin, getAdminError } from '../_lib/firebaseAdmin.js';
import { findRegisteredUser, getRegisteredPlantUsers, validEmail } from '../_lib/orderEmailFlow.js';
import { normalizePlantId, PLANT_NAMES } from '../_lib/plants.js';
import { syncOrderToSheet } from '../../services/googleSheets.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  try {
    ensureRequiredServerEnv();
    const admin = getAdmin();
    if (!admin) return res.status(503).json({ success: false, message: getAdminError() || 'Firebase server access is not configured.' });

    const { order, item, status, performerUsername } = req.body || {};
    if (!order?.id) return res.status(400).json({ success: false, message: 'Missing order data.' });
    const requester = await findRegisteredUser(admin, order.requestedBy);
    const requestingPlant = normalizePlantId(order.userFactory || requester?.factoryAffiliation);
    const users = await getRegisteredPlantUsers(admin, requestingPlant);
    const recipients = new Map(users.map(user => [user.email.toLowerCase(), user.email]));
    const directEmail = requester?.email || (validEmail(order.userEmail) ? order.userEmail : '');
    if (validEmail(directEmail)) recipients.set(directEmail.toLowerCase(), directEmail);

    const safeStatus = escapeHtml(String(status || 'pending').toUpperCase());
    const safeId = escapeHtml(order.id);
    const safeDescription = escapeHtml(item?.sparePartDescription || order.items?.[0]?.sparePartDescription || 'N/A');
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:24px;background:#0b1120;color:#e2e8f0;font-family:Arial,sans-serif"><table width="100%"><tr><td align="center"><table width="100%" style="max-width:640px;background:#0f172a;border:1px solid #334155;border-radius:12px;padding:28px"><tr><td><h1 style="color:#38bdf8">Order Update</h1><p>Your order <strong>${safeId}</strong> has been updated to <strong>${safeStatus}</strong>.</p><p>Requesting plant: ${escapeHtml(PLANT_NAMES[requestingPlant])}<br>Item: ${safeDescription}</p><p>Official Dispatch from sparevone@gmail.com</p></td></tr></table></td></tr></table></body></html>`;
    const errors = [];
    for (const to of recipients.values()) {
      try {
        await sendTransactionalEmail({
          to,
          subject: `Order Update - Ref: ${order.id} (${String(status || 'pending').toUpperCase()})`,
          text: `Your order ${order.id} status has been updated to ${status || 'pending'} by ${performerUsername || 'Plant Manager'}.`,
          html,
          from: process.env.SMTP_FROM
        });
      } catch (error) {
        errors.push(error.message);
        console.warn(`[Order Status Email] Delivery failed for ${to}: ${error.message}`);
      }
    }

    syncOrderToSheet(order).catch(error => console.warn('[Order Status Email] Sheet sync failed:', error.message));
    return res.status(200).json({ success: errors.length === 0, recipientCount: recipients.size, failedCount: errors.length });
  } catch (error) {
    console.warn('[Order Status Email] Processing failed:', error.message);
    return res.status(200).json({ success: false, message: error.message });
  }
}