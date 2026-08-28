import crypto from 'crypto';
import { Router } from 'express';
import { WebhookEvent } from '../models.js';
import { markOrderPaid } from '../commerce.js';
import { config } from '../config.js';
import { sendOrderConfirmationEmail } from '../email.js';

const router = Router();
const safeEqual = (left, right) => { const a = Buffer.from(left || ''); const b = Buffer.from(right || ''); return a.length === b.length && crypto.timingSafeEqual(a, b); };
router.post('/razorpay', async (request, response) => {
  if (!config.razorpayWebhookSecret) return response.status(503).json({ success: false, error: 'Webhook is not configured' });
  const signature = request.get('x-razorpay-signature'); const expected = crypto.createHmac('sha256', config.razorpayWebhookSecret).update(request.body).digest('hex');
  if (!safeEqual(expected, signature)) return response.status(400).json({ success: false, error: 'Invalid webhook signature' });
  let payload; try { payload = JSON.parse(request.body.toString('utf8')); } catch { return response.status(400).json({ success: false, error: 'Invalid webhook payload' }); }
  const payment = payload?.payload?.payment?.entity; const razorpayOrderId = payment?.order_id || payload?.payload?.order?.entity?.id; const paymentId = payment?.id;
  if (!razorpayOrderId || !['payment.captured', 'order.paid'].includes(payload.event)) return response.json({ success: true, ignored: true });
  const eventId = request.get('x-razorpay-event-id') || crypto.createHash('sha256').update(request.body).digest('hex');
  const event = await WebhookEvent.findOneAndUpdate({ eventId }, { $setOnInsert: { eventId, eventType: payload.event, razorpayOrderId, paymentId } }, { upsert: true, new: true });
  if (event.processedAt) return response.json({ success: true, duplicate: true });
  try { const result = await markOrderPaid({ razorpayOrderId, paymentId, source: 'razorpay_webhook' }); if (result.newlyPaid) sendOrderConfirmationEmail(result.order).catch(() => console.error('Order confirmation email failed')); event.processedAt = new Date(); event.failedAt = undefined; event.failureCode = undefined; await event.save(); response.json({ success: true }); } catch (error) { event.failedAt = new Date(); event.failureCode = ['OrderNotFound', 'OrderCancelled', 'InsufficientStock'].includes(error.message) ? error.message : 'processing_failed'; await event.save(); console.error('Razorpay webhook processing failed', event.failureCode); response.status(500).json({ success: false, error: 'Webhook processing failed' }); }
});
export default router;
