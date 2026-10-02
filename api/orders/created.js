import admin from 'firebase-admin';
import nodemailer from 'nodemailer';
import { generateCustomerConfirmationEmail, generatePlantNotificationEmail } from '../../emailQueue.js';
import { syncOrderToSheet } from '../../services/googleSheets.js';

let firestoreDb = null;
try {
  if (!admin.apps.length) {
    const projectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || 'spareshare-33986';
    admin.initializeApp({ projectId });
  }
  firestoreDb = admin.firestore();
} catch (e) {
  console.warn('[Vercel Order API] Firebase Admin notice:', e.message);
}

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

    // Dynamically query Firestore users collection to find all created user account emails for the target plant
    if (firestoreDb && canonicalTarget) {
      try {
        const usersSnap = await firestoreDb.collection('users').get();
        const plantUserEmails = [];
        usersSnap.forEach(docSnap => {
          const uData = docSnap.data();
          if (uData.factoryAffiliation && resolvePlantCanonical(uData.factoryAffiliation) === canonicalTarget) {
            const email = uData.email || uData.username;
            if (email && email.includes('@')) {
              plantUserEmails.push(email);
            }
          }
        });
        if (plantUserEmails.length > 0) {
          recipientPlant = Array.from(new Set(plantUserEmails)).join(', ');
          console.log(`[Vercel Order API] Target plant (${canonicalTarget}) registered user account emails: ${recipientPlant}`);
        }
      } catch (e) {
        console.warn('[Vercel Order API] Firestore target user lookup error:', e.message);
      }
    }

    if (!recipientPlant) {
      recipientPlant = PLANT_EMAILS[canonicalTarget] || PLANT_EMAILS[targetFactory] || 'sparevone@gmail.com';
    }

    // 1. Calculate Estimated Timeframe
    const isCrossPlant = order.items && order.items.length > 0 && order.items[0].fromFactory !== userFactory;
    const estimatedTimeframe = isCrossPlant ? '5 Business Days (Cross-Plant Transfer)' : '2 Business Days (Local Fulfillment)';

    // 2. Build Email Templates
    const userHtml = generateCustomerConfirmationEmail(order, recipientUser, estimatedTimeframe);
    const plantHtml = generatePlantNotificationEmail(order, recipientPlant, userFactory || 'Unknown Plant', recipientUser);

    // 3. Send Customer Email
    if (recipientUser && recipientUser.includes('@')) {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || `"SpareShare Portal" <${smtpUser}>`,
        to: recipientUser,
        subject: `Order Confirmation - Spare Parts Portal (Order Ref: ${order.id})`,
        text: `Hello ${recipientUser},\n\nYour order has been placed.\nOrder ID: ${order.id}\nEstimated fulfillment: ${estimatedTimeframe}`,
        html: userHtml,
      }).catch(err => console.warn('[Vercel Order API] Customer email error:', err.message));
    }

    // 4. Send Target Plant Requisition Email to created user account emails
    if (recipientPlant) {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || `"SpareShare Operations" <${smtpUser}>`,
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

    console.log(`[Vercel Order API Success] Dispatched requisition request email to target plant user accounts: ${recipientPlant}`);
    return res.status(200).json({
      success: true,
      message: `Requisition request dispatched to target plant user accounts (${recipientPlant}) and user confirmation sent to ${recipientUser}`
    });
  } catch (err) {
    console.error('[Vercel Order API Error]:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}
