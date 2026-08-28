import mongoose from 'mongoose';
import { Order, Product } from './models.js';

export const ORDER_STATUSES = ['confirmed', 'processing', 'packed', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'cancelled'];
export const LEGACY_STATUSES = ['pending', 'returned', 'exchanged'];
export const statusLabel = (status) => ({ confirmed: 'Confirmed', processing: 'Processing', packed: 'Packed', shipped: 'Shipped', in_transit: 'In Transit', out_for_delivery: 'Out for Delivery', delivered: 'Delivered', cancelled: 'Cancelled', pending: 'Confirmed', returned: 'Returned', exchanged: 'Exchanged' }[status] || 'Confirmed');
export const normalizeStatus = (status) => status === 'pending' ? 'confirmed' : status;
const transitions = { pending: ['confirmed', 'cancelled'], confirmed: ['processing', 'cancelled'], processing: ['packed', 'cancelled'], packed: ['shipped', 'cancelled'], shipped: ['in_transit'], in_transit: ['out_for_delivery'], out_for_delivery: ['delivered'], delivered: [], cancelled: [], returned: [], exchanged: [] };
export const isValidStatusTransition = (current, next) => current === next || transitions[current]?.includes(next) || false;
export const isSafeTrackingUrl = (value) => { if (!value) return true; try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol); } catch { return false; } };

export async function applyOrderTransition({ orderId, adminId, input }) {
  const session = await mongoose.startSession(); let result;
  try {
    await session.withTransaction(async () => {
      const order = await Order.findById(orderId).session(session); if (!order) throw new Error('OrderNotFound');
      const storedCurrent = order.status || 'pending'; const current = normalizeStatus(storedCurrent); const next = input.status || current;
      if (!isValidStatusTransition(current, next)) throw new Error('InvalidStatusTransition');
      if (next === 'cancelled' && ['shipped', 'in_transit', 'out_for_delivery', 'delivered'].includes(current)) throw new Error('CancellationNotAllowed');
      if (next === 'cancelled' && !input.cancelReason && !order.cancelReason) throw new Error('CancellationReasonRequired');
      const shipping = order.shippingInfo?.toObject?.() || order.shippingInfo || {}; const proposedShipping = { courierName: input.courierName ?? shipping.courierName ?? '', trackingNumber: input.trackingNumber ?? shipping.trackingNumber ?? '', trackingUrl: input.trackingUrl ?? shipping.trackingUrl ?? '' };
      const shippingChanged = ['courierName', 'trackingNumber', 'trackingUrl'].some((key) => proposedShipping[key] !== (shipping[key] || ''));
      const statusChanged = next !== storedCurrent;
      const notesChanged = input.adminNotes !== undefined && input.adminNotes !== (order.adminNotes || '');
      const cancelReasonChanged = input.cancelReason !== undefined && input.cancelReason !== (order.cancelReason || '');
      if (statusChanged) { order.status = next; order.statusHistory.push({ status: next, changedAt: new Date(), changedBy: adminId }); }
      if (shippingChanged) order.shippingInfo = proposedShipping;
      if (input.adminNotes !== undefined) order.adminNotes = input.adminNotes;
      if (input.cancelReason) order.cancelReason = input.cancelReason;
      if (statusChanged && next === 'delivered' && !order.deliveredAt) order.deliveredAt = new Date();
      if (statusChanged && next === 'cancelled' && !order.cancelledAt) order.cancelledAt = new Date();
      if (statusChanged && next === 'cancelled' && order.paymentStatus === 'paid' && !order.stockRestoredAt) { for (const item of order.items) { const restored = await Product.updateOne({ _id: item.productId, 'sizes.size': item.size }, { $inc: { 'sizes.$.stock': item.quantity } }, { session }); if (restored.modifiedCount !== 1) throw new Error('StockRestoreFailed'); } order.stockRestoredAt = new Date(); }
      await order.save({ session }); result = { order, changed: statusChanged || shippingChanged || notesChanged || cancelReasonChanged, notificationRequired: statusChanged || shippingChanged, statusChanged, shippingChanged, notesChanged, previousStatus: current };
    });
    return result;
  } finally { await session.endSession(); }
}
