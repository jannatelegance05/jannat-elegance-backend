import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateSalePrice, makeOrderItems, uniqueCartLineCount, uniqueWishlistCount } from '../src/commerce.js';
import { hasAllowedImageSignature } from '../src/image-validation.js';
import { isSafeTrackingUrl, isValidStatusTransition, normalizeStatus } from '../src/order-status.js';

const product = { _id: '0123456789abcdef01234567', name: 'Test Suit', price: 2000, discount: 25, discountType: 'percentage', isOnSale: true, imageUrls: [], sizes: [{ size: 'M', stock: 2 }] };
test('sale price is calculated server-side', () => assert.equal(calculateSalePrice(product), 1500));
test('selected size price is used for cart and order totals', () => {
  const sizedProduct = { ...product, sizes: [{ size: 'M', stock: 2, price: 2400 }] };
  assert.equal(calculateSalePrice(sizedProduct, 'M'), 1800);
  assert.equal(makeOrderItems([sizedProduct], [{ id: String(sizedProduct._id), size: 'M', quantity: 1 }])[0].price, 1800);
});
test('flat sale discount never becomes negative', () => assert.equal(calculateSalePrice({ ...product, price: 100, discount: 500, discountType: 'flat' }), 0));
test('cart badge counts product-size lines rather than quantities', () => assert.equal(uniqueCartLineCount([{ id: 'a', size: 'M', quantity: 5 }, { id: 'a', size: 'L', quantity: 1 }, { id: 'a', size: 'M', quantity: 1 }]), 2));
test('wishlist badge counts unique products', () => assert.equal(uniqueWishlistCount([{ id: 'a' }, { id: 'b' }, { id: 'b' }]), 2));
test('unavailable stock rejects an order line', () => assert.throws(() => makeOrderItems([product], [{ id: String(product._id), size: 'M', quantity: 3 }]), /InsufficientStock/));
test('invalid image bytes are rejected', () => { assert.equal(hasAllowedImageSignature(Buffer.from('not an image')), false); assert.equal(hasAllowedImageSignature(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), true); });
test('administrators can set any valid operational order status directly', () => { assert.equal(isValidStatusTransition('confirmed', 'out_for_delivery'), true); assert.equal(isValidStatusTransition('delivered', 'processing'), true); assert.equal(isValidStatusTransition('cancelled', 'shipped'), true); assert.equal(isValidStatusTransition('confirmed', 'not-a-status'), false); assert.equal(normalizeStatus('pending'), 'confirmed'); });
test('tracking URLs only allow http and https', () => { assert.equal(isSafeTrackingUrl('https://example.com/track/1'), true); assert.equal(isSafeTrackingUrl('javascript:alert(1)'), false); assert.equal(isSafeTrackingUrl('data:text/html,test'), false); });

test('Delhivery statuses map onto store order statuses', async () => {
  const { mapDelhiveryStatus } = await import('../src/delhivery.js');
  assert.equal(mapDelhiveryStatus('Manifested', 'UD'), 'packed');
  assert.equal(mapDelhiveryStatus('In Transit', 'UD'), 'in_transit');
  assert.equal(mapDelhiveryStatus('Dispatched', 'UD'), 'out_for_delivery');
  assert.equal(mapDelhiveryStatus('Delivered', 'DL'), 'delivered');
  assert.equal(mapDelhiveryStatus('RTO', 'DL'), 'returned');
  assert.equal(mapDelhiveryStatus('In Transit', 'RT'), null);
  assert.equal(mapDelhiveryStatus('Canceled', 'CN'), null);
});
test('Delhivery sync only moves order status forward', async () => {
  const { shouldAdvanceStatus } = await import('../src/delhivery.js');
  assert.equal(shouldAdvanceStatus('confirmed', 'packed'), true);
  assert.equal(shouldAdvanceStatus('out_for_delivery', 'in_transit'), false);
  assert.equal(shouldAdvanceStatus('cancelled', 'delivered'), false);
  assert.equal(shouldAdvanceStatus('in_transit', 'returned'), true);
});
test('Delhivery manifest payload is sanitised and prepaid by default', async () => {
  const { buildShipmentPayload } = await import('../src/delhivery.js');
  const order = { _id: '0123456789abcdef01234567', orderNumber: 'JE123', customerName: 'Asha & Co', customerPhone: '+91 98765 43210', shippingAddress: 'Flat #4; MG Road', city: 'Jaipur', state: 'Rajasthan', postalCode: '302001', total: 1800, paymentMethod: 'RAZORPAY', paymentStatus: 'paid', items: [{ name: 'Suit', size: 'M', quantity: 2 }] };
  const shipment = buildShipmentPayload(order, { weightGrams: 700 }).shipments[0];
  assert.equal(shipment.phone, '9876543210');
  assert.equal(shipment.name, 'Asha Co');
  assert.equal(shipment.add, 'Flat 4 MG Road');
  assert.equal(shipment.payment_mode, 'Prepaid');
  assert.equal(shipment.cod_amount, '0');
  assert.equal(shipment.order, 'JE123');
  assert.equal(shipment.weight, '700');
  assert.equal(shipment.quantity, '2');
  assert.equal(buildShipmentPayload({ ...order, paymentMethod: 'COD', paymentStatus: 'pending' }).shipments[0].cod_amount, '1800');
});
test('Delhivery tracking response is parsed into scans', async () => {
  const { parseTracking } = await import('../src/delhivery.js');
  const tracking = parseTracking({ ShipmentData: [{ Shipment: { AWB: '123', Status: { Status: 'In Transit', StatusType: 'UD', StatusLocation: 'Jaipur_Hub', StatusDateTime: '2026-10-27T10:00:00' }, Scans: [{ ScanDetail: { Scan: 'Manifested', ScanType: 'UD', ScannedLocation: 'Jaipur', ScanDateTime: '2026-10-26T10:00:00' } }] } }] });
  assert.equal(tracking.waybill, '123');
  assert.equal(tracking.status, 'In Transit');
  assert.equal(tracking.scans.length, 1);
  assert.equal(parseTracking({}), null);
});
