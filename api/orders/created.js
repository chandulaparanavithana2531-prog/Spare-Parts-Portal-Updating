import { generateCustomerConfirmationEmail, generatePlantNotificationEmail } from '../../emailQueue.js';
import { syncOrderToSheet } from '../../services/googleSheets.js';
import { requireUser } from '../_lib/auth.js';
import { getAdmin } from '../_lib/firebaseAdmin.js';
import { getMailer, getSender, getAppUrl, cleanRecipients } from '../_lib/mailer.js';
import { createActionToken } from '../_lib/actionToken.js';
import { resolvePlantCanonical } from '../_lib/plants.js';

/** Emails of approved portal users who belong to the supplying plant. */
async function fetchPlantUserEmails(canonicalTarget) {
  if (!canonicalTarget) return [];
  const users = [];

  try {
    const admin = getAdmin();
    if (admin) {
      const snap = await admin.firestore().collection('users').get();
      snap.forEach((d) => users.push(d.data()));
    } else if (process.env.VITE_FIREBASE_API_KEY && process.env.VITE_FIREBASE_PROJECT_ID) {
      // Transition mode only (works while Firestore rules are still open)
      const url = `https://firestore.googleapis.com/v1/projects/${process.env.VITE_FIREBASE_PROJECT_ID}/databases/(default)/documents/users?pageSize=300&key=${process.env.VITE_FIREBASE_API_KEY}`;
      const r = await fetch(url);
      if (r.ok) {
        const data = await r.json();
        (data.documents || []).forEach((doc) => {
          const f = doc.fields || {};
          users.push({
            factoryAffiliation: f.factoryAffiliation?.stringValue,
            approved: f.approved?.booleanValue,
            email: f.email?.stringValue,
            username: f.username?.stringValue,
          });
        });
      }
    }
  } catch (err) {
    console.warn('[Order Created] Plant user lookup failed:', err.message);
  }

  return cleanRecipients(
    users
      .filter((u) => u.approved !== false && u.factoryAffiliation && resolvePlantCanonical(u.factoryAffiliation) === canonicalTarget)
      .map((u) => u.email || u.username)
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  const caller = await requireUser(req, res);
  if (!caller) return;

  try {
    const { order, userEmail, plantEmail, userFactory } = req.body || {};
    if (!order || !Array.isArray(order.items) || order.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Missing order data' });
    }

    const mailer = getMailer();
    const from = getSender();
    const replyTo = process.env.SMTP_REPLY_TO || process.env.SMTP_USER;
    const appUrl = getAppUrl();

    const recipientUser = cleanRecipients(userEmail || order.userEmail || order.requestedBy)[0] || '';
    const targetFactory = order.items[0].fromFactory || '';
    const canonicalTarget = resolvePlantCanonical(targetFactory);

    let plantRecipients = await fetchPlantUserEmails(canonicalTarget);
    if (!plantRecipients.length) plantRecipients = cleanRecipients(plantEmail || order.plantEmail);

    const isCrossPlant = resolvePlantCanonical(targetFactory) !== resolvePlantCanonical(userFactory);
    const estimatedTimeframe = isCrossPlant ? '5 Business Days (Cross-Plant Transfer)' : '2 Business Days (Local Fulfillment)';

    // Signed one-click links when ACTION_SECRET is set; otherwise send them to the portal
    const portalOrdersUrl = `${appUrl}/orders?orderId=${encodeURIComponent(order.id)}`;
    const approveToken = createActionToken(order.id, 'approve');
    const rejectToken = createActionToken(order.id, 'reject');
    const approveUrl = approveToken && appUrl
      ? `${appUrl}/api/orders/action?orderId=${encodeURIComponent(order.id)}&action=approve&token=${approveToken}`
      : portalOrdersUrl;
    const rejectUrl = rejectToken && appUrl
      ? `${appUrl}/api/orders/action?orderId=${encodeURIComponent(order.id)}&action=reject&token=${rejectToken}`
      : portalOrdersUrl;

    const results = { customer: 'skipped', plant: 'skipped' };
    const errors = [];

    if (recipientUser) {
      try {
        await mailer.sendMail({
          from, replyTo, to: recipientUser,
          subject: `Order Confirmation - Spare Parts Portal (Order Ref: ${order.id})`,
          text: `Hello ${recipientUser},\n\nYour order has been placed.\nOrder ID: ${order.id}\nEstimated fulfillment: ${estimatedTimeframe}`,
          html: generateCustomerConfirmationEmail(order, recipientUser, estimatedTimeframe),
        });
        results.customer = 'sent';
      } catch (err) {
        results.customer = 'failed';
        errors.push(`Customer email failed: ${err.message}`);
      }
    }

    if (plantRecipients.length) {
      try {
        await mailer.sendMail({
          from, replyTo, to: plantRecipients.join(', '),
          subject: `Action Required: New Spare Part Request (Order Ref: ${order.id})`,
          text: `Hello,\n\nA new spare part request has been raised against ${canonicalTarget} inventory.\nOrder ID: ${order.id}\nRequested by: ${recipientUser}\n\nReview it here: ${portalOrdersUrl}`,
          html: generatePlantNotificationEmail(order, plantRecipients.join(', '), userFactory || 'Unknown Plant', recipientUser, approveUrl, rejectUrl),
        });
        results.plant = 'sent';
      } catch (err) {
        results.plant = 'failed';
        errors.push(`Plant email failed: ${err.message}`);
      }
    } else {
      results.plant = 'no-recipient';
      errors.push(`No approved portal user with an email address is registered for ${canonicalTarget || 'the supplying plant'}.`);
    }

    // Awaited so Vercel does not stop the function before the sheet is updated
    const sheetSync = await syncOrderToSheet(order).catch((err) => ({ success: false, message: err.message }));

    const ok = errors.length === 0;
    console[ok ? 'log' : 'warn'](`[Order Created] ${order.id}: customer=${results.customer}, plant=${results.plant} (${plantRecipients.join(', ') || 'none'})`, errors);
    return res.status(ok ? 200 : 502).json({
      success: ok,
      results,
      plantRecipients,
      sheetSync,
      message: ok ? `Request emailed to ${plantRecipients.join(', ')}` : errors.join(' | '),
    });
  } catch (err) {
    console.error('[Order Created Error]:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}
