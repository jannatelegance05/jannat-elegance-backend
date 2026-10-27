import { config } from './config.js';
import { Order } from './models.js';
import { sendOrderStatusEmail } from './email.js';

/* =========================================================
   DELHIVERY ONE CLIENT

   All calls use the account API token issued from
   Delhivery One → Settings → API Setup.
========================================================= */

const BASE_URLS = {
  production: 'https://track.delhivery.com',
  staging: 'https://staging-express.delhivery.com',
};

export const PUBLIC_TRACKING_URL = (waybill) => `https://www.delhivery.com/track-v2/package/${encodeURIComponent(waybill)}`;

export const isDelhiveryConfigured = () => Boolean(config.delhivery.apiToken);

export class DelhiveryError extends Error {
  constructor(message, { status = 502, details } = {}) {
    super(message);
    this.name = 'DelhiveryError';
    this.status = status;
    this.details = details;
  }
}

const baseUrl = () => BASE_URLS[config.delhivery.environment] || BASE_URLS.staging;

async function delhiveryRequest(path, { method = 'GET', query, json, form, timeoutMs = 20000 } = {}) {
  if (!isDelhiveryConfigured()) throw new DelhiveryError('Delhivery is not configured', { status: 503 });
  const url = new URL(path, baseUrl());
  for (const [key, value] of Object.entries(query || {})) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  const headers = { Authorization: `Token ${config.delhivery.apiToken}`, Accept: 'application/json' };
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form !== undefined) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
  let response;
  try {
    response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new DelhiveryError(error?.name === 'TimeoutError' ? 'Delhivery did not respond in time' : 'Unable to reach Delhivery');
  }
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (response.status === 401 || response.status === 403) throw new DelhiveryError('Delhivery rejected the API token', { status: 502, details: data });
  if (!response.ok) throw new DelhiveryError(data?.error || data?.rmk || `Delhivery request failed (${response.status})`, { details: data });
  return data;
}

/* =========================================================
   HELPERS (pure, unit tested)
========================================================= */

// Delhivery's manifest API breaks on a handful of reserved characters.
export const cleanText = (value, max = 200) => String(value || '').replace(/[&#%;\\"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export const cleanPhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
};

export const orderReference = (order) => order.orderNumber || `JE${String(order._id).slice(-8).toUpperCase()}`;

export const isCashOnDelivery = (order) => order.paymentMethod === 'COD' && order.paymentStatus !== 'paid';

/**
 * Maps a Delhivery shipment status to the store's order status.
 * Returns null when the store status should not change.
 */
export function mapDelhiveryStatus(status, statusType) {
  const value = String(status || '').trim().toLowerCase();
  const type = String(statusType || '').trim().toUpperCase();
  if (type === 'DL') return value === 'rto' || value.includes('return') ? 'returned' : 'delivered';
  if (type === 'RT') return value === 'rto' || value.includes('returned') ? 'returned' : null;
  if (type === 'CN' || value.includes('cancel')) return null;
  if (value === 'delivered') return 'delivered';
  if (value === 'dispatched' || value.includes('out for delivery')) return 'out_for_delivery';
  if (value === 'in transit' || value === 'pending' || value === 'picked up' || type === 'PU') return 'in_transit';
  if (value === 'manifested' || value === 'not picked' || type === 'PP') return 'packed';
  return null;
}

// Order statuses only move forward automatically; manual admin edits are unaffected.
const PROGRESS = ['confirmed', 'processing', 'packed', 'shipped', 'in_transit', 'out_for_delivery', 'delivered'];
export function shouldAdvanceStatus(current, next) {
  if (!next || next === current) return false;
  if (['cancelled', 'returned', 'exchanged'].includes(current)) return false;
  if (next === 'returned') return true;
  const from = PROGRESS.indexOf(current === 'pending' ? 'confirmed' : current);
  const to = PROGRESS.indexOf(next);
  return to > from;
}

export function buildShipmentPayload(order, options = {}) {
  const settings = config.delhivery;
  const cod = isCashOnDelivery(order);
  const quantity = (order.items || []).reduce((sum, item) => sum + (item.quantity || 0), 0) || 1;
  const description = (order.items || []).map((item) => `${item.name}${item.size ? ` (${item.size})` : ''} x${item.quantity}`).join(', ');
  return {
    shipments: [{
      name: cleanText(order.customerName, 100),
      add: cleanText(order.shippingAddress, 500),
      pin: String(order.postalCode || '').trim(),
      city: cleanText(order.city, 80),
      state: cleanText(order.state, 80),
      country: 'India',
      phone: cleanPhone(order.customerPhone),
      order: options.reference || orderReference(order),
      payment_mode: cod ? 'COD' : 'Prepaid',
      cod_amount: cod ? String(order.total || 0) : '0',
      total_amount: String(order.total || 0),
      order_date: new Date(order.createdAt || Date.now()).toISOString(),
      products_desc: cleanText(description || 'Apparel', 500),
      hsn_code: settings.hsnCode,
      quantity: String(quantity),
      seller_name: cleanText(settings.sellerName, 100),
      seller_add: cleanText(settings.sellerAddress, 300),
      seller_gst_tin: settings.sellerGstin,
      seller_inv: orderReference(order),
      waybill: '',
      weight: String(options.weightGrams || settings.defaultWeightGrams),
      shipment_length: String(options.lengthCm || settings.defaultLengthCm),
      shipment_width: String(options.widthCm || settings.defaultWidthCm),
      shipment_height: String(options.heightCm || settings.defaultHeightCm),
      shipping_mode: options.shippingMode || settings.shippingMode,
      address_type: 'home',
    }],
    pickup_location: { name: settings.pickupLocation },
  };
}

export function parseTracking(data) {
  const shipment = data?.ShipmentData?.[0]?.Shipment;
  if (!shipment) return null;
  const scans = (shipment.Scans || []).map(({ ScanDetail: scan = {} }) => ({
    status: scan.Scan || '',
    statusType: scan.ScanType || '',
    location: scan.ScannedLocation || '',
    instructions: scan.Instructions || '',
    at: scan.ScanDateTime ? new Date(scan.ScanDateTime) : null,
  })).filter((scan) => scan.status);
  return {
    waybill: shipment.AWB || '',
    status: shipment.Status?.Status || '',
    statusType: shipment.Status?.StatusType || '',
    location: shipment.Status?.StatusLocation || '',
    instructions: shipment.Status?.Instructions || '',
    statusAt: shipment.Status?.StatusDateTime ? new Date(shipment.Status.StatusDateTime) : null,
    expectedDeliveryDate: shipment.ExpectedDeliveryDate || shipment.PromisedDeliveryDate ? new Date(shipment.ExpectedDeliveryDate || shipment.PromisedDeliveryDate) : null,
    scans,
  };
}

/* =========================================================
   API OPERATIONS
========================================================= */

export async function checkServiceability(pincode) {
  const data = await delhiveryRequest('/c/api/pin-codes/json/', { query: { filter_codes: pincode } });
  const entry = data?.delivery_codes?.[0]?.postal_code;
  if (!entry) return { pincode, serviceable: false, prepaid: false, cod: false, city: '', state: '' };
  const embargoed = Boolean(String(entry.remarks || '').trim());
  return {
    pincode,
    serviceable: !embargoed && (entry.pre_paid === 'Y' || entry.cod === 'Y'),
    prepaid: !embargoed && entry.pre_paid === 'Y',
    cod: !embargoed && entry.cod === 'Y',
    pickup: entry.pickup === 'Y',
    city: entry.city || entry.district || '',
    state: entry.state_code || '',
    remarks: entry.remarks || '',
  };
}

export async function getShippingRate({ pincode, weightGrams, paymentMode = 'Pre-paid', codAmount = 0, shippingMode }) {
  const data = await delhiveryRequest('/api/kinko/v1/invoice/charges/.json', {
    query: {
      md: (shippingMode || config.delhivery.shippingMode) === 'Express' ? 'E' : 'S',
      ss: 'Delivered',
      d_pin: pincode,
      o_pin: config.delhivery.originPincode,
      cgm: weightGrams || config.delhivery.defaultWeightGrams,
      pt: paymentMode === 'COD' ? 'COD' : 'Pre-paid',
      cod: paymentMode === 'COD' ? codAmount : 0,
    },
  });
  const charge = Array.isArray(data) ? data[0] : data;
  return { total: Number(charge?.total_amount || 0), breakdown: charge || {} };
}

export async function trackWaybill(waybill) {
  return parseTracking(await delhiveryRequest('/api/v1/packages/json/', { query: { waybill } }));
}

export async function getLabelUrl(waybill) {
  const data = await delhiveryRequest('/api/p/packing_slip', { query: { wbns: waybill, pdf: 'true' } });
  const url = data?.packages?.[0]?.pdf_download_link;
  if (!url) throw new DelhiveryError('Delhivery did not return a shipping label yet', { details: data });
  return url;
}

export async function requestPickup({ pickupDate, pickupTime, packageCount }) {
  const data = await delhiveryRequest('/fm/request/new/', {
    method: 'POST',
    json: { pickup_location: config.delhivery.pickupLocation, pickup_date: pickupDate, pickup_time: pickupTime, expected_package_count: packageCount },
  });
  if (data?.error || !data?.pickup_id) {
    const message = data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || (data?.pr_exist ? 'A pickup is already scheduled for this date' : 'Pickup request was not accepted');
    throw new DelhiveryError(message, { status: 400, details: data });
  }
  return { pickupId: data?.pickup_id ? String(data.pickup_id) : '', response: data };
}

/* =========================================================
   ORDER WORKFLOWS
========================================================= */

const pushHistory = (order, status) => {
  order.status = status;
  order.statusHistory.push({ status, changedAt: new Date() });
  if (status === 'delivered' && !order.deliveredAt) order.deliveredAt = new Date();
};

export async function createShipment(order, options = {}) {
  const existing = order.shippingInfo?.delhivery;
  if (order.shippingInfo?.trackingNumber && existing?.waybill && !existing.cancelledAt) throw new DelhiveryError('A Delhivery shipment already exists for this order', { status: 409 });
  if (['cancelled', 'delivered', 'returned'].includes(order.status)) throw new DelhiveryError('This order can no longer be shipped', { status: 409 });
  if (!config.delhivery.pickupLocation) throw new DelhiveryError('DELHIVERY_PICKUP_LOCATION is not configured', { status: 503 });

  // Delhivery rejects reused order references, so re-shipments get a suffix.
  const attempt = (existing?.attempts || 0) + 1;
  const reference = attempt > 1 ? `${orderReference(order)}-R${attempt - 1}` : orderReference(order);
  const payload = buildShipmentPayload(order, { ...options, reference });
  const data = await delhiveryRequest('/api/cmu/create.json', { method: 'POST', form: { format: 'json', data: JSON.stringify(payload) }, timeoutMs: 30000 });
  const pkg = data?.packages?.[0];
  if (!data?.success || !pkg?.waybill || String(pkg.status).toLowerCase() !== 'success') {
    const remarks = [].concat(pkg?.remarks || data?.rmk || 'Shipment was not accepted').filter(Boolean).join('; ');
    throw new DelhiveryError(remarks, { status: 400, details: data });
  }

  order.shippingInfo = {
    courierName: 'Delhivery',
    trackingNumber: pkg.waybill,
    trackingUrl: PUBLIC_TRACKING_URL(pkg.waybill),
    provider: 'delhivery',
    delhivery: {
      waybill: pkg.waybill,
      reference,
      attempts: attempt,
      paymentMode: payload.shipments[0].payment_mode,
      shippingMode: payload.shipments[0].shipping_mode,
      weightGrams: Number(payload.shipments[0].weight),
      status: 'Manifested',
      statusType: 'UD',
      statusAt: new Date(),
      createdAt: new Date(),
      lastSyncedAt: new Date(),
      scans: [],
    },
  };
  if (shouldAdvanceStatus(order.status, 'packed')) pushHistory(order, 'packed');
  await order.save();
  return order;
}

export async function cancelShipment(order) {
  const waybill = order.shippingInfo?.delhivery?.waybill;
  if (!waybill || order.shippingInfo.delhivery.cancelledAt) throw new DelhiveryError('No active Delhivery shipment on this order', { status: 409 });
  const data = await delhiveryRequest('/api/p/edit', { method: 'POST', json: { waybill, cancellation: 'true' } });
  if (data?.status === false || data?.error) throw new DelhiveryError(data?.remark || data?.error || 'Delhivery could not cancel this shipment', { status: 400, details: data });
  order.shippingInfo.delhivery.cancelledAt = new Date();
  order.shippingInfo.delhivery.status = 'Cancelled';
  order.shippingInfo.delhivery.statusType = 'CN';
  order.shippingInfo.trackingNumber = '';
  order.shippingInfo.trackingUrl = '';
  order.markModified('shippingInfo');
  await order.save();
  return order;
}

/**
 * Stores the latest tracking snapshot on the order and advances
 * the order status. Returns whether the order status changed.
 */
export async function applyTracking(order, tracking, { notify = true } = {}) {
  const info = order.shippingInfo.delhivery;
  info.status = tracking.status || info.status;
  info.statusType = tracking.statusType || info.statusType;
  info.location = tracking.location || info.location;
  info.instructions = tracking.instructions || info.instructions;
  info.statusAt = tracking.statusAt || info.statusAt;
  if (tracking.expectedDeliveryDate) info.expectedDeliveryDate = tracking.expectedDeliveryDate;
  if (tracking.scans?.length) info.scans = tracking.scans.slice(-100);
  info.lastSyncedAt = new Date();
  info.lastError = '';

  const next = mapDelhiveryStatus(tracking.status, tracking.statusType);
  const statusChanged = shouldAdvanceStatus(order.status, next);
  if (statusChanged) pushHistory(order, next);
  order.markModified('shippingInfo');
  await order.save();
  if (statusChanged && notify) sendOrderStatusEmail(order).catch(() => console.error('Delhivery status email failed'));
  return statusChanged;
}

export async function syncOrderTracking(order, options) {
  const waybill = order.shippingInfo?.delhivery?.waybill;
  if (!waybill || order.shippingInfo.delhivery.cancelledAt) throw new DelhiveryError('No active Delhivery shipment on this order', { status: 409 });
  const tracking = await trackWaybill(waybill);
  if (!tracking) throw new DelhiveryError('Delhivery has no tracking data for this shipment yet', { status: 404 });
  const statusChanged = await applyTracking(order, tracking, options);
  return { order, statusChanged };
}

const activeShipmentQuery = () => ({
  'shippingInfo.delhivery.waybill': { $nin: [null, ''] },
  'shippingInfo.delhivery.cancelledAt': null,
  status: { $nin: ['delivered', 'cancelled', 'returned', 'exchanged'] },
});

export async function syncActiveShipments({ limit = 200 } = {}) {
  const orders = await Order.find(activeShipmentQuery()).sort({ 'shippingInfo.delhivery.lastSyncedAt': 1 }).limit(limit);
  let updated = 0; let failed = 0;
  for (const order of orders) {
    try { if ((await syncOrderTracking(order)).statusChanged) updated += 1; } catch (error) {
      failed += 1;
      order.shippingInfo.delhivery.lastError = error.message;
      order.markModified('shippingInfo');
      await order.save().catch(() => {});
    }
  }
  return { checked: orders.length, updated, failed };
}

export function startTrackingScheduler() {
  const minutes = config.delhivery.syncIntervalMinutes;
  console.log(isDelhiveryConfigured()
    ? `Delhivery: ${config.delhivery.environment}, pickup "${config.delhivery.pickupLocation || 'not set'}", sync every ${minutes || 0} min`
    : 'Delhivery: not configured (DELHIVERY_API_TOKEN missing)');
  if (!isDelhiveryConfigured() || !minutes) return null;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const result = await syncActiveShipments();
      if (result.checked) console.log('Delhivery tracking sync', result);
    } catch (error) { console.error('Delhivery tracking sync failed', error?.message); } finally { running = false; }
  }, minutes * 60 * 1000);
  timer.unref();
  return timer;
}

/* =========================================================
   FORMATTERS
========================================================= */

export function formatDelhivery(info, { includeScans = true } = {}) {
  if (!info?.waybill) return null;
  return {
    waybill: info.waybill,
    reference: info.reference || '',
    paymentMode: info.paymentMode || '',
    shippingMode: info.shippingMode || '',
    weightGrams: info.weightGrams || 0,
    status: info.status || '',
    statusType: info.statusType || '',
    location: info.location || '',
    instructions: info.instructions || '',
    statusAt: info.statusAt || null,
    expectedDeliveryDate: info.expectedDeliveryDate || null,
    createdAt: info.createdAt || null,
    cancelledAt: info.cancelledAt || null,
    lastSyncedAt: info.lastSyncedAt || null,
    lastError: info.lastError || '',
    pickupRequestedAt: info.pickupRequestedAt || null,
    pickupId: info.pickupId || '',
    scans: includeScans ? (info.scans || []).map((scan) => ({ status: scan.status, statusType: scan.statusType, location: scan.location, instructions: scan.instructions, at: scan.at })) : [],
  };
}
