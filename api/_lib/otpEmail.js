import { escapeHtml } from './email.js';

export function generate2FAEmail(username, otpCode) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,sans-serif;color:#1f2937">
    <table width="100%"><tr><td align="center"><table width="100%" style="max-width:520px;background:#fff;border-radius:16px;padding:32px">
      <tr><td><h1 style="color:#1e40af">2-Step Verification Required</h1>
      <p>Hello <strong>${escapeHtml(username)}</strong>, use this passcode to complete your SpareShare login:</p>
      <p style="font-family:monospace;font-size:32px;font-weight:bold;letter-spacing:.3em;text-align:center;color:#1e3a8a">${escapeHtml(otpCode)}</p>
      <p>This code is valid for 5 minutes. Do not share it. Dispatched from sparevone@gmail.com.</p></td></tr>
    </table></td></tr></table>
  </body></html>`;
}
