import { generateOrderStatusUpdateEmail } from '../../emailQueue.js';
import { syncOrderToSheet } from '../../services/googleSheets.js';
import { getAdmin } from '../_lib/firebaseAdmin.js';
import { verifyActionToken } from '../_lib/actionToken.js';
import { getMailer, getSender, getAppUrl, cleanRecipients } from '../_lib/mailer.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(res, status, title, body, color = '#e2e8f0') {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title></head>
<body style="margin:0;padding:40px 16px;background:#0b1120;font-family:Arial,sans-serif;color:#e2e8f0;text-align:center;">
<div style="max-width:480px;margin:0 auto;background:#111827;border:1px solid #1f2937;border-radius:16px;padding:32px;">
<h2 style="color:${color};margin-top:0;">${esc(title)}</h2>${body}</div></body></html>`);
}

/**
 * Email approve / reject links.
 * GET  shows a confirmation button (so email link scanners cannot approve by opening the link).
 * POST performs the action. Both require a valid signed token.
 */
export default async function handler(req, res) {
  const { orderId, action, token } = req.query || {};
  const act = String(action || '').toLowerCase();
  const appUrl = getAppUrl();
  const portalLink = `<p><a href="${esc(appUrl)}/orders" style="color:#60a5fa;">Open the portal</a></p>`;

  if (!orderId || !['approve', 'reject'].includes(act)) {
    return page(res, 400, 'Invalid request', '<p>Missing order or action.</p>', '#ef4444');
  }
  if (!verifyActionToken(String(orderId), act, token)) {
    return page(res, 403, 'Link expired or invalid', `<p>Please review this request in the portal instead.</p>${portalLink}`, '#ef4444');
  }

  const label = act === 'approve' ? 'Approve' : 'Reject';
  const color = act === 'approve' ? '#10b981' : '#ef4444';

  if (req.method === 'GET') {
    const actionUrl = `/api/orders/action?orderId=${encodeURIComponent(orderId)}&action=${act}&token=${encodeURIComponent(token)}`;
    return page(res, 200, `${label} order ${orderId}?`,
      `<p style="color:#94a3b8;">This applies to all pending items in the order.</p>
       <form method="POST" action="${esc(actionUrl)}"><button type="submit" style="background:${color};color:#fff;border:0;border-radius:8px;padding:12px 28px;font-size:16px;font-weight:bold;cursor:pointer;">Confirm ${label}</button></form>${portalLink}`, color);
  }

  if (req.method !== 'POST') {
    return page(res, 405, 'Method not allowed', '');
  }

  const admin = getAdmin();
  if (!admin) {
    return page(res, 503, 'Not available', `<p>One-click actions are not configured on the server yet.</p>${portalLink}`, '#f59e0b');
  }

  const newStatus = act === 'approve' ? 'approved' : 'rejected';
  const db = admin.firestore();
  const orderRef = db.collection('orders').doc(String(orderId));

  try {
    const order = await db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) throw new Error('Order not found');
      const data = snap.data();
      const items = (data.items || []).map((i) => (i.status === 'pending' ? { ...i, status: newStatus } : i));
      const changed = items.some((i, idx) => i.status !== (data.items[idx] || {}).status);
      if (!changed) return { ...data, unchanged: true };

      const allProcessed = items.every((i) => i.status !== 'pending');
      const mainStatus = allProcessed
        ? (items.some((i) => i.status === 'approved' || i.status === 'delivered') ? 'approved' : 'rejected')
        : 'pending';
      const update = { items, status: mainStatus };
      if (newStatus === 'approved') update.approvedAt = Date.now();
      tx.update(orderRef, update);
      return { ...data, ...update };
    });

    if (order.unchanged) {
      return page(res, 200, 'Already processed', `<p>Order ${esc(orderId)} has no pending items left.</p>${portalLink}`, '#f59e0b');
    }

    await db.collection('audit_logs').add({
      timestamp: Date.now(),
      userId: 'email-action',
      action: 'ORDER_PROCESS',
      entityType: 'order',
      entityId: String(orderId),
      details: `${label}d all pending items via email link`,
    }).catch(() => {});

    const requester = cleanRecipients(order.userEmail || order.requestedBy)[0];
    if (requester) {
      await getMailer().sendMail({
        from: getSender(),
        to: requester,
        subject: `Order Update - Ref: ${orderId} (${newStatus.toUpperCase()})`,
        text: `Your order ${orderId} has been ${newStatus} by the supplying plant.`,
        html: generateOrderStatusUpdateEmail(order, order.items[0], newStatus, 'Supplying plant (email)'),
      }).catch((err) => console.warn('[Order Action] Requester email failed:', err.message));
    }

    await syncOrderToSheet(order).catch(() => {});

    return page(res, 200, `Order ${newStatus}`, `<p>Order ${esc(orderId)} was ${newStatus}. The requester has been notified.</p>${portalLink}`, color);
  } catch (err) {
    console.error('[Order Action Error]:', err);
    return page(res, 500, 'Could not process the order', `<p>${esc(err.message)}</p>${portalLink}`, '#ef4444');
  }
}
