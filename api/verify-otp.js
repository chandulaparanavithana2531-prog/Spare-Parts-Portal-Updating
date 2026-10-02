export default async function handler(req, res) {
  return res.status(200).json({
    success: true,
    message: '2FA authentication is disabled. Verification bypassed.'
  });
}
