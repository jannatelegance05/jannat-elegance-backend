import crypto from 'crypto';
import { Router } from 'express';
import Razorpay from 'razorpay';
import { z } from 'zod';
import { Address, Order, Product } from '../models.js';
import { makeOrderItems, markOrderPaid } from '../commerce.js';
import { requireAuth, requireSameOrigin } from '../auth.js';
import { config } from '../config.js';
import { sendOrderConfirmationEmail } from '../email.js';

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const lineSchema = z.object({ id: objectId, size: z.enum(['S', 'M', 'L', 'XL', 'XXL']), quantity: z.number().int().min(1).max(10) }).strict();
const addressInput = z.object({ name: z.string().trim().min(2).max(120), phone: z.string().regex(/^\d{10}$/), addressLine: z.string().trim().min(8).max(300), city: z.string().trim().min(2).max(80), state: z.string().trim().min(2).max(80), pincode: z.string().regex(/^\d{6}$/) }).strict();
const checkoutSchema = z.object({ cart: z.array(lineSchema).min(1).max(50), address: addressInput.optional(), addressId: objectId.optional(), saveAddress: z.boolean().optional() }).strict().superRefine((data, context) => { if ((data.address ? 1 : 0) + (data.addressId ? 1 : 0) !== 1) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide one shipping address' }); });
const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
const checkoutResponse = (order) => ({ success: true, orderId: String(order._id), razorpayOrderId: order.razorpayOrderId, amount: Math.round(order.total * 100), currency: 'INR', key: config.razorpayKeyId });
const paymentError = (error, response) => { if (error.message === 'InsufficientStock') return response.status(409).json({ success: false, error: 'Stock changed before payment could be confirmed. Please contact support for payment assistance.' }); if (error.message === 'OrderNotFound') return response.status(404).json({ success: false, error: 'Order not found' }); if (error.message === 'OrderCancelled') return response.status(400).json({ success: false, error: 'This order was cancelled' }); return null; };

router.use(requireAuth, requireSameOrigin);
router.post('/', async (request, response, next) => {
  try {
    if (!config.razorpayKeyId || !config.razorpayKeySecret) return response.status(503).json({ success: false, error: 'Payments are not configured' });
    const input = checkoutSchema.parse(request.body); const idempotencyKey = idempotencyKeySchema.parse(request.get('Idempotency-Key'));
    const duplicateLines = new Set(input.cart.map((line) => `${line.id}:${line.size}`));
    if (duplicateLines.size !== input.cart.length) return response.status(400).json({ success: false, error: 'Duplicate cart lines are not allowed' });
    const priorOrder = await Order.findOne({ userId: request.user.id, idempotencyKey }).lean();
    if (priorOrder?.razorpayOrderId) return response.json(checkoutResponse(priorOrder));
    const address = input.addressId ? await Address.findOne({ _id: input.addressId, userId: request.user.id }).lean() : input.address;
    if (!address) return response.status(404).json({ success: false, error: 'Saved address not found' });
    const ids = [...new Set(input.cart.map((line) => line.id))]; const products = await Product.find({ _id: { $in: ids }, isActive: true, status: 'published' }).populate('categoryId', 'name').lean();
    if (products.length !== ids.length) return response.status(400).json({ success: false, error: 'A product in your cart is no longer available' });
    let items; try { items = makeOrderItems(products, input.cart); } catch (error) { if (error.message === 'InsufficientStock') return response.status(409).json({ success: false, error: 'A selected size is no longer available' }); throw error; }
    const subtotal = Math.round(items.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100; const shipping = 0; const total = subtotal;
    if (input.saveAddress && !input.addressId) await Address.create({ ...address, userId: request.user.id, isDefault: !(await Address.exists({ userId: request.user.id })) });
    let order;
    try {
  const orderNumber = `JE${Date.now()}${Math.floor(
    100 + Math.random() * 900
  )}`;

  function generateOrderId() {
  const timestamp = Date.now()
    .toString()
    .slice(-10);

  const random = Math.random()
    .toString(36)
    .substring(2, 6)
    .toUpperCase();

  return `JE${timestamp}${random}`;
}

  order = await Order.create({
    orderId: generateOrderId(),
    userId: request.user.id,

    // Unique customer-facing Order ID
    orderNumber,

    idempotencyKey,

    customerName: address.name,

    customerEmail: request.user.email,

    customerPhone: address.phone,

    shippingAddress: address.addressLine,

    city: address.city,

    state: address.state,

    postalCode: address.pincode,

    subtotal,

    shipping,

    total,

    paymentStatus: 'pending',

   status: 'confirmed',

    // Initial tracking history
    statusHistory: [
  {
    status: 'confirmed',
    changedAt: new Date(),
    changedBy: request.user.id,
  },
],

    items,
  });
} catch (error) {
  if (error?.code === 11000) {
    const existing = await Order.findOne({
      userId: request.user.id,
      idempotencyKey,
    }).lean();

    if (existing?.razorpayOrderId) {
      return response.json(
        checkoutResponse(existing)
      );
    }
  }

  throw error;
}
    try { const razorpay = new Razorpay({ key_id: config.razorpayKeyId, key_secret: config.razorpayKeySecret }); const paymentOrder = await razorpay.orders.create({ amount: Math.round(total * 100), currency: 'INR', receipt: `je_${String(order._id).slice(-16)}` }); order.razorpayOrderId = paymentOrder.id; await order.save(); return response.status(201).json(checkoutResponse(order)); } catch (error) { await Order.deleteOne({ _id: order._id, userId: request.user.id, paymentStatus: 'pending' }); throw error; }
  } catch (error) { next(error); }
});
router.post('/verify', async (request, response, next) => {
  try {
    if (!config.razorpayKeySecret) return response.status(503).json({ success: false, error: 'Payments are not configured' });
    const body = z.object({ razorpay_order_id: z.string().min(1).max(200), razorpay_payment_id: z.string().min(1).max(200), razorpay_signature: z.string().regex(/^[a-f\d]{64}$/i) }).strict().parse(request.body);
    const expected = crypto.createHmac('sha256', config.razorpayKeySecret).update(`${body.razorpay_order_id}|${body.razorpay_payment_id}`).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(body.razorpay_signature))) return response.status(400).json({ success: false, error: 'Payment verification failed' });
    const owned = await Order.exists({ userId: request.user.id, razorpayOrderId: body.razorpay_order_id }); if (!owned) return response.status(404).json({ success: false, error: 'Order not found' });
    const result = await markOrderPaid({ razorpayOrderId: body.razorpay_order_id, paymentId: body.razorpay_payment_id, source: 'browser_verify' });
    if (result.newlyPaid) sendOrderConfirmationEmail(result.order).catch(() => console.error('Order confirmation email failed'));
    response.json({ success: true, orderId: String(result.order._id) });
  } catch (error) { if (paymentError(error, response)) return; next(error); }
});
export default router;
