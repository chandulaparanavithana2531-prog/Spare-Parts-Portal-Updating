import nodemailer from 'nodemailer';
import { generateCustomerConfirmationEmail, generatePlantNotificationEmail } from '../../emailQueue.js';
import { syncOrderToSheet } from '../../services/googleSheets.js';

const PLANT_EMAILS = {
  'Lanka Tiles': 'lankatiles.admin@gmail.com',
  'LT': 'lankatiles.admin@gmail.com',
  'Lanka Wall Tiles': 'lankawalltiles.admin@gmail.com',
  'LWT': 'lankawalltiles.admin@gmail.com',
  'Rocell Horana': 'rocellhorana.admin@gmail.com',
  'RCLH': 'rocellhorana.admin@gmail.com',
  'RCL-H': 'rocellhorana.admin@gmail.com',
  'Rocell Eheliyagoda': 'rocelleheliyagoda.admin@gmail.com',
  'RCLE': 'rocelleheliyagoda.admin@gmail.com',
  'RCL-E': 'rocelleheliyagoda.admin@gmail.com'
};

function resolvePlantCanonical(rawName) {
  if (!rawName) return 'Lanka Tiles';
  const s = String(rawName).trim().toLowerCase();
  if (s === 'lwt' || (s.includes('lanka') && s.includes('wall'))) return 'Lanka Wall Tiles';
  if (s === 'lt' || (s.includes('lanka') && (s.includes('tile') || s.includes('lt')))) return 'Lanka Tiles';
  if (s === 'rcl-h' || s === 'rclh' || s.includes('horana')) return 'Rocell Horana';
  if (s === 'rcl-e' || s === 'rcle' || s.includes('eheliyagoda') || s === 'gsc') return 'Rocell Eheliyagoda';
  return rawName;
}

/**
 * Fetch registered target plant user emails directly from Firestore REST API
 */
async function fetchTargetPlantEmails(canonicalTarget) {
  try {
    const FIREBASE_PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || 'spareshare-33986';
    const FIREBASE_WEB_API_KEY = process.env.VITE_FIREBASE_API_KEY || 'AIzaSyAMl2OrlGj_O9qeh02KeKuw6lA_pZLG4XM';
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users?key=${FIREBASE_WEB_API_KEY}`;
    
    const res = await fetch(url);
    if (!res.ok) return [];
    
    const data = await res.json();
    if (!data.documents || !Array.isArray(data.documents)) return [];
    
    const emails = [];
    data.documents.forEach(doc => {
      const fields = doc.fields || {};
      const plant = fields.factoryAffiliation?.stringValue;
      const approved = fields.approved?.booleanValue !== false;
      const email = fields.email?.stringValue || fields.username?.stringValue;
      
      if (approved && plant && resolvePlantCanonical(plant) === canonicalTarget) {
        if (email && email.includes('@')) {
          emails.push(email);
        }
      }
    });
    return Array.from(new Set(emails));
  } catch (err) {
    console.warn('[Vercel Order API] Firestore REST user fetch warning:', err.message);
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { order, userEmail, plantEmail, userFactory } = req.body || {};
    if (!order) {
      return res.status(400).json({ success: false, message: 'Missing order data' });
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

    const recipientUser = userEmail || order.userEmail || order.requestedBy || 'user@rcl.lk';
    const targetFactory = (order.items && order.items.length > 0 && order.items[0].fromFactory) ? order.items[0].fromFactory : '';
    const canonicalTarget = resolvePlantCanonical(targetFactory);

    let recipientPlant = plantEmail || order.plantEmail || '';

    // If plantEmail is missing or fallback generic, query Firestore REST API serverless
    if (!recipientPlant || recipientPlant.includes('admin@gmail.com') || recipientPlant.includes('sparevone@gmail.com')) {
      const fetchedEmails = await fetchTargetPlantEmails(canonicalTarget);
      if (fetchedEmails.length > 0) {
        recipientPlant = fetchedEmails.join(', ');
        console.log(`[Vercel Order API] Target plant (${canonicalTarget}) emails resolved via REST API: ${recipientPlant}`);
      }
    }

    if (!recipientPlant) {
      recipientPlant = PLANT_EMAILS[canonicalTarget] || PLANT_EMAILS[targetFactory] || 'sparevone@gmail.com';
    }

    // 1. Calculate Estimated Timeframe
    const isCrossPlant = order.items && order.items.length > 0 && order.items[0].fromFactory !== userFactory;
    const estimatedTimeframe = isCrossPlant ? '5 Business Days (Cross-Plant Transfer)' : '2 Business Days (Local Fulfillment)';

    // 2. Build Email Templates
    const apiUrl = process.env.VITE_API_URL || process.env.API_URL || 'https://spareshare-33986.web.app';
    const approveUrl = `${apiUrl}/api/orders/action?orderId=${encodeURIComponent(order.id)}&action=approve`;
    const rejectUrl  = `${apiUrl}/api/orders/action?orderId=${encodeURIComponent(order.id)}&action=reject`;

    const userHtml = generateCustomerConfirmationEmail(order, recipientUser, estimatedTimeframe);
    const plantHtml = generatePlantNotificationEmail(order, recipientPlant, userFactory || 'Unknown Plant', recipientUser, approveUrl, rejectUrl);

    const OFFICIAL_SENDER = '"SpareShare Enterprise Portal" <sparevone@gmail.com>';

    // 3. Send Customer Email
    if (recipientUser && recipientUser.includes('@')) {
      await transporter.sendMail({
        from: OFFICIAL_SENDER,
        replyTo: 'sparevone@gmail.com',
        to: recipientUser,
        subject: `Order Confirmation - Spare Parts Portal (Order Ref: ${order.id})`,
        text: `Hello ${recipientUser},\n\nYour order has been placed.\nOrder ID: ${order.id}\nEstimated fulfillment: ${estimatedTimeframe}`,
        html: userHtml,
      }).catch(err => console.warn('[Vercel Order API] Customer email error:', err.message));
    }

    // 4. Send Target Plant Requisition Email to created user account emails (e.g. buthminh@vallibel.com)
    if (recipientPlant) {
      await transporter.sendMail({
        from: OFFICIAL_SENDER,
        replyTo: 'sparevone@gmail.com',
        to: recipientPlant,
        subject: `Action Required: New Work Order Dispatch (Order Ref: ${order.id})`,
        text: `Hello Plant Manager,\n\nA new work order has been requested from your plant inventory.\nOrder ID: ${order.id}\nCustomer: ${recipientUser}`,
        html: plantHtml,
      }).catch(err => console.warn('[Vercel Order API] Plant requisition email error:', err.message));
    }

    // 5. Sync to Google Sheets (non-blocking)
    syncOrderToSheet(order).catch(err => {
      console.warn('[Vercel Order API] Google Sheets sync warning:', err.message);
    });

    console.log(`[Vercel Order API Success] Dispatched requisition request email from sparevone@gmail.com to target plant (${recipientPlant}) and user confirmation to ${recipientUser}`);
    return res.status(200).json({
      success: true,
      message: `Requisition request dispatched from sparevone@gmail.com to target plant (${recipientPlant}) and user confirmation sent to ${recipientUser}`
    });
  } catch (err) {
    console.error('[Vercel Order API Error]:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}
