// import crypto from 'crypto';
// import { Router } from 'express';
// import { WebhookEvent } from '../models.js';
// import { markOrderPaid } from '../commerce.js';
// import { config } from '../config.js';
// import { sendOrderConfirmationEmail } from '../email.js';

// const router = Router();
// const safeEqual = (left, right) => { const a = Buffer.from(left || ''); const b = Buffer.from(right || ''); return a.length === b.length && crypto.timingSafeEqual(a, b); };
// router.post('/razorpay', async (request, response) => {
//   if (!config.razorpayWebhookSecret) return response.status(503).json({ success: false, error: 'Webhook is not configured' });
//   const signature = request.get('x-razorpay-signature'); const expected = crypto.createHmac('sha256', config.razorpayWebhookSecret).update(request.body).digest('hex');
//   if (!safeEqual(expected, signature)) return response.status(400).json({ success: false, error: 'Invalid webhook signature' });
//   let payload; try { payload = JSON.parse(request.body.toString('utf8')); } catch { return response.status(400).json({ success: false, error: 'Invalid webhook payload' }); }
//   const payment = payload?.payload?.payment?.entity; const razorpayOrderId = payment?.order_id || payload?.payload?.order?.entity?.id; const paymentId = payment?.id;
//   if (!razorpayOrderId || !['payment.captured', 'order.paid'].includes(payload.event)) return response.json({ success: true, ignored: true });
//   const eventId = request.get('x-razorpay-event-id') || crypto.createHash('sha256').update(request.body).digest('hex');
//   const event = await WebhookEvent.findOneAndUpdate({ eventId }, { $setOnInsert: { eventId, eventType: payload.event, razorpayOrderId, paymentId } }, { upsert: true, new: true });
//   if (event.processedAt) return response.json({ success: true, duplicate: true });
//   try { const result = await markOrderPaid({ razorpayOrderId, paymentId, source: 'razorpay_webhook' }); if (result.newlyPaid) sendOrderConfirmationEmail(result.order).catch(() => console.error('Order confirmation email failed')); event.processedAt = new Date(); event.failedAt = undefined; event.failureCode = undefined; await event.save(); response.json({ success: true }); } catch (error) { event.failedAt = new Date(); event.failureCode = ['OrderNotFound', 'OrderCancelled', 'InsufficientStock'].includes(error.message) ? error.message : 'processing_failed'; await event.save(); console.error('Razorpay webhook processing failed', event.failureCode); response.status(500).json({ success: false, error: 'Webhook processing failed' }); }
// });
// export default router;
import crypto from 'crypto';
import { Router } from 'express';
import { Order, WebhookEvent } from '../models.js';
import { markOrderPaid } from '../commerce.js';
import { applyTracking } from '../delhivery.js';
import { config } from '../config.js';
import { sendOrderConfirmationEmail } from '../email.js';

const router = Router();

const safeEqual = (left, right) => {
  const a = Buffer.from(left || '');
  const b = Buffer.from(right || '');

  return (
    a.length === b.length &&
    crypto.timingSafeEqual(a, b)
  );
};

router.post('/razorpay', async (request, response) => {
  if (!config.razorpayWebhookSecret) {
    return response.status(503).json({
      success: false,
      error: 'Webhook is not configured',
    });
  }

  const signature = request.get('x-razorpay-signature');

  const expected = crypto
    .createHmac('sha256', config.razorpayWebhookSecret)
    .update(request.body)
    .digest('hex');

  if (!safeEqual(expected, signature)) {
    return response.status(400).json({
      success: false,
      error: 'Invalid webhook signature',
    });
  }

  let payload;

  try {
    payload = JSON.parse(
      request.body.toString('utf8')
    );
  } catch {
    return response.status(400).json({
      success: false,
      error: 'Invalid webhook payload',
    });
  }

  const payment =
    payload?.payload?.payment?.entity;

  const razorpayOrderId =
    payment?.order_id ||
    payload?.payload?.order?.entity?.id;

  const paymentId = payment?.id;

  /*
   * We only process successful payment events here.
   *
   * Failed/authorized/other Razorpay events are handled elsewhere.
   */
  if (
    !razorpayOrderId ||
    !['payment.captured', 'order.paid'].includes(
      payload.event
    )
  ) {
    return response.json({
      success: true,
      ignored: true,
    });
  }

  /*
   * Razorpay provides x-razorpay-event-id.
   *
   * The request-body hash is used as a fallback so that
   * duplicate webhook deliveries can still be identified.
   */
  const eventId =
    request.get('x-razorpay-event-id') ||
    crypto
      .createHash('sha256')
      .update(request.body)
      .digest('hex');

  const event =
    await WebhookEvent.findOneAndUpdate(
      { eventId },
      {
        $setOnInsert: {
          eventId,
          eventType: payload.event,
          razorpayOrderId,
          paymentId,
        },
      },
      {
        upsert: true,
        new: true,
      }
    );

  /*
   * Razorpay can deliver the same webhook more than once.
   * If this event was already successfully processed,
   * acknowledge it without touching the order again.
   */
  if (event.processedAt) {
    return response.json({
      success: true,
      duplicate: true,
    });
  }

  try {
    const result = await markOrderPaid({
      razorpayOrderId,
      paymentId,
      source: 'razorpay_webhook',
    });

    /*
     * markOrderPaid() is idempotent.
     *
     * Only the request that actually changed the order
     * from pending -> paid sends the confirmation email.
     */
    if (result.newlyPaid) {
      sendOrderConfirmationEmail(result.order).catch(
        () =>
          console.error(
            'Order confirmation email failed'
          )
      );
    }

    event.processedAt = new Date();
    event.failedAt = undefined;
    event.failureCode = undefined;

    await event.save();

    return response.json({
      success: true,
    });
  } catch (error) {
    const knownErrors = [
      'OrderNotFound',
      'OrderCancelled',
      'InsufficientStock',
    ];

    event.failedAt = new Date();
    event.failureCode = knownErrors.includes(
      error.message
    )
      ? error.message
      : 'processing_failed';

    await event.save();

    console.error(
      'Razorpay webhook processing failed',
      {
        eventId,
        eventType: payload.event,
        razorpayOrderId,
        paymentId,
        failureCode: event.failureCode,
        error: error?.message,
      }
    );

    /*
     * Return 500 so Razorpay knows that processing failed
     * and can retry the webhook.
     */
    return response.status(500).json({
      success: false,
      error: 'Webhook processing failed',
    });
  }
});

/* =========================================================
   DELHIVERY SCAN PUSH

   Share this URL with Delhivery support when enabling
   status push:
   /api/webhooks/delhivery?token=<DELHIVERY_WEBHOOK_TOKEN>
========================================================= */

router.post('/delhivery', async (request, response) => {
  if (!config.delhivery.webhookToken) {
    return response.status(503).json({
      success: false,
      error: 'Webhook is not configured',
    });
  }

  const supplied = String(
    request.query.token ||
      request.get('x-delhivery-token') ||
      request.get('authorization')?.replace(/^(Token|Bearer)\s+/i, '') ||
      ''
  );

  if (!safeEqual(supplied, config.delhivery.webhookToken)) {
    return response.status(401).json({
      success: false,
      error: 'Invalid webhook token',
    });
  }

  let payload;

  try {
    payload = JSON.parse(request.body.toString('utf8'));
  } catch {
    return response.status(400).json({
      success: false,
      error: 'Invalid webhook payload',
    });
  }

  /*
   * Delhivery pushes either a single { Shipment } object or
   * a batch, so both shapes are normalised to a list.
   */
  const shipments = []
    .concat(
      payload?.Shipment ||
        payload?.ShipmentData?.map((entry) => entry.Shipment) ||
        payload ||
        []
    )
    .filter(Boolean);

  let updated = 0;

  for (const shipment of shipments) {
    const waybill = String(shipment.AWB || shipment.awb || shipment.waybill || '').trim();

    if (!waybill) continue;

    try {
      const order = await Order.findOne({
        'shippingInfo.delhivery.waybill': waybill,
      });

      if (!order || order.shippingInfo.delhivery.cancelledAt) continue;

      const status = shipment.Status || {};

      const scan = {
        status: status.Status || '',
        statusType: status.StatusType || '',
        location: status.StatusLocation || '',
        instructions: status.Instructions || '',
        at: status.StatusDateTime ? new Date(status.StatusDateTime) : new Date(),
      };

      const scans = (order.shippingInfo.delhivery.scans || []).map(
        (entry) => entry.toObject?.() || entry
      );

      const duplicate = scans.some(
        (entry) =>
          entry.status === scan.status &&
          entry.location === scan.location &&
          new Date(entry.at).getTime() === scan.at.getTime()
      );

      if (scan.status && !duplicate) scans.push(scan);

      await applyTracking(order, {
        status: scan.status,
        statusType: scan.statusType,
        location: scan.location,
        instructions: scan.instructions,
        statusAt: scan.at,
        expectedDeliveryDate: shipment.ExpectedDeliveryDate
          ? new Date(shipment.ExpectedDeliveryDate)
          : null,
        scans,
      });

      updated += 1;
    } catch (error) {
      console.error('Delhivery webhook processing failed', {
        waybill,
        error: error?.message,
      });
    }
  }

  return response.json({
    success: true,
    updated,
  });
});

export default router;
