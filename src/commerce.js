import mongoose from 'mongoose';
import { Order, Product } from './models.js';

const priceForSize = (product, size) => {
  const selectedSize = typeof size === 'string' ? product.sizes?.find((item) => item.size === size) : size;
  return Number.isFinite(selectedSize?.price) ? selectedSize.price : product.price;
};
export const calculateSalePrice = (product, size) => {
  const basePrice = priceForSize(product, size);
  return Math.round(Math.max(0, basePrice - (product.isOnSale ? product.discountType === 'percentage' ? basePrice * product.discount / 100 : product.discount : 0)) * 100) / 100;
};
export const uniqueCartLineCount = (lines) => new Set(lines.map((line) => `${line.id}:${line.size}`)).size;
export const uniqueWishlistCount = (products) => new Set(products.map((product) => product.id)).size;

export function makeOrderItems(products, lines) {
  const productsById = new Map(products.map((product) => [String(product._id), product]));
  return lines.map((line) => {
    const product = productsById.get(line.id);
    if (!product) throw new Error('UnavailableProduct');
    const stock = product.sizes.find((entry) => entry.size === line.size)?.stock || 0;
    if (stock < line.quantity) throw new Error('InsufficientStock');
    return { productId: product._id, name: product.name, price: calculateSalePrice(product, line.size), quantity: line.quantity, size: line.size, image: product.imageUrls[0] || '' };
  });
}

// A transaction plus conditional size updates prevents two paid orders from
// reducing the same final item below zero. It is safe for retries/webhooks.
export async function markOrderPaid({ razorpayOrderId, paymentId, source }) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const order = await Order.findOne({ razorpayOrderId }).session(session);
      if (!order) throw new Error('OrderNotFound');
      if (order.paymentStatus === 'paid' || order.stockReducedAt) { result = { order, newlyPaid: false }; return; }
      if (order.status === 'cancelled') throw new Error('OrderCancelled');
      for (const item of order.items) {
        const updated = await Product.updateOne({ _id: item.productId, isActive: true, status: 'published', sizes: { $elemMatch: { size: item.size, stock: { $gte: item.quantity } } } }, { $inc: { 'sizes.$.stock': -item.quantity } }, { session });
        if (updated.modifiedCount !== 1) throw new Error('InsufficientStock');
      }
      order.paymentId = paymentId || order.paymentId;
      order.paymentStatus = 'paid';
      if (order.status === 'pending') { order.status = 'confirmed'; order.statusHistory.push({ status: 'confirmed', changedAt: new Date() }); }
      order.paidAt = new Date(); order.stockReducedAt = new Date(); order.paymentSource = source;
      await order.save({ session });
      result = { order, newlyPaid: true };
    });
    return result;
  } finally { await session.endSession(); }
}
