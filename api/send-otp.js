import nodemailer from 'nodemailer';

const otpStore = global.otpStore || new Map();
global.otpStore = otpStore;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { username, email } = req.body || {};
    if (!username) {
      return res.status(400).json({ success: false, message: 'Missing username' });
    }

    const targetEmail = email || (username.includes('@') ? username : 'sparevone@gmail.com');
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes validity

    otpStore.set(username.toLowerCase(), { code: otpCode, expiresAt });
    console.log(`[Vercel 2FA] OTP generated for ${username} -> ${targetEmail}: ${otpCode}`);

    const smtpUser = process.env.SMTP_USER || 'sparevone@gmail.com';
    const smtpPass = process.env.SMTP_PASS || 'wpuk rddy frix kjiu';

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    });

    const mailOptions = {
      from: process.env.SMTP_FROM || '"SpareShare Security" <sparevone@gmail.com>',
      to: targetEmail,
      subject: `SpareShare 2-Step Verification Code: ${otpCode}`,
      text: `Hello ${username},\n\nYour SpareShare 2-Step Verification Code is: ${otpCode}\nValid for 5 minutes.\n\nDispatched from sparevone@gmail.com`,
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><title>2-Step Verification Code</title></head>
        <body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
          <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f3f4f6;padding:40px 10px;">
            <tr>
              <td align="center">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;background-color:#ffffff;border-radius:20px;padding:32px;box-shadow:0 10px 25px -5px rgba(0,0,0,0.1);">
                  <div style="text-align:center;margin-bottom:20px;">
                    <div style="background:#1e40af;color:#fff;width:56px;height:56px;border-radius:50%;display:inline-block;line-height:56px;font-size:28px;">&#128737;</div>
                    <h2 style="color:#1e40af;margin:12px 0 4px 0;">2-Step Verification Required</h2>
                    <p style="color:#64748b;font-size:14px;margin:0;">SpareShare Security Authentication</p>
                  </div>
                  <p style="font-size:15px;color:#374151;">Hello <strong>${username}</strong>,</p>
                  <p style="font-size:14px;color:#4b5563;">You are signing into the SpareShare Inter-Factory Portal. Please use the following 6-digit verification passcode to complete your login:</p>
                  <div style="background:#f8fafc;border:2px dashed #cbd5e1;border-radius:16px;padding:20px;text-align:center;margin:24px 0;">
                    <div style="font-size:36px;font-weight:900;letter-spacing:0.3em;color:#1e3a8a;font-family:monospace;">${otpCode}</div>
                    <p style="margin:8px 0 0 0;font-size:12px;color:#64748b;font-weight:600;">&#9201; Valid for 5 minutes &bull; Do not share this code</p>
                  </div>
                  <p style="font-size:13px;color:#6b7280;text-align:center;margin-bottom:0;">This passcode was dispatched from <strong>sparevone@gmail.com</strong>.</p>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `
    };

    await transporter.sendMail(mailOptions);

    return res.status(200).json({
      success: true,
      message: `2-Step verification passcode dispatched from sparevone@gmail.com to ${targetEmail}`,
      otpCode
    });
  } catch (err) {
    console.error('[Vercel 2FA Send OTP Error]:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}
