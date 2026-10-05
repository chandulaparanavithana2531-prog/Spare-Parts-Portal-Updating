import EventEmitter from 'events';

// Create a singleton Event Emitter for ordering events
export const orderEventEmitter = new EventEmitter();

// Define status constants
export const JOB_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  RETRYING: 'RETRYING',
  FAILED: 'FAILED'
};

// Asynchronous Email Queue Manager
export class EmailQueue {
  constructor(transporter, options = {}) {
    this.transporter = transporter;
    this.maxRetries = options.maxRetries || 3;
    this.initialBackoffMs = options.initialBackoffMs || 1000;
    this.queue = [];
    this.isProcessing = false;
    this.jobsProcessedCount = 0;
    this.jobsFailedCount = 0;
  }

  // Add an email job to the queue
  addJob(mailOptions) {
    const job = {
      id: `job-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      mailOptions,
      status: JOB_STATUS.PENDING,
      attempts: 0,
      errors: [],
      addedAt: Date.now()
    };
    this.queue.push(job);
    console.log(`[Email Queue] Job ${job.id} added. Recipient: ${mailOptions.to}. Queue size: ${this.queue.length}`);
    
    // Process queue asynchronously in background (do not block the caller)
    this.processQueue();
    return job;
  }

  // Background processing worker loop
  async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.some(j => j.status === JOB_STATUS.PENDING)) {
      const job = this.queue.find(j => j.status === JOB_STATUS.PENDING);
      if (!job) break;

      job.status = JOB_STATUS.PROCESSING;
      console.log(`[Email Queue] Processing job ${job.id} (Attempt ${job.attempts + 1}/${this.maxRetries})...`);

      try {
        await this.sendMailWithTimeout(job.mailOptions, 10000);
        job.status = JOB_STATUS.SUCCESS;
        job.processedAt = Date.now();
        this.jobsProcessedCount++;
        console.log(`[Email Queue] Job ${job.id} sent successfully to ${job.mailOptions.to}.`);
      } catch (error) {
        job.attempts++;
        job.errors.push({
          timestamp: Date.now(),
          message: error.message
        });

        console.error(`[Email Queue] Error sending job ${job.id} to ${job.mailOptions.to}: ${error.message}`);

        if (job.attempts < this.maxRetries) {
          job.status = JOB_STATUS.RETRYING;
          const backoffDelay = this.initialBackoffMs * Math.pow(2, job.attempts - 1);
          console.log(`[Email Queue] Scheduling retry for job ${job.id} in ${backoffDelay}ms...`);
          
          setTimeout(() => {
            job.status = JOB_STATUS.PENDING;
            this.processQueue();
          }, backoffDelay);
        } else {
          job.status = JOB_STATUS.FAILED;
          job.failedAt = Date.now();
          this.jobsFailedCount++;
          console.error(`[Email Queue] Job ${job.id} failed permanently after ${this.maxRetries} attempts.`);
        }
      }
    }

    this.isProcessing = false;
  }

  // Wrapper to send mail with timeout guard
  sendMailWithTimeout(mailOptions, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('SMTP connection timed out'));
      }, timeoutMs);

      // Check if we are running in mock/console mode
      const isMockEmail = !this.transporter || 
        (this.transporter.options && 
         (this.transporter.options.host === 'smtp.ethereal.email' || !this.transporter.options.auth?.pass));

      if (isMockEmail) {
        clearTimeout(timeout);
        console.log('\n================= BACKEND MOCK EMAIL QUEUED & SENT =================');
        console.log(`Job ID:  [Mock Transport]`);
        console.log(`To:      ${mailOptions.to}`);
        console.log(`Subject: ${mailOptions.subject}`);
        console.log(`Body (Text Length): ${mailOptions.text ? mailOptions.text.length : 0} chars`);
        if (mailOptions.html) {
          console.log(`Body (HTML Snippet): ${mailOptions.html.substring(0, 150)}...`);
        }
        console.log('==================================================================\n');
        resolve({ mock: true });
        return;
      }

      this.transporter.sendMail(mailOptions, (err, info) => {
        clearTimeout(timeout);
        if (err) reject(err);
        else resolve(info);
      });
    });
  }
}

// Format Sri Lankan Rupees (Rs.)
export const formatCurrency = (val) => {
  return `Rs. ${new Intl.NumberFormat('en-LK', { maximumFractionDigits: 0 }).format(val)}`;
};

// Generate HTML email templates with premium dark-mode aesthetics matching exact requisition layout
export function generateCustomerConfirmationEmail(order, userEmail, estimatedTimeframe) {
  const timestampString = new Date(order.createdAt || Date.now()).toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const sourcePlant = (order.items && order.items.length > 0 && order.items[0].fromFactory) ? order.items[0].fromFactory : 'LT';
  const requestingPlant = order.userFactory || 'RCL-E';
  const appUrl = process.env.VITE_APP_URL || process.env.APP_URL || 'https://spareshare-33986.web.app';

  const itemRows = (order.items || []).map(item => {
    const itemCode = item.sparePartId ? (item.sparePartId.includes('-') ? item.sparePartId : item.sparePartId) : 'N/A';
    return `
      <tr style="border-bottom: 1px solid #334155;">
        <td style="padding: 10px 0; color: #cbd5e1; width: 35%; vertical-align: top;">Item Code:</td>
        <td style="padding: 10px 0; color: #f59e0b; font-weight: 700; vertical-align: top;">${itemCode}</td>
      </tr>
      <tr style="border-bottom: 1px solid #334155;">
        <td style="padding: 10px 0; color: #cbd5e1; width: 35%; vertical-align: top;">Description:</td>
        <td style="padding: 10px 0; color: #ffffff; vertical-align: top;">${item.sparePartDescription}</td>
      </tr>
      <tr style="border-bottom: 1px solid #334155;">
        <td style="padding: 10px 0; color: #cbd5e1; width: 35%; vertical-align: top;">Requested Qty:</td>
        <td style="padding: 10px 0; color: #ffffff; font-weight: 700; vertical-align: top;">${item.quantity}</td>
      </tr>
    `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Spare Part Requisition Request</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #0b1120; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #e2e8f0;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #0b1120; padding: 30px 10px;">
        <tr>
          <td align="center">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #0f172a; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); padding: 28px 24px;">
              <!-- Header -->
              <tr>
                <td style="padding-bottom: 12px;">
                  <h1 style="margin: 0 0 6px 0; font-size: 22px; font-weight: 700; color: #38bdf8;">
                    📦 Spare Part Requisition Request
                  </h1>
                  <p style="margin: 0; font-size: 13px; color: #94a3b8;">
                    Official Dispatch from sparevone@gmail.com
                  </p>
                </td>
              </tr>

              <!-- Horizontal Rule -->
              <tr>
                <td style="border-bottom: 1px solid #334155; padding-bottom: 4px;"></td>
              </tr>

              <!-- Intro Statement -->
              <tr>
                <td style="padding: 18px 0 14px 0; font-size: 15px; color: #cbd5e1; line-height: 1.5;">
                  A spare part requisition has been requested from <strong style="color: #ffffff;">${sourcePlant}</strong> by <strong style="color: #ffffff;">${requestingPlant}</strong>:
                </td>
              </tr>

              <!-- Key Value Table -->
              <tr>
                <td>
                  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; font-size: 14px;">
                    <tr style="border-bottom: 1px solid #334155;">
                      <td style="padding: 10px 0; color: #cbd5e1; width: 35%; vertical-align: top;">Order ID:</td>
                      <td style="padding: 10px 0; color: #ffffff; font-weight: 700; vertical-align: top;">${order.id}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #334155;">
                      <td style="padding: 10px 0; color: #cbd5e1; width: 35%; vertical-align: top;">Requesting Plant:</td>
                      <td style="padding: 10px 0; color: #38bdf8; font-weight: 700; vertical-align: top;">${requestingPlant}</td>
                    </tr>
                    ${itemRows}
                    <tr style="border-bottom: 1px solid #334155;">
                      <td style="padding: 10px 0; color: #cbd5e1; width: 35%; vertical-align: top;">Requester:</td>
                      <td style="padding: 10px 0; color: #ffffff; vertical-align: top;">${userEmail}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #334155;">
                      <td style="padding: 10px 0; color: #cbd5e1; width: 35%; vertical-align: top;">Estimated Timeframe:</td>
                      <td style="padding: 10px 0; color: #10b981; font-weight: 600; vertical-align: top;">${estimatedTimeframe}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #334155;">
                      <td style="padding: 10px 0; color: #cbd5e1; width: 35%; vertical-align: top;">Total Amount:</td>
                      <td style="padding: 10px 0; color: #ffffff; font-weight: 700; vertical-align: top;">${formatCurrency(order.totalValue)}</td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Footer notice -->
              <tr>
                <td style="padding-top: 24px; text-align: center; color: #64748b; font-size: 12px;">
                  © ${new Date().getFullYear()} SpareShare Operations Portal. Official Order Confirmation.
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

export function generatePlantNotificationEmail(order, plantEmail, customerFactory, userEmail, approveUrlOverride, rejectUrlOverride) {
  const plantShortNameMap = {
    'Lanka Tiles': 'LT',
    'LT': 'LT',
    'Lanka Wall Tiles': 'LWT',
    'LWT': 'LWT',
    'Rocell Horana': 'RCL-H',
    'RCLH': 'RCL-H',
    'RCL-H': 'RCL-H',
    'Rocell Eheliyagoda': 'RCL-E',
    'RCLE': 'RCL-E',
    'RCL-E': 'RCL-E'
  };

  const rawSource = (order.items && order.items.length > 0 && order.items[0].fromFactory) ? order.items[0].fromFactory : 'LT';
  const sourcePlant = plantShortNameMap[rawSource] || rawSource;

  const rawRequesting = customerFactory || order.userFactory || 'RCL-E';
  const requestingPlant = plantShortNameMap[rawRequesting] || rawRequesting;

  const requester = userEmail || order.requestedBy || 'user@rcl.lk';
  const appUrl = process.env.VITE_APP_URL || process.env.APP_URL || 'https://spareshare-33986.web.app';
  const apiUrl = process.env.VITE_API_URL || process.env.API_URL || 'http://localhost:3000';

  const approveUrl = approveUrlOverride || `${apiUrl}/api/orders/action?orderId=${encodeURIComponent(order.id)}&action=approve`;
  const rejectUrl  = rejectUrlOverride  || `${apiUrl}/api/orders/action?orderId=${encodeURIComponent(order.id)}&action=reject`;

  const itemRows = (order.items || []).map(item => {
    const itemCode = item.sparePartId || item.partNumber || item.materialNumber || 'N/A';
    const imagePreview = (item.imageUrl || item.image_url) ? `
      <tr style="border-bottom: 1px solid #334155;">
        <td style="padding: 10px 0; color: #cbd5e1; width: 35%; vertical-align: top;">Part Preview:</td>
        <td style="padding: 10px 0; color: #ffffff; vertical-align: top;">
          <img src="${item.imageUrl || item.image_url}" alt="${item.sparePartDescription}" style="max-width: 140px; max-height: 140px; border-radius: 8px; border: 1px solid #334155; object-fit: contain; background: #1e293b;" />
        </td>
      </tr>
    ` : '';

    return `
      <tr style="border-bottom: 1px solid #334155;">
        <td style="padding: 10px 0; color: #cbd5e1; width: 35%; vertical-align: top;">Item Code:</td>
        <td style="padding: 10px 0; color: #f59e0b; font-weight: 700; vertical-align: top;">${itemCode}</td>
      </tr>
      <tr style="border-bottom: 1px solid #334155;">
        <td style="padding: 10px 0; color: #cbd5e1; width: 35%; vertical-align: top;">Description:</td>
        <td style="padding: 10px 0; color: #ffffff; vertical-align: top;">${item.sparePartDescription}</td>
      </tr>
      ${imagePreview}
      <tr style="border-bottom: 1px solid #334155;">
        <td style="padding: 10px 0; color: #cbd5e1; width: 35%; vertical-align: top;">Requested Qty:</td>
        <td style="padding: 10px 0; color: #ffffff; font-weight: 700; vertical-align: top;">${item.quantity}</td>
      </tr>
    `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Spare Part Requisition Request</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #0b1120; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #e2e8f0;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #0b1120; padding: 30px 10px;">
        <tr>
          <td align="center">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #0f172a; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); padding: 28px 24px;">
              <!-- Header -->
              <tr>
                <td style="padding-bottom: 12px;">
                  <h1 style="margin: 0 0 6px 0; font-size: 22px; font-weight: 700; color: #38bdf8;">
                    📦 Spare Part Requisition Request
                  </h1>
                  <p style="margin: 0; font-size: 13px; color: #94a3b8;">
                    Official Dispatch from sparevone@gmail.com
                  </p>
                </td>
              </tr>

              <!-- Horizontal Rule -->
              <tr>
                <td style="border-bottom: 1px solid #334155; padding-bottom: 4px;"></td>
              </tr>

              <!-- Intro Statement -->
              <tr>
                <td style="padding: 18px 0 14px 0; font-size: 15px; color: #cbd5e1; line-height: 1.5;">
                  A spare part requisition has been requested from <strong style="color: #ffffff;">${sourcePlant}</strong> by <strong style="color: #ffffff;">${requestingPlant}</strong>:
                </td>
              </tr>

              <!-- Details Table -->
              <tr>
                <td>
                  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; font-size: 14px;">
                    <tr style="border-bottom: 1px solid #334155;">
                      <td style="padding: 10px 0; color: #cbd5e1; width: 35%; vertical-align: top;">Order ID:</td>
                      <td style="padding: 10px 0; color: #ffffff; font-weight: 700; vertical-align: top;">${order.id}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #334155;">
                      <td style="padding: 10px 0; color: #cbd5e1; width: 35%; vertical-align: top;">Requesting Plant:</td>
                      <td style="padding: 10px 0; color: #38bdf8; font-weight: 700; vertical-align: top;">${requestingPlant}</td>
                    </tr>
                    ${itemRows}
                    <tr style="border-bottom: 1px solid #334155;">
                      <td style="padding: 10px 0; color: #cbd5e1; width: 35%; vertical-align: top;">Requester:</td>
                      <td style="padding: 10px 0; color: #ffffff; vertical-align: top;">${requester}</td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Action Buttons -->
              <tr>
                <td style="padding-top: 28px;">
                  <table border="0" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding-right: 12px;">
                        <a href="${approveUrl}" target="_blank" style="background-color: #10b981; color: #ffffff; text-decoration: none; padding: 12px 22px; border-radius: 8px; font-weight: 700; font-size: 13px; display: inline-block; letter-spacing: 0.03em;">
                          ✓ APPROVE ORDER
                        </a>
                      </td>
                      <td>
                        <a href="${rejectUrl}" target="_blank" style="background-color: #ef4444; color: #ffffff; text-decoration: none; padding: 12px 22px; border-radius: 8px; font-weight: 700; font-size: 13px; display: inline-block; letter-spacing: 0.03em;">
                          ✕ REJECT ORDER
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Operations Checklist Note -->
              <tr>
                <td style="padding-top: 24px; border-top: 1px dashed #334155; margin-top: 20px;">
                  <div style="font-size: 12px; color: #94a3b8; line-height: 1.5;">
                    <strong style="color: #cbd5e1;">Operations Checklist:</strong> Verify inventory stock on shelf, inspect material quality, package and label with Order ID <strong style="color: #ffffff;">${order.id}</strong>. Contact plant manager at <span style="color: #38bdf8;">${plantEmail}</span> for questions.
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

export function generateOrderStatusUpdateEmail(order, item, newStatus, performerUsername) {
  const sourcePlant = item?.fromFactory || 'LT';
  const requestingPlant = order.userFactory || 'RCL-E';
  const itemCode = item?.sparePartId || 'N/A';
  const description = item?.sparePartDescription || 'N/A';
  const qty = item?.quantity || 1;
  const requester = order.requestedBy || 'user@rcl.lk';
  const statusLabel = (newStatus || '').toUpperCase();

  const statusColors = {
    approved: '#10b981',
    delivered: '#3b82f6',
    rejected: '#ef4444'
  };
  const statusColor = statusColors[newStatus] || '#f59e0b';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Spare Part Order Status Update</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #0b1120; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #e2e8f0;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #0b1120; padding: 30px 10px;">
        <tr>
          <td align="center">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #0f172a; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); padding: 28px 24px;">
              <!-- Header -->
              <tr>
                <td style="padding-bottom: 12px;">
                  <h1 style="margin: 0 0 6px 0; font-size: 22px; font-weight: 700; color: #38bdf8;">
                    📦 Spare Part Requisition Update
                  </h1>
                  <p style="margin: 0; font-size: 13px; color: #94a3b8;">
                    Official Dispatch from sparevone@gmail.com
                  </p>
                </td>
              </tr>

              <!-- Horizontal Rule -->
              <tr>
                <td style="border-bottom: 1px solid #334155; padding-bottom: 4px;"></td>
              </tr>

              <!-- Intro Statement -->
              <tr>
                <td style="padding: 18px 0 14px 0; font-size: 15px; color: #cbd5e1; line-height: 1.5;">
                  Order status updated by <strong style="color: #ffffff;">${performerUsername}</strong> for requisition requested from <strong style="color: #ffffff;">${sourcePlant}</strong> by <strong style="color: #ffffff;">${requestingPlant}</strong>:
                </td>
              </tr>

              <!-- Details Table -->
              <tr>
                <td>
                  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; font-size: 14px;">
                    <tr style="border-bottom: 1px solid #334155;">
                      <td style="padding: 10px 0; color: #cbd5e1; width: 35%; vertical-align: top;">Order ID:</td>
                      <td style="padding: 10px 0; color: #ffffff; font-weight: 700; vertical-align: top;">${order.id}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #334155;">
                      <td style="padding: 10px 0; color: #cbd5e1; width: 35%; vertical-align: top;">Status:</td>
                      <td style="padding: 10px 0; color: ${statusColor}; font-weight: 700; vertical-align: top;">${statusLabel}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #334155;">
                      <td style="padding: 10px 0; color: #cbd5e1; width: 35%; vertical-align: top;">Item Code:</td>
                      <td style="padding: 10px 0; color: #f59e0b; font-weight: 700; vertical-align: top;">${itemCode}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #334155;">
                      <td style="padding: 10px 0; color: #cbd5e1; width: 35%; vertical-align: top;">Description:</td>
                      <td style="padding: 10px 0; color: #ffffff; vertical-align: top;">${description}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #334155;">
                      <td style="padding: 10px 0; color: #cbd5e1; width: 35%; vertical-align: top;">Requested Qty:</td>
                      <td style="padding: 10px 0; color: #ffffff; font-weight: 700; vertical-align: top;">${qty}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #334155;">
                      <td style="padding: 10px 0; color: #cbd5e1; width: 35%; vertical-align: top;">Requester:</td>
                      <td style="padding: 10px 0; color: #ffffff; vertical-align: top;">${requester}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}


export function generate2FAEmail(username, otpCode) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>2-Step Verification Code</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f3f4f6; padding: 40px 10px;">
        <tr>
          <td align="center">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; background-color: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1);">
              <tr>
                <td style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 36px 30px; text-align: center; color: #ffffff;">
                  <div style="background: rgba(255,255,255,0.2); width: 56px; height: 56px; border-radius: 50%; display: inline-block; line-height: 56px; text-align: center; margin-bottom: 12px; font-size: 28px;">
                    &#128737;
                  </div>
                  <h1 style="margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.02em;">2-Step Verification Required</h1>
                  <p style="margin: 6px 0 0 0; font-size: 14px; color: #bfdbfe;">SpareShare Security Authentication</p>
                </td>
              </tr>
              <tr>
                <td style="padding: 32px 30px;">
                  <p style="margin: 0 0 16px 0; font-size: 15px; color: #374151; line-height: 1.6;">
                    Hello <strong>${username}</strong>,
                  </p>
                  <p style="margin: 0 0 24px 0; font-size: 14px; color: #4b5563; line-height: 1.6;">
                    You are signing into the SpareShare Inter-Factory Portal. Please use the following 6-digit verification passcode to complete your login:
                  </p>

                  <div style="background: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 16px; padding: 20px; text-align: center; margin-bottom: 24px;">
                    <div style="font-size: 36px; font-weight: 900; letter-spacing: 0.3em; color: #1e3a8a; font-family: monospace;">
                      ${otpCode}
                    </div>
                    <p style="margin: 8px 0 0 0; font-size: 12px; color: #64748b; font-weight: 600;">
                      &#9201; Valid for 5 minutes &bull; Do not share this code
                    </p>
                  </div>

                  <p style="margin: 0 0 20px 0; font-size: 13px; color: #6b7280; line-height: 1.5; text-align: center;">
                    This passcode was dispatched from <strong>sparevone@gmail.com</strong>. If you did not request this code, please ignore this email or notify your system administrator.
                  </p>

                  <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; text-align: center; color: #9ca3af; font-size: 12px;">
                    © ${new Date().getFullYear()} SpareShare Operations Network • All rights reserved.
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}


