import { getAdmin, getAdminError } from '../_lib/firebaseAdmin.js';
import { ensureRequiredServerEnv, escapeHtml, sendTransactionalEmail } from '../_lib/email.js';
import { isActionNonceConsumed, verifySignedActionToken } from '../_lib/actions.js';
import { findRegisteredUser, getRegisteredPlantUsers, validEmail } from '../_lib/orderEmailFlow.js';
import { normalizePlantId, PLANT_NAMES } from '../_lib/plants.js';
import { syncOrderToSheet } from '../../services/googleSheets.js';

function page(res, status, title, body, color = '#e2e8f0') {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head><body style="margin:0;padding:40px 16px;background:#0b1120;font-family:Arial,sans-serif;color:#e2e8f0;text-align:center"><main style="max-width:480px;margin:auto;background:#111827;border:1px solid #1f2937;border-radius:16px;padding:32px"><h2 style="color:${color};margin-top:0">${escapeHtml(title)}</h2>${body}</main></body></html>`);
}

function renderStatusEmail({ order, status, requestingPlantName }) {
  const item = order.items?.[0] || {};
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:24px;background:#0b1120;color:#e2e8f0;font-family:Arial,sans-serif"><table width="100%"><tr><td align="center"><table width="100%" style="max-width:640px;background:#0f172a;border:1px solid #334155;border-radius:12px;padding:24px"><tr><td><h1 style="color:#38bdf8">Order Update</h1><p>Your request ${escapeHtml(order.id)} has been <strong>${escapeHtml(status)}</strong> by ${escapeHtml(requestingPlantName)}.</p><p>Item: ${escapeHtml(item.sparePartDescription || 'N/A')}<br>Quantity: ${escapeHtml(String(item.quantity ?? 'N/A'))}</p><p>Official Dispatch from sparevone@gmail.com</p></td></tr></table></td></tr></table></body></html>`;
}

export default async function handler(req, res) {
  const { orderId, action, token } = req.query || {};
  const act = String(action || '').toLowerCase();
  const admin = getAdmin();
  if (!admin) return page(res, 503, 'Not available', `<p>${escapeHtml(getAdminError() || 'Firebase server access is not configured.')}</p>`, '#f59e0b');

  let claims;
  try {
    ensureRequiredServerEnv();
    claims = verifySignedActionToken(String(token || ''), process.env.ACTION_SECRET);
  } catch {
    return page(res, 403, 'Link expired or invalid', '<p>Please review the request in the portal.</p>', '#ef4444');
  }

  if (!orderId || !['approve', 'reject'].includes(act) || claims.orderId !== String(orderId) || claims.action !== act) {
    return page(res, 400, 'Invalid request', '<p>The action link does not match this order.</p>', '#ef4444');
  }

  const orderRef = admin.firestore().collection('orders').doc(String(orderId));
  if (req.method === 'GET') {
    const current = await orderRef.get();
    if (!current.exists || current.data().status !== 'pending' || (current.data().items || []).every(item => item.status !== 'pending')) {
      return page(res, 409, 'Order is no longer pending', '<p>This request has already been processed.</p>', '#f59e0b');
    }
    const actionUrl = `/api/orders/action?orderId=${encodeURIComponent(orderId)}&action=${act}&token=${encodeURIComponent(token)}`;
    const color = act === 'approve' ? '#10b981' : '#ef4444';
    return page(res, 200, `${act === 'approve' ? 'Approve' : 'Reject'} order ${orderId}?`, `<p>This will ${act} all pending items in the order.</p><form method="POST" action="${escapeHtml(actionUrl)}"><button type="submit" style="background:${color};color:#fff;border:0;border-radius:8px;padding:12px 28px;font-size:16px;font-weight:bold;cursor:pointer">Confirm ${act}</button></form>`);
  }
  if (req.method !== 'POST') return page(res, 405, 'Method not allowed', '');

  try {
    const newStatus = act === 'approve' ? 'approved' : 'rejected';
    const order = await admin.firestore().runTransaction(async transaction => {
      const snapshot = await transaction.get(orderRef);
      if (!snapshot.exists) throw new Error('Order not found.');
      const data = snapshot.data();
      const used = Array.isArray(data.emailActionNonces) ? data.emailActionNonces : [];
      if (isActionNonceConsumed(used, claims.nonce)) throw new Error('This action link has already been used.');
      if (data.status !== 'pending' || !(data.items || []).some(item => item.status === 'pending')) {
        throw new Error('Order is no longer pending.');
      }

      const items = (data.items || []).map(item => item.status === 'pending' ? { ...item, status: newStatus } : item);
      const allProcessed = items.every(item => item.status !== 'pending');
      const overallStatus = allProcessed
        ? (items.some(item => item.status === 'approved' || item.status === 'delivered') ? 'approved' : 'rejected')
        : 'pending';
      transaction.update(orderRef, {
        items,
        status: overallStatus,
        emailActionNonces: [...used, claims.nonce],
        ...(newStatus === 'approved' ? { approvedAt: Date.now() } : {})
      });
      return { ...data, items, status: overallStatus };
    });

    const requester = await findRegisteredUser(admin, order.requestedBy);
    const requestingPlant = normalizePlantId(order.userFactory || requester?.factoryAffiliation);
    const recipients = new Map();
    const plantUsers = await getRegisteredPlantUsers(admin, requestingPlant);
    plantUsers.forEach(user => recipients.set(user.email.toLowerCase(), user.email));
    const directEmail = requester?.email || (validEmail(order.userEmail) ? order.userEmail : '');
    if (validEmail(directEmail)) recipients.set(directEmail.toLowerCase(), directEmail);

    for (const to of recipients.values()) {
      try {
        await sendTransactionalEmail({
          to,
          subject: `Order Update - Ref: ${orderId} (${newStatus.toUpperCase()})`,
          text: `Your order ${orderId} has been ${newStatus} by the supplying plant.`,
          html: renderStatusEmail({ order, status: newStatus, requestingPlantName: PLANT_NAMES[requestingPlant] }),
          from: process.env.SMTP_FROM
        });
      } catch (error) {
        console.warn(`[Order Action] Status email failed for ${to}: ${error.message}`);
      }
    }

    syncOrderToSheet(order).catch(error => console.warn('[Order Action] Sheet sync failed:', error.message));
    await admin.firestore().collection('audit_logs').add({
      timestamp: Date.now(), userId: 'email-action', action: 'ORDER_PROCESS',
      entityType: 'order', entityId: String(orderId), details: `${newStatus} all pending items via confirmed email action`
    }).catch(() => {});
    return page(res, 200, `Order ${newStatus}`, '<p>The order was processed. A status update was sent to the requesting plant.</p>', act === 'approve' ? '#10b981' : '#ef4444');
  } catch (error) {
    return page(res, 409, 'Could not process the order', `<p>${escapeHtml(error.message)}</p>`, '#ef4444');
  }
}