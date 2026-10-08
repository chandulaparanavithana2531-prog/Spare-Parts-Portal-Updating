import { ensureRequiredServerEnv } from '../_lib/email.js';
import { getAdmin, getAdminError } from '../_lib/firebaseAdmin.js';
import { normalizePlantId } from '../_lib/plants.js';
import {
  deliverOrderRequest,
  findRegisteredUser,
  normalizeRequesterEmail,
  updateOrderEmailStatus
} from '../_lib/orderEmailFlow.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  const admin = getAdmin();
  if (!admin) return res.status(503).json({ success: false, message: getAdminError() || 'Firebase server access is not configured.' });

  try {
    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ success: false, message: 'Admin authentication is required.' });
    const claims = await admin.auth().verifyIdToken(token);
    if (claims.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin access is required.' });

    ensureRequiredServerEnv();
    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId) return res.status(400).json({ success: false, message: 'Order ID is required.' });

    const snapshot = await admin.firestore().collection('orders').doc(orderId).get();
    if (!snapshot.exists) return res.status(404).json({ success: false, message: 'Order not found.' });
    const order = { id: snapshot.id, ...snapshot.data() };
    if (order.status !== 'pending' || !(order.items || []).some(item => item.status === 'pending')) {
      return res.status(409).json({ success: false, message: 'Only pending orders can have their request email resent.' });
    }
    const item = (order.items || []).find(entry => entry?.fromFactory);
    if (!item) throw new Error('Order has no item with a target plant.');

    const requester = await findRegisteredUser(admin, order.requestedBy);
    const targetPlantId = normalizePlantId(item.fromFactory);
    const requestingPlantId = normalizePlantId(order.userFactory || requester?.factoryAffiliation);
    const requesterEmail = normalizeRequesterEmail(requester, order.userEmail);
    const result = await deliverOrderRequest({
      admin,
      order,
      targetPlantId,
      requestingPlantId,
      requesterEmail,
      includeConfirmation: false
    });

    await updateOrderEmailStatus(admin, order.id, result.status, result.reason);
    return res.status(200).json({
      success: result.status === 'sent',
      emailStatus: result.status,
      emailStatusReason: result.reason,
      targetPlantId,
      targetRecipientCount: result.targetRecipientCount
    });
  } catch (error) {
    const message = error?.message || 'Could not resend request email.';
    console.warn('[Order Email] Admin resend failed:', message);
    const orderId = String(req.body?.orderId || '').trim();
    if (orderId) await updateOrderEmailStatus(admin, orderId, 'failed', message).catch(() => {});
    return res.status(200).json({ success: false, emailStatus: 'failed', message });
  }
}