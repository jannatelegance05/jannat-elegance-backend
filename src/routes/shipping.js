import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AdminActivityLog, Order } from '../models.js';
import { requireAdmin, requireAuth, requireSameOrigin } from '../auth.js';
import { config } from '../config.js';
import { sendOrderStatusEmail } from '../email.js';
import {
  DelhiveryError,
  cancelShipment,
  checkServiceability,
  createShipment,
  formatDelhivery,
  getLabelUrl,
  getShippingRate,
  isCashOnDelivery,
  isDelhiveryConfigured,
  requestPickup,
  syncActiveShipments,
  syncOrderTracking,
} from '../delhivery.js';

const pincodeSchema = z.string().trim().regex(/^\d{6}$/);
const audit = (adminId, action, entityId, details) => AdminActivityLog.create({ adminId, action, entityType: 'order', entityId, details });

const handleError = (error, response, next) => {
  if (error instanceof DelhiveryError) return response.status(error.status).json({ success: false, error: error.message });
  next(error);
};

const loadOrder = async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.id)) { response.status(404).json({ success: false, error: 'Order not found' }); return null; }
  const order = await Order.findById(request.params.id);
  if (!order) response.status(404).json({ success: false, error: 'Order not found' });
  return order;
};

const shipmentResponse = (order, extra = {}) => ({
  success: true,
  status: order.status,
  shippingInfo: {
    courierName: order.shippingInfo?.courierName || '',
    trackingNumber: order.shippingInfo?.trackingNumber || '',
    trackingUrl: order.shippingInfo?.trackingUrl || '',
    provider: order.shippingInfo?.provider || 'manual',
    delhivery: formatDelhivery(order.shippingInfo?.delhivery),
  },
  ...extra,
});

/* =========================================================
   PUBLIC: PINCODE SERVICEABILITY (checkout)
========================================================= */

const serviceabilityCache = new Map();
const CACHE_MS = 6 * 60 * 60 * 1000;

export async function lookupServiceability(pincode) {
  const cached = serviceabilityCache.get(pincode);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await checkServiceability(pincode);
  if (serviceabilityCache.size > 5000) serviceabilityCache.clear();
  serviceabilityCache.set(pincode, { value, expiresAt: Date.now() + CACHE_MS });
  return value;
}

export const publicShippingRoutes = Router();

publicShippingRoutes.get('/serviceability', async (request, response, next) => {
  try {
    const parsed = pincodeSchema.safeParse(request.query.pincode);
    if (!parsed.success) return response.status(400).json({ success: false, error: 'Enter a valid 6-digit pincode' });
    // Without Delhivery credentials the store keeps accepting every pincode.
    if (!isDelhiveryConfigured()) return response.json({ success: true, checked: false, serviceable: true, pincode: parsed.data });
    const result = await lookupServiceability(parsed.data);
    response.json({ success: true, checked: true, ...result });
  } catch (error) {
    if (error instanceof DelhiveryError) return response.json({ success: true, checked: false, serviceable: true, pincode: request.query.pincode });
    next(error);
  }
});

/* =========================================================
   ADMIN: DELHIVERY ONE OPERATIONS
========================================================= */

export const adminShippingRoutes = Router();
adminShippingRoutes.use(requireAuth, requireAdmin);

adminShippingRoutes.get('/status', (_request, response) => {
  const settings = config.delhivery;
  response.json({
    success: true,
    configured: isDelhiveryConfigured(),
    environment: settings.environment,
    pickupLocation: settings.pickupLocation,
    originPincode: settings.originPincode,
    shippingMode: settings.shippingMode,
    defaults: { weightGrams: settings.defaultWeightGrams, lengthCm: settings.defaultLengthCm, widthCm: settings.defaultWidthCm, heightCm: settings.defaultHeightCm },
    webhookEnabled: Boolean(settings.webhookToken),
    syncIntervalMinutes: settings.syncIntervalMinutes,
  });
});

adminShippingRoutes.get('/serviceability', async (request, response, next) => {
  try {
    const pincode = pincodeSchema.parse(request.query.pincode);
    response.json({ success: true, ...(await checkServiceability(pincode)) });
  } catch (error) { handleError(error, response, next); }
});

adminShippingRoutes.get('/orders/:id/quote', async (request, response, next) => {
  try {
    const order = await loadOrder(request, response); if (!order) return;
    const weightGrams = Math.min(50000, Math.max(1, Number(request.query.weightGrams) || config.delhivery.defaultWeightGrams));
    const shippingMode = request.query.shippingMode === 'Express' ? 'Express' : request.query.shippingMode === 'Surface' ? 'Surface' : undefined;
    const cod = isCashOnDelivery(order);
    const [serviceability, rate] = await Promise.all([
      checkServiceability(order.postalCode),
      config.delhivery.originPincode ? getShippingRate({ pincode: order.postalCode, weightGrams, shippingMode, paymentMode: cod ? 'COD' : 'Pre-paid', codAmount: order.total }).catch(() => null) : null,
    ]);
    response.json({ success: true, serviceability, rate, paymentMode: cod ? 'COD' : 'Prepaid' });
  } catch (error) { handleError(error, response, next); }
});

const shipmentSchema = z.object({
  weightGrams: z.number().int().min(1).max(50000).optional(),
  lengthCm: z.number().min(1).max(300).optional(),
  widthCm: z.number().min(1).max(300).optional(),
  heightCm: z.number().min(1).max(300).optional(),
  shippingMode: z.enum(['Surface', 'Express']).optional(),
  sendEmail: z.boolean().default(true),
}).strict();

adminShippingRoutes.post('/orders/:id/shipment', requireSameOrigin, async (request, response, next) => {
  try {
    const input = shipmentSchema.parse(request.body || {});
    const order = await loadOrder(request, response); if (!order) return;
    const previousStatus = order.status;
    await createShipment(order, input);
    await audit(request.user.id, 'delhivery_create_shipment', String(order._id), { waybill: order.shippingInfo.delhivery.waybill, weightGrams: order.shippingInfo.delhivery.weightGrams });
    let notificationFailed = false;
    if (input.sendEmail) { try { await sendOrderStatusEmail(order); } catch { notificationFailed = true; } }
    response.status(201).json(shipmentResponse(order, { previousStatus, notificationFailed }));
  } catch (error) { handleError(error, response, next); }
});

adminShippingRoutes.post('/orders/:id/sync', requireSameOrigin, async (request, response, next) => {
  try {
    const order = await loadOrder(request, response); if (!order) return;
    const { statusChanged } = await syncOrderTracking(order);
    response.json(shipmentResponse(order, { statusChanged }));
  } catch (error) { handleError(error, response, next); }
});

adminShippingRoutes.get('/orders/:id/label', async (request, response, next) => {
  try {
    const order = await loadOrder(request, response); if (!order) return;
    const waybill = order.shippingInfo?.delhivery?.waybill;
    if (!waybill || order.shippingInfo.delhivery.cancelledAt) return response.status(409).json({ success: false, error: 'No active Delhivery shipment on this order' });
    response.json({ success: true, url: await getLabelUrl(waybill) });
  } catch (error) { handleError(error, response, next); }
});

adminShippingRoutes.post('/orders/:id/cancel', requireSameOrigin, async (request, response, next) => {
  try {
    const order = await loadOrder(request, response); if (!order) return;
    const waybill = order.shippingInfo?.delhivery?.waybill;
    await cancelShipment(order);
    await audit(request.user.id, 'delhivery_cancel_shipment', String(order._id), { waybill });
    response.json(shipmentResponse(order));
  } catch (error) { handleError(error, response, next); }
});

const pickupSchema = z.object({
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pickupTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  packageCount: z.number().int().min(1).max(500),
  orderIds: z.array(z.string().refine((value) => mongoose.isValidObjectId(value))).max(500).optional(),
}).strict();

adminShippingRoutes.post('/pickup', requireSameOrigin, async (request, response, next) => {
  try {
    const input = pickupSchema.parse(request.body);
    const pickupTime = input.pickupTime.length === 5 ? `${input.pickupTime}:00` : input.pickupTime;
    const result = await requestPickup({ pickupDate: input.pickupDate, pickupTime, packageCount: input.packageCount });
    if (input.orderIds?.length) {
      await Order.updateMany({ _id: { $in: input.orderIds }, 'shippingInfo.delhivery.waybill': { $nin: [null, ''] } }, { $set: { 'shippingInfo.delhivery.pickupRequestedAt': new Date(), 'shippingInfo.delhivery.pickupId': result.pickupId } });
    }
    await AdminActivityLog.create({ adminId: request.user.id, action: 'delhivery_request_pickup', entityType: 'shipping', entityId: result.pickupId || 'pickup', details: { ...input, pickupTime } });
    response.json({ success: true, pickupId: result.pickupId });
  } catch (error) { handleError(error, response, next); }
});

adminShippingRoutes.get('/pending-pickup', async (_request, response, next) => {
  try {
    const orders = await Order.find({ 'shippingInfo.delhivery.waybill': { $nin: [null, ''] }, 'shippingInfo.delhivery.cancelledAt': null, 'shippingInfo.delhivery.pickupRequestedAt': null, status: { $in: ['confirmed', 'processing', 'packed'] } }).sort({ createdAt: 1 }).limit(500).select('_id orderNumber customerName shippingInfo.delhivery.waybill').lean();
    response.json({ success: true, orders: orders.map((order) => ({ id: String(order._id), orderNumber: order.orderNumber || `JE${String(order._id).slice(-8).toUpperCase()}`, customerName: order.customerName, waybill: order.shippingInfo.delhivery.waybill })) });
  } catch (error) { next(error); }
});

adminShippingRoutes.post('/sync-all', requireSameOrigin, async (_request, response, next) => {
  try {
    if (!isDelhiveryConfigured()) return response.status(503).json({ success: false, error: 'Delhivery is not configured' });
    response.json({ success: true, ...(await syncActiveShipments()) });
  } catch (error) { handleError(error, response, next); }
});
