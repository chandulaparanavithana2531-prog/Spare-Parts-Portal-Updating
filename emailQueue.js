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
         (this.transporter.options.host === 'smtp.ethereal.email' || !this.transporter.options.auth?.user));

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

// Generate HTML email templates with premium aesthetics
export function generateCustomerConfirmationEmail(order, userEmail, estimatedTimeframe) {
  const timestampString = new Date(order.createdAt).toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const sourcePlant = order.items && order.items.length > 0 ? order.items[0].fromFactory : 'Partner Plant';

  const rows = order.items.map(item => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
        <div style="font-weight: 600; color: #1f2937;">${item.sparePartDescription}</div>
        <div style="font-size: 12px; color: #6b7280; margin-top: 2px;">Material: ${item.sparePartId.split('-')[1] || item.sparePartId} | Part No: ${item.partNumber || 'N/A'}</div>
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center; color: #4b5563;">${item.quantity}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #4b5563;">${formatCurrency(item.unitCost)}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: #111827;">${formatCurrency(item.totalValue)}</td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Order Confirmation</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f3f4f6; padding: 40px 10px;">
        <tr>
          <td align="center">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06);">
              <!-- Gradient Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 40px 30px; text-align: center; color: #ffffff;">
                  <div style="background-color: rgba(255, 255, 255, 0.2); width: 64px; height: 64px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
                    <span style="font-size: 32px;">✓</span>
                  </div>
                  <h1 style="margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.025em;">Request Successfully Submitted</h1>
                  <p style="margin: 8px 0 0 0; font-size: 15px; color: #bfdbfe;">Order Ref: ${order.id}</p>
                </td>
              </tr>
              <!-- Card Body -->
              <tr>
                <td style="padding: 30px;">
                  <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                    Hello <strong>${userEmail}</strong>,
                  </p>
                  <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #4b5563;">
                    Your request for spare parts from another plant has been recorded. The items have been reserved and are currently pending fulfillment approval from the source plant manager.
                  </p>
                  
                  <!-- Metadata Section -->
                  <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 28px;">
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="font-size: 14px; line-height: 1.5;">
                      <tr>
                        <td style="padding-bottom: 10px; color: #6b7280; width: 45%;">Order ID</td>
                        <td style="padding-bottom: 10px; color: #111827; font-weight: 600;">${order.id}</td>
                      </tr>
                      <tr>
                        <td style="padding-bottom: 10px; color: #6b7280;">Date & Time</td>
                        <td style="padding-bottom: 10px; color: #111827;">${timestampString}</td>
                      </tr>
                      <tr>
                        <td style="padding-bottom: 10px; color: #6b7280;">Fulfillment Plant</td>
                        <td style="padding-bottom: 10px; color: #2563eb; font-weight: 600;">${sourcePlant}</td>
                      </tr>
                      <tr>
                        <td style="color: #6b7280;">Estimated Fulfillment</td>
                        <td style="color: #059669; font-weight: 700;">${estimatedTimeframe}</td>
                      </tr>
                    </table>
                  </div>

                  <!-- Summary Table -->
                  <h3 style="margin: 0 0 12px 0; font-size: 16px; font-weight: 700; color: #111827; text-transform: uppercase; letter-spacing: 0.05em;">Order Breakdown</h3>
                  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; font-size: 14px; margin-bottom: 24px;">
                    <thead>
                      <tr style="background-color: #f9fafb;">
                        <th align="left" style="padding: 10px; font-weight: 600; color: #4b5563; border-bottom: 2px solid #e5e7eb;">Item Description</th>
                        <th align="center" style="padding: 10px; font-weight: 600; color: #4b5563; border-bottom: 2px solid #e5e7eb; width: 10%;">Qty</th>
                        <th align="right" style="padding: 10px; font-weight: 600; color: #4b5563; border-bottom: 2px solid #e5e7eb; width: 22%;">Unit Cost</th>
                        <th align="right" style="padding: 10px; font-weight: 600; color: #4b5563; border-bottom: 2px solid #e5e7eb; width: 22%;">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${rows}
                      <!-- Total row -->
                      <tr>
                        <td colspan="2" style="padding: 16px 12px; font-size: 15px; color: #4b5563; text-align: right;">Total Amount</td>
                        <td colspan="2" style="padding: 16px 12px; font-size: 20px; font-weight: 800; color: #111827; text-align: right; border-top: 2px solid #e5e7eb;">${formatCurrency(order.totalValue)}</td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- Footer Notice -->
                  <p style="margin: 0 0 16px 0; font-size: 13px; line-height: 1.5; color: #6b7280; text-align: center;">
                    If you have any questions regarding this order, please contact your local procurement administrator.
                  </p>
                  
                  <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; text-align: center; color: #9ca3af; font-size: 12px;">
                    © ${new Date().getFullYear()} SpareShare Portal. All rights reserved.
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

export function generatePlantNotificationEmail(order, plantEmail, customerFactory, userEmail) {
  const timestampString = new Date(order.createdAt).toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const rows = order.items.map(item => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
        <div style="font-weight: 600; color: #1f2937;">${item.sparePartDescription}</div>
        <div style="font-size: 12px; color: #6b7280; margin-top: 2px;">Material: ${item.sparePartId.split('-')[1] || item.sparePartId} | Part No: ${item.partNumber || 'N/A'}</div>
        <div style="font-size: 12px; color: #4b5563; margin-top: 2px; font-style: italic;">Machine target: ${item.machine || 'General'}</div>
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center; font-weight: 700; color: #111827; font-size: 16px;">${item.quantity}</td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Dispatch Notification Alert</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f3f4f6; padding: 40px 10px;">
        <tr>
          <td align="center">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06);">
              <!-- Gradient Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #059669 0%, #047857 100%); padding: 40px 30px; text-align: center; color: #ffffff;">
                  <div style="background-color: rgba(255, 255, 255, 0.2); width: 64px; height: 64px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
                    <span style="font-size: 32px; font-weight: bold;">!</span>
                  </div>
                  <h1 style="margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.025em;">New Work Order / Dispatch Alert</h1>
                  <p style="margin: 8px 0 0 0; font-size: 15px; color: #a7f3d0;">Action Required • Order Ref: ${order.id}</p>
                </td>
              </tr>
              <!-- Card Body -->
              <tr>
                <td style="padding: 30px;">
                  <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                    Hello <strong>Plant Operations Manager</strong>,
                  </p>
                  <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #4b5563;">
                    An inter-factory dispatch request has been submitted targeting your warehouse inventory. Please verify stock availability and prepare the following items for transit.
                  </p>
                  
                  <!-- Customer Details / Meta Section -->
                  <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 20px; margin-bottom: 28px;">
                    <h4 style="margin: 0 0 10px 0; font-size: 14px; font-weight: 700; color: #065f46; text-transform: uppercase; letter-spacing: 0.05em;">Request Details</h4>
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="font-size: 14px; line-height: 1.5; color: #1f2937;">
                      <tr>
                        <td style="padding-bottom: 8px; color: #4b5563; width: 45%;">Requesting Plant</td>
                        <td style="padding-bottom: 8px; font-weight: 600;">${customerFactory}</td>
                      </tr>
                      <tr>
                        <td style="padding-bottom: 8px; color: #4b5563;">Requested By</td>
                        <td style="padding-bottom: 8px;">${userEmail}</td>
                      </tr>
                      <tr>
                        <td style="padding-bottom: 8px; color: #4b5563;">Timestamp</td>
                        <td style="padding-bottom: 8px; color: #6b7280;">${timestampString}</td>
                      </tr>
                      <tr>
                        <td style="padding-bottom: 8px; color: #4b5563;">Fulfillment Contact</td>
                        <td style="padding-bottom: 8px; font-weight: 600;">${plantEmail}</td>
                      </tr>
                      <tr>
                        <td style="color: #4b5563;">Status</td>
                        <td style="color: #b45309; font-weight: 700;">PENDING DISPATCH APPROVAL</td>
                      </tr>
                    </table>
                  </div>

                  <!-- Item Breakdown -->
                  <h3 style="margin: 0 0 12px 0; font-size: 16px; font-weight: 700; color: #111827; text-transform: uppercase; letter-spacing: 0.05em;">Requested Items</h3>
                  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; font-size: 14px; margin-bottom: 30px;">
                    <thead>
                      <tr style="background-color: #f9fafb;">
                        <th align="left" style="padding: 10px; font-weight: 600; color: #4b5563; border-bottom: 2px solid #e5e7eb;">Part Description</th>
                        <th align="center" style="padding: 10px; font-weight: 600; color: #4b5563; border-bottom: 2px solid #e5e7eb; width: 20%;">Quantity</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${rows}
                    </tbody>
                  </table>

                  <!-- Action Items Checklist -->
                  <div style="border-top: 2px dashed #e5e7eb; padding-top: 24px; margin-bottom: 28px;">
                    <h3 style="margin: 0 0 16px 0; font-size: 16px; font-weight: 800; color: #065f46;">Operations Checklist</h3>
                    <ul style="margin: 0; padding: 0 0 0 20px; font-size: 14px; line-height: 1.8; color: #374151;">
                      <li style="margin-bottom: 8px;"><strong>Inventory Verification:</strong> Physically count stock on shelf for the listed materials.</li>
                      <li style="margin-bottom: 8px;"><strong>Quality & Inspection:</strong> Ensure the spare parts are free of defect and fit for transit.</li>
                      <li style="margin-bottom: 8px;"><strong>Logistics Prep:</strong> Securely package the items and label with order Reference <strong>${order.id}</strong>.</li>
                      <li style="margin-bottom: 8px;"><strong>Portal Update:</strong> Log in to the SpareShare Portal and mark this item as <strong>Approved</strong> and then <strong>Delivered</strong> to deduct stock.</li>
                    </ul>
                  </div>
                  
                  <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; text-align: center; color: #9ca3af; font-size: 12px;">
                    © ${new Date().getFullYear()} SpareShare Portal. All rights reserved.
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
  const timestampString = new Date().toLocaleString('en-US');

  const statusColors = {
    approved: { bg: '#dcfce7', text: '#15803d', label: 'APPROVED & RESERVED' },
    delivered: { bg: '#dbeafe', text: '#1d4ed8', label: 'DELIVERED & FULFILLED' },
    rejected: { bg: '#fee2e2', text: '#b91c1c', label: 'REJECTED' }
  };
  const statusInfo = statusColors[newStatus] || { bg: '#f3f4f6', text: '#374151', label: (newStatus || '').toUpperCase() };

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Order Status Update</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f3f4f6; padding: 40px 10px;">
        <tr>
          <td align="center">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
              <tr>
                <td style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 36px 30px; text-align: center; color: #ffffff;">
                  <h1 style="margin: 0; font-size: 22px; font-weight: 800;">SpareShare Order Status Update</h1>
                  <p style="margin: 8px 0 0 0; font-size: 14px; color: #94a3b8;">Order Ref: ${order.id}</p>
                </td>
              </tr>
              <tr>
                <td style="padding: 30px;">
                  <p style="margin: 0 0 16px 0; font-size: 15px; color: #334155;">
                    Hello <strong>${order.requestedBy}</strong>,
                  </p>
                  <p style="margin: 0 0 20px 0; font-size: 14px; color: #475569; line-height: 1.6;">
                    The status of your requested spare part item in Order <strong>${order.id}</strong> has been updated by <strong>${performerUsername}</strong>:
                  </p>

                  <div style="background-color: ${statusInfo.bg}; border-radius: 12px; padding: 16px; text-align: center; margin-bottom: 24px;">
                    <span style="font-size: 16px; font-weight: 800; color: ${statusInfo.text}; letter-spacing: 0.05em;">
                      ${statusInfo.label}
                    </span>
                  </div>

                  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="font-size: 14px; margin-bottom: 24px;">
                    <tr>
                      <td style="padding: 8px 0; color: #64748b; width: 40%;">Item Description</td>
                      <td style="padding: 8px 0; font-weight: 600; color: #0f172a;">${item.sparePartDescription}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #64748b;">Quantity</td>
                      <td style="padding: 8px 0; font-weight: 600; color: #0f172a;">${item.quantity}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #64748b;">Source Plant</td>
                      <td style="padding: 8px 0; font-weight: 600; color: #2563eb;">${item.fromFactory}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; color: #64748b;">Updated At</td>
                      <td style="padding: 8px 0; color: #64748b;">${timestampString}</td>
                    </tr>
                  </table>

                  <div style="border-top: 1px solid #e2e8f0; padding-top: 20px; text-align: center; color: #94a3b8; font-size: 12px;">
                    © ${new Date().getFullYear()} SpareShare Inter-Factory Portal. All rights reserved.
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
                  <div style="background: rgba(255,255,255,0.2); width: 56px; height: 56px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 12px; font-size: 28px;">
                    🛡️
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
                      ⏱️ Valid for 5 minutes • Do not share this code
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


