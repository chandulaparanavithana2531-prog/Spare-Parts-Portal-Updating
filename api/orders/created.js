import { normalizePlantId, PLANT_IDS, PLANT_NAMES } from '../_lib/plants.js';
import { sendTransactionalEmail, escapeHtml, ensureRequiredServerEnv } from '../_lib/email.js';
import { createSignedActionUrl } from '../_lib/actions.js';
import { syncOrderToSheet } from '../../services/googleSheets.js';

async function getFirebaseAdmin() {
  const { default: admin } = await import('firebase-admin');
  if (!admin.apps.length) {
    const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountRaw) {
      throw new Error('Missing required environment variable: FIREBASE_SERVICE_ACCOUNT');
    }

    let serviceAccount;
    try {
      serviceAccount = JSON.parse(serviceAccountRaw);
    } catch (error) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT must be valid JSON.');
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id || process.env.VITE_FIREBASE_PROJECT_ID || 'spareshare-33986'
    });
  }

  return admin;
}

async function getActivePlantUsers(targetPlantId) {
  const plantId = normalizePlantId(targetPlantId);
  const admin = await getFirebaseAdmin();
  const snapshot = await admin.firestore().collection('users').get();
  const users = [];

  snapshot.forEach(doc => {
    const data = doc.data() || {};
    const email = data.email || data.username;
    const approved = data.approved !== false;
    const factoryAffiliation = data.factoryAffiliation || data.plant || data.factory;

    if (!approved || !factoryAffiliation || !email || !String(email).includes('@')) {
      return;
    }

    try {
      const userPlantId = normalizePlantId(factoryAffiliation, { allowUnknown: true });
      if (userPlantId === plantId) {
        users.push({
          ...data,
          email: String(email).trim()
        });
      }
    } catch {
      // Ignore unknown or malformed plant references so invalid data does not silently poison the recipient list.
    }
  });

  return Array.from(new Map(users.map(user => [String(user.email).toLowerCase(), user])).values());
}

async function persistOrderEmailStatus(orderId, status, reason) {
  if (!orderId) return;

  try {
    const admin = await getFirebaseAdmin();
    const orderRef = admin.firestore().collection('orders').doc(String(orderId));
    const existing = await orderRef.get();
    if (!existing.exists) {
      return;
    }
    await orderRef.update({
      emailStatus: status,
      emailStatusReason: reason || null,
      emailStatusUpdatedAt: Date.now()
    });
  } catch (error) {
    console.warn('[Order Email Status] Unable to update order status:', error.message);
  }
}

function renderPlantRequestEmail({ order, targetPlantId, requestingPlantId, requesterEmail, approveUrl, rejectUrl }) {
  const safeTargetPlant = escapeHtml(PLANT_NAMES[targetPlantId] || targetPlantId);
  const safeRequestingPlant = escapeHtml(PLANT_NAMES[requestingPlantId] || requestingPlantId || 'Unknown Plant');
  const safeRequesterEmail = escapeHtml(requesterEmail || 'Unknown requester');
  const safeOrderId = escapeHtml(order.id || 'Unknown order');
  const itemRows = (order.items || []).map(item => {
    const itemCode = escapeHtml(item.sparePartId || item.partNumber || item.materialNumber || 'N/A');
    const description = escapeHtml(item.sparePartDescription || 'N/A');
    const quantity = escapeHtml(String(item.quantity || 0));
    const imageHtml = item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${description}" style="max-width:140px;max-height:140px;border-radius:8px;" />` : '';
    return `
      <tr style="border-bottom:1px solid #334155;">
        <td style="padding:10px 0;color:#cbd5e1;width:35%;vertical-align:top;">Item Code:</td>
        <td style="padding:10px 0;color:#f59e0b;font-weight:700;vertical-align:top;">${itemCode}</td>
      </tr>
      <tr style="border-bottom:1px solid #334155;">
        <td style="padding:10px 0;color:#cbd5e1;width:35%;vertical-align:top;">Description:</td>
        <td style="padding:10px 0;color:#ffffff;vertical-align:top;">${description}</td>
      </tr>
      <tr style="border-bottom:1px solid #334155;">
        <td style="padding:10px 0;color:#cbd5e1;width:35%;vertical-align:top;">Requested Qty:</td>
        <td style="padding:10px 0;color:#ffffff;font-weight:700;vertical-align:top;">${quantity}</td>
      </tr>
      ${imageHtml ? `<tr style="border-bottom:1px solid #334155;"><td style="padding:10px 0;color:#cbd5e1;width:35%;vertical-align:top;">Image:</td><td style="padding:10px 0;">${imageHtml}</td></tr>` : ''}
    `;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#0b1120;font-family:Arial,sans-serif;color:#e2e8f0;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0b1120;padding:32px 12px;">
      <tr><td align="center">
        <table width="100%" max-width="640" cellpadding="0" cellspacing="0" style="background:#0f172a;border:1px solid #334155;border-radius:12px;padding:24px;">
          <tr><td><h1 style="margin:0 0 8px;color:#38bdf8;font-size:24px;">Spare Part Requisition Request</h1><p style="margin:0;font-size:12px;color:#94a3b8;">Official Dispatch from sparevone@gmail.com</p></td></tr>
          <tr><td style="padding-top:20px;font-size:15px;color:#cbd5e1;">A spare part requisition has been requested from <strong>${safeRequestingPlant}</strong> to <strong>${safeTargetPlant}</strong>.</td></tr>
          <tr><td style="padding-top:18px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-collapse:collapse;">
              <tr style="border-bottom:1px solid #334155;"><td style="padding:10px 0;color:#cbd5e1;width:35%;">Order ID:</td><td style="padding:10px 0;color:#fff;font-weight:700;">${safeOrderId}</td></tr>
              <tr style="border-bottom:1px solid #334155;"><td style="padding:10px 0;color:#cbd5e1;width:35%;">Requesting Plant:</td><td style="padding:10px 0;color:#38bdf8;font-weight:700;">${safeRequestingPlant}</td></tr>
              ${itemRows}
              <tr style="border-bottom:1px solid #334155;"><td style="padding:10px 0;color:#cbd5e1;width:35%;">Requester:</td><td style="padding:10px 0;color:#fff;">${safeRequesterEmail}</td></tr>
              <tr style="border-bottom:1px solid #334155;"><td style="padding:10px 0;color:#cbd5e1;width:35%;">Requested On:</td><td style="padding:10px 0;color:#fff;">${new Date(order.createdAt || Date.now()).toLocaleString()}</td></tr>
              <tr style="border-bottom:1px solid #334155;"><td style="padding:10px 0;color:#cbd5e1;width:35%;">Notes:</td><td style="padding:10px 0;color:#fff;">${escapeHtml(order.notes || 'No notes provided')}</td></tr>
            </table>
          </td></tr>
          <tr><td style="padding-top:24px;">
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="padding-right:12px;"><a href="${approveUrl}" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">✓ Approve</a></td>
              <td><a href="${rejectUrl}" style="display:inline-block;background:#ef4444;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">✕ Reject</a></td>
            </tr></table>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

function renderRequesterConfirmationEmail({ order, requestingPlantId, requesterEmail }) {
  const safeRequestingPlant = escapeHtml(PLANT_NAMES[requestingPlantId] || requestingPlantId || 'Unknown Plant');
  const safeRequesterEmail = escapeHtml(requesterEmail || 'Unknown requester');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#0b1120;font-family:Arial,sans-serif;color:#e2e8f0;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0b1120;padding:32px 12px;">
      <tr><td align="center">
        <table width="100%" max-width="640" cellpadding="0" cellspacing="0" style="background:#0f172a;border:1px solid #334155;border-radius:12px;padding:24px;">
          <tr><td><h1 style="margin:0 0 8px;color:#38bdf8;font-size:24px;">Order Submitted</h1><p style="margin:0;font-size:12px;color:#94a3b8;">Official Dispatch from sparevone@gmail.com</p></td></tr>
          <tr><td style="padding-top:20px; font-size:15px; color:#cbd5e1;">Your request from <strong>${safeRequestingPlant}</strong> has been submitted successfully.</td></tr>
          <tr><td style="padding-top:18px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
              <tr><td style="padding:10px 0;color:#cbd5e1;width:35%;">Order ID:</td><td style="padding:10px 0;color:#fff;font-weight:700;">${escapeHtml(order.id || 'Unknown order')}</td></tr>
              <tr><td style="padding:10px 0;color:#cbd5e1;width:35%;">Requester:</td><td style="padding:10px 0;color:#fff;">${safeRequesterEmail}</td></tr>
              <tr><td style="padding:10px 0;color:#cbd5e1;width:35%;">Plant:</td><td style="padding:10px 0;color:#fff;">${safeRequestingPlant}</td></tr>
            </table>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    ensureRequiredServerEnv();
    const { order, userEmail, plantEmail, userFactory } = req.body || {};
    if (!order) {
      return res.status(400).json({ success: false, message: 'Missing order data' });
    }

    const targetItem = (order.items || []).find(item => item && item.fromFactory);
    if (!targetItem) {
      const reason = 'Order does not include a valid plant item reference.';
      await persistOrderEmailStatus(order.id, 'failed', reason);
      return res.status(200).json({ success: false, emailStatus: 'failed', message: reason });
    }

    const targetPlantId = normalizePlantId(targetItem.fromFactory);
    const requestingPlantId = normalizePlantId(userFactory || order.userFactory || order.requestedBy || 'Unknown Plant', { allowUnknown: true }) || PLANT_IDS.LT;
    const requesterEmail = userEmail || order.userEmail || order.requestedBy;

    const targetRecipients = await getActivePlantUsers(targetPlantId);
    if (!targetRecipients.length) {
      const reason = `No active target-plant users found for ${targetPlantId}.`;
      await persistOrderEmailStatus(order.id, 'no_recipients', reason);
      return res.status(200).json({ success: false, emailStatus: 'no_recipients', message: reason });
    }

    const baseUrl = process.env.APP_URL || 'https://localhost:3000';
    const approveUrl = createSignedActionUrl(order.id, 'approve', baseUrl, process.env.ACTION_SECRET);
    const rejectUrl = createSignedActionUrl(order.id, 'reject', baseUrl, process.env.ACTION_SECRET);

    const plantHtml = renderPlantRequestEmail({
      order,
      targetPlantId,
      requestingPlantId,
      requesterEmail,
      approveUrl,
      rejectUrl
    });

    const plantErrors = [];
    for (const recipient of targetRecipients) {
      try {
        await sendTransactionalEmail({
          to: recipient.email,
          subject: `Action Required: New Work Order Dispatch (Order Ref: ${order.id})`,
          text: `Order ${order.id} requires action from ${targetPlantId}.`,
          html: plantHtml,
          from: 'SpareShare Enterprise Portal <sparevone@gmail.com>'
        });
      } catch (error) {
        plantErrors.push({ email: recipient.email, reason: error.message });
      }
    }

    const requesterUsers = await getActivePlantUsers(requestingPlantId).catch(() => []);
    const requesterToSend = Array.from(new Map([...(requesterUsers || []), ...(requesterEmail && requesterEmail.includes('@') ? [{ email: requesterEmail }] : [])].map(user => [String(user.email).toLowerCase(), user])).values());

    const requesterErrors = [];
    for (const requester of requesterToSend) {
      try {
        await sendTransactionalEmail({
          to: requester.email,
          subject: `Order Confirmation - Spare Parts Portal (Order Ref: ${order.id})`,
          text: `Your order ${order.id} has been submitted.`,
          html: renderRequesterConfirmationEmail({ order, requestingPlantId, requesterEmail: requester.email }),
          from: 'SpareShare Enterprise Portal <sparevone@gmail.com>'
        });
      } catch (error) {
        requesterErrors.push({ email: requester.email, reason: error.message });
      }
    }

    const hasAnyPlantSend = plantErrors.length < targetRecipients.length;
    const anyRequesterSend = requesterErrors.length < requesterToSend.length;

    if (!hasAnyPlantSend && !anyRequesterSend) {
      const reason = plantErrors[0]?.reason || requesterErrors[0]?.reason || 'Email delivery failed for all recipients.';
      await persistOrderEmailStatus(order.id, 'failed', reason);
      return res.status(200).json({ success: false, emailStatus: 'failed', message: reason, errors: [...plantErrors, ...requesterErrors] });
    }

    await persistOrderEmailStatus(order.id, 'sent', hasAnyPlantSend ? `${targetRecipients.length - plantErrors.length} plant request emails sent` : 'Requester confirmation sent');
    syncOrderToSheet(order).catch(err => console.warn('[Order Email API] Sheet sync warning:', err.message));

    return res.status(200).json({
      success: true,
      emailStatus: 'sent',
      targetPlantId,
      targetRecipients: targetRecipients.map(user => user.email),
      requesterRecipients: requesterToSend.map(user => user.email),
      message: 'Order request and confirmation emails processed.'
    });
  } catch (error) {
    console.warn('[Order Email API] Failed to process order email flow:', error.message);
    const order = req.body && req.body.order ? req.body.order : null;
    if (order && order.id) {
      await persistOrderEmailStatus(order.id, 'failed', error.message).catch(() => {});
    }
    return res.status(200).json({
      success: false,
      emailStatus: 'failed',
      message: error.message
    });
  }
}
