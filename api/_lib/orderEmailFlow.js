import { normalizePlantId, PLANT_IDS, PLANT_NAMES } from './plants.js';
import { sendTransactionalEmail, escapeHtml } from './email.js';
import { createSignedActionUrl } from './actions.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validEmail(value) {
  return typeof value === 'string' && EMAIL_PATTERN.test(value.trim());
}

export function resolveRegisteredPlantUsers(userDocuments, plantId) {
  const expectedPlantId = normalizePlantId(plantId);
  const byEmail = new Map();

  for (const document of userDocuments) {
    const user = document.data || {};
    if (user.approved === false) continue;

    const email = String(user.email || user.username || '').trim();
    if (!validEmail(email)) continue;

    const rawPlant = user.factoryAffiliation || user.plant || user.factory;
    if (!rawPlant) continue;

    let userPlantId;
    try {
      userPlantId = normalizePlantId(rawPlant);
    } catch {
      continue;
    }

    if (userPlantId === expectedPlantId && !byEmail.has(email.toLowerCase())) {
      byEmail.set(email.toLowerCase(), { ...user, email });
    }
  }

  return [...byEmail.values()];
}

export async function getRegisteredPlantUsers(admin, plantId) {
  const snapshot = await admin.firestore().collection('users').get();
  return resolveRegisteredPlantUsers(
    snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() || {} })),
    plantId
  );
}

export async function findRegisteredUser(admin, identifier) {
  const key = String(identifier || '').trim();
  if (!key) return null;

  const users = admin.firestore().collection('users');
  const direct = await users.doc(key).get();
  if (direct.exists) return { id: direct.id, ...direct.data() };

  for (const field of ['username', 'email']) {
    const result = await users.where(field, '==', key).limit(1).get();
    if (!result.empty) return { id: result.docs[0].id, ...result.docs[0].data() };
  }
  return null;
}

function safeLink(url) {
  return escapeHtml(url);
}

export function renderPlantRequestEmail({ order, targetPlantId, requestingPlantId, requesterEmail, approveUrl, rejectUrl }) {
  const targetName = escapeHtml(PLANT_NAMES[targetPlantId]);
  const requestingName = escapeHtml(PLANT_NAMES[requestingPlantId]);
  const safeRequester = escapeHtml(requesterEmail || 'Unknown requester');
  const safeOrderId = escapeHtml(order.id || 'Unknown order');
  const itemRows = (order.items || []).map(item => {
    const code = escapeHtml(item.sparePartId || item.partNumber || item.materialNumber || 'N/A');
    const description = escapeHtml(item.sparePartDescription || 'N/A');
    const quantity = escapeHtml(String(item.quantity ?? 0));
    const image = item.imageUrl || item.image_url;
    const imageRow = image && /^https?:\/\//i.test(image)
      ? `<tr><td style="padding:10px 0;color:#cbd5e1;width:35%;">Image:</td><td style="padding:10px 0;"><a href="${safeLink(image)}" style="color:#38bdf8;">View item image</a></td></tr>`
      : '';
    return `<tr><td style="padding:10px 0;color:#cbd5e1;width:35%;">Item Code:</td><td style="padding:10px 0;color:#f59e0b;font-weight:700;">${code}</td></tr>
      <tr><td style="padding:10px 0;color:#cbd5e1;">Description:</td><td style="padding:10px 0;color:#fff;">${description}</td></tr>
      <tr><td style="padding:10px 0;color:#cbd5e1;">Requested Qty:</td><td style="padding:10px 0;color:#fff;font-weight:700;">${quantity}</td></tr>${imageRow}`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:24px;background:#0b1120;color:#e2e8f0;font-family:Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#0f172a;border:1px solid #334155;border-radius:12px;padding:24px;">
    <tr><td><h1 style="margin:0;color:#38bdf8;font-size:24px;">📦 Spare Part Requisition Request</h1><p style="color:#94a3b8;font-size:12px;">Official Dispatch from sparevone@gmail.com</p></td></tr>
    <tr><td style="padding:18px 0;color:#cbd5e1;">A spare part requisition has been requested from <strong>${requestingName}</strong> by <strong>${targetName}</strong>:</td></tr>
    <tr><td><table width="100%" style="border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:10px 0;color:#cbd5e1;width:35%;">Order ID:</td><td style="padding:10px 0;color:#fff;font-weight:700;">${safeOrderId}</td></tr>
      <tr><td style="padding:10px 0;color:#cbd5e1;">Requesting Plant:</td><td style="padding:10px 0;color:#38bdf8;font-weight:700;">${requestingName}</td></tr>${itemRows}
      <tr><td style="padding:10px 0;color:#cbd5e1;">Requester:</td><td style="padding:10px 0;color:#fff;">${safeRequester}</td></tr>
      <tr><td style="padding:10px 0;color:#cbd5e1;">Requested On:</td><td style="padding:10px 0;color:#fff;">${escapeHtml(new Date(order.createdAt || Date.now()).toLocaleString())}</td></tr>
      <tr><td style="padding:10px 0;color:#cbd5e1;">Notes:</td><td style="padding:10px 0;color:#fff;">${escapeHtml(order.notes || 'No notes provided')}</td></tr>
    </table></td></tr><tr><td style="padding-top:24px;"><a href="${safeLink(approveUrl)}" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">✓ APPROVE ORDER</a>
    &nbsp; <a href="${safeLink(rejectUrl)}" style="display:inline-block;background:#ef4444;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">✕ REJECT ORDER</a></td></tr>
    </table></td></tr></table></body></html>`;
}

export function renderRequesterConfirmationEmail({ order, requestingPlantId, requesterEmail }) {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:24px;background:#0b1120;color:#e2e8f0;font-family:Arial,sans-serif;">
    <table width="100%"><tr><td align="center"><table width="100%" style="max-width:640px;background:#0f172a;border:1px solid #334155;border-radius:12px;padding:24px;">
    <tr><td><h1 style="margin:0;color:#38bdf8;">Order Submitted</h1><p style="color:#94a3b8;font-size:12px;">Official Dispatch from sparevone@gmail.com</p></td></tr>
    <tr><td style="padding-top:18px;color:#cbd5e1;">Your request from <strong>${escapeHtml(PLANT_NAMES[requestingPlantId])}</strong> has been submitted successfully.</td></tr>
    <tr><td style="padding-top:12px;color:#fff;">Order ID: <strong>${escapeHtml(order.id)}</strong><br>Requester: ${escapeHtml(requesterEmail)}<br>Plant: ${escapeHtml(PLANT_NAMES[requestingPlantId])}</td></tr>
    </table></td></tr></table></body></html>`;
}

export async function deliverOrderRequest({ admin, order, targetPlantId, requestingPlantId, requesterEmail, includeConfirmation = true }) {
  const recipients = await getRegisteredPlantUsers(admin, targetPlantId);
  const result = { targetPlantId, targetRecipientCount: recipients.length, targetSent: 0, confirmationSent: 0, errors: [] };

  const baseUrl = process.env.APP_URL;
  const secret = process.env.ACTION_SECRET;
  const sender = process.env.SMTP_FROM;

  if (recipients.length) {
    const approveUrl = createSignedActionUrl(order.id, 'approve', baseUrl, secret);
    const rejectUrl = createSignedActionUrl(order.id, 'reject', baseUrl, secret);
    const html = renderPlantRequestEmail({ order, targetPlantId, requestingPlantId, requesterEmail, approveUrl, rejectUrl });

    for (const recipient of recipients) {
      try {
        await sendTransactionalEmail({
          to: recipient.email,
          subject: `Action Required: New Spare Part Request (Order Ref: ${order.id})`,
          text: `Order ${order.id} requires action from ${targetPlantId}.`,
          html,
          from: sender
        });
        result.targetSent += 1;
      } catch (error) {
        console.warn(`[Order Email] Target recipient send failed (${recipient.email}): ${error.message}`);
        result.errors.push('One target-plant request email could not be delivered.');
      }
    }
  }

  if (includeConfirmation && requestingPlantId) {
    const requestingUsers = await getRegisteredPlantUsers(admin, requestingPlantId);
    const confirmationRecipients = new Map(requestingUsers.map(user => [user.email.toLowerCase(), user.email]));
    if (validEmail(requesterEmail)) confirmationRecipients.set(requesterEmail.toLowerCase(), requesterEmail.trim());
    for (const recipient of confirmationRecipients.values()) {
      try {
        const info = await sendTransactionalEmail({
          to: recipient,
          subject: `Order Confirmation - Spare Parts Portal (Order Ref: ${order.id})`,
          text: `Your order ${order.id} has been submitted.`,
          html: renderRequesterConfirmationEmail({ order, requestingPlantId, requesterEmail: recipient }),
          from: sender
        });
        result.confirmationSent += 1;
      } catch (error) {
        console.warn(`[Order Email] Requester confirmation failed (${recipient}): ${error.message}`);
        result.errors.push('Requester confirmation delivery failed.');
      }
    }
  }

  const targetFailed = result.targetSent < result.targetRecipientCount;
  result.status = result.targetRecipientCount === 0 ? 'no_recipients' : targetFailed ? 'failed' : 'sent';
  if (result.status === 'no_recipients') result.errors.unshift(`No active registered users with email addresses for ${targetPlantId}.`);
  result.reason = result.errors.join(' ') || null;
  return result;
}

export async function updateOrderEmailStatus(admin, orderId, status, reason = null) {
  if (!orderId) return;
  const ref = admin.firestore().collection('orders').doc(String(orderId));
  const snapshot = await ref.get();
  if (!snapshot.exists) return;
  await ref.update({ emailStatus: status, emailStatusReason: reason, emailStatusUpdatedAt: Date.now() });
}

export function getOrderPlantIds(order, requestingPlant) {
  const item = (order.items || []).find(entry => entry?.fromFactory);
  if (!item) throw new Error('Order does not include an item with a target plant.');
  const targetPlantId = normalizePlantId(item.fromFactory);
  const requestingPlantId = normalizePlantId(requestingPlant || order.userFactory);
  return { targetPlantId, requestingPlantId };
}

export function normalizeRequesterEmail(user, fallback) {
  const email = user?.email || (validEmail(user?.username) ? user.username : '') || (validEmail(fallback) ? fallback : '');
  return validEmail(email) ? email.trim() : '';
}
