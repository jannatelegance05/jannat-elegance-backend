import { Router } from 'express';
import mongoose from 'mongoose';
import { Order, Product } from '../models.js';
import { requireAuth } from '../auth.js';
import { isSafeTrackingUrl, normalizeStatus } from '../order-status.js';

const router = Router();
const formatCustomerOrder = (order) => ({ ...order, id: String(order._id), status: normalizeStatus(order.status), shippingInfo: { courierName: order.shippingInfo?.courierName || '', trackingNumber: order.shippingInfo?.trackingNumber || '', trackingUrl: isSafeTrackingUrl(order.shippingInfo?.trackingUrl) ? order.shippingInfo.trackingUrl : '' }, statusHistory: (order.statusHistory || []).map((entry) => ({ status: entry.status, changedAt: entry.changedAt })), items: order.items.map((item) => ({ ...item, id: String(item._id), productId: String(item.productId) })) });
router.get('/', requireAuth, async (request, response, next) => {
  try {
    const orders = await Order.find({ userId: request.user.id, paymentStatus: 'paid' }).sort({ createdAt: -1 }).limit(50).lean();
    response.json({ success: true, orders: orders.map(formatCustomerOrder) });
  } catch (error) { next(error); }
});
router.get('/:id', requireAuth, async (request, response, next) => {
  try {
    if (!mongoose.isValidObjectId(request.params.id)) return response.status(404).json({ success: false, error: 'Order not found' });
    const order = await Order.findOne({ _id: request.params.id, userId: request.user.id, paymentStatus: 'paid' }).lean();
    if (!order) return response.status(404).json({ success: false, error: 'Order not found' });
    const productIds = order.items.map((item) => item.productId).filter(Boolean);
    const purchased = await Product.find({ _id: { $in: productIds } }).populate('categoryId', 'name').lean();
    const categoryIds = [...new Set(purchased.map((product) => String(product.categoryId?._id || product.categoryId)).filter(Boolean))];
    const related = categoryIds.length ? await Product.find({ _id: { $nin: productIds }, categoryId: { $in: categoryIds }, isActive: true, status: 'published' }).populate('categoryId', 'name').sort({ createdAt: -1 }).limit(4).lean() : [];
    const formatProduct = (product) => ({ ...product, id: String(product._id), category: product.categoryId?.name || '', categoryId: String(product.categoryId?._id || product.categoryId), salePrice: product.isOnSale ? Math.round(Math.max(0, product.price - (product.discountType === 'percentage' ? product.price * product.discount / 100 : product.discount)) * 100) / 100 : product.price });
    response.json({ success: true, order: formatCustomerOrder(order), relatedProducts: related.map(formatProduct) });
  } catch (error) { next(error); }
});
export default router;
