import { ensureRequiredServerEnv } from '../_lib/email.js';
import { getAdmin, getAdminError } from '../_lib/firebaseAdmin.js';
import { normalizePlantId } from '../_lib/plants.js';
import {
  deliverOrderRequest,
  findRegisteredUser,
  normalizeRequesterEmail,
  updateOrderEmailStatus
} from '../_lib/orderEmailFlow.js';
import { syncOrderToSheet } from '../../services/googleSheets.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  const order = req.body?.order;
  if (!order?.id || !Array.isArray(order.items) || order.items.length === 0) {
    return res.status(400).json({ success: false, message: 'A valid order with at least one item is required.' });
  }

  const admin = getAdmin();
  if (!admin) {
    return res.status(503).json({ success: false, message: getAdminError() || 'Firebase server access is not configured.' });
  }

  try {
    ensureRequiredServerEnv();
    const requester = await findRegisteredUser(admin, order.requestedBy || req.body?.requestedBy);
    const requestingPlantId = normalizePlantId(
      req.body?.userFactory || requester?.factoryAffiliation || order.userFactory
    );
    const requesterEmail = normalizeRequesterEmail(requester, req.body?.userEmail || order.userEmail);

    if (!requesterEmail) {
      throw new Error('The requesting account has no valid registered email address. Update the account email before ordering.');
    }

    const targetItem = order.items.find(item => item?.fromFactory);
    if (!targetItem) throw new Error('Order does not include an item with a target plant.');
    const targetPlantId = normalizePlantId(targetItem.fromFactory);

    const result = await deliverOrderRequest({
      admin,
      order,
      targetPlantId,
      requestingPlantId,
      requesterEmail
    });

    await updateOrderEmailStatus(admin, order.id, result.status, result.reason);
    syncOrderToSheet(order).catch(error => {
      console.warn('[Order Email] Order sheet sync failed:', error.message);
    });

    return res.status(200).json({
      success: result.status === 'sent',
      emailStatus: result.status,
      emailStatusReason: result.reason,
      targetPlantId,
      targetRecipientCount: result.targetRecipientCount,
      confirmationSent: result.confirmationSent
    });
  } catch (error) {
    const reason = error?.message || 'Order email processing failed.';
    console.warn(`[Order Email] Request processing failed for order ${order.id}: ${reason}`);
    await updateOrderEmailStatus(admin, order.id, 'failed', reason).catch(statusError => {
      console.warn(`[Order Email] Could not persist failure status for order ${order.id}: ${statusError.message}`);
    });
    // Order creation has already committed in Firestore; notification failure is reported,
    // never converted into an order creation failure.
    return res.status(200).json({ success: false, emailStatus: 'failed', message: reason });
  }
}