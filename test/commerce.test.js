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
