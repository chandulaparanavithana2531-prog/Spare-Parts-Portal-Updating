import nodemailer from 'nodemailer';
import { generateCustomerConfirmationEmail, generatePlantNotificationEmail } from '../../emailQueue.js';
import { syncOrderToSheet } from '../../services/googleSheets.js';

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
    const recipientPlant = plantEmail || order.plantEmail || 'sparevone@gmail.com';

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

    // 4. Send Target Plant Requisition Email (to created user account email addresses for target plant)
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

    console.log(`[Vercel Order API Success] Dispatched requisition email to target plant: ${recipientPlant} and user confirmation to: ${recipientUser}`);
    return res.status(200).json({
      success: true,
      message: `Requisition request dispatched to target plant (${recipientPlant}) and user confirmation sent to ${recipientUser}`
    });
  } catch (err) {
    console.error('[Vercel Order API Error]:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}
