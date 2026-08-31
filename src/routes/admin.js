import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import {
  AdminActivityLog,
  Order,
  Product,
  Testimonial,
} from '../models.js';
import { requireAdmin, requireAuth, requireSameOrigin } from '../auth.js';
import { sendOrderStatusEmail } from '../email.js';
import { applyOrderTransition, isSafeTrackingUrl, LEGACY_STATUSES, normalizeStatus, ORDER_STATUSES } from '../order-status.js';

const router = Router(); const statuses = [...ORDER_STATUSES, ...LEGACY_STATUSES];
const audit = (adminId, action, entityType, entityId, details) => AdminActivityLog.create({ adminId, action, entityType, entityId, details });
const formatOrder = (order) => ({ ...order, id: String(order._id), userId: String(order.userId), status: normalizeStatus(order.status), shippingInfo: { courierName: order.shippingInfo?.courierName || '', trackingNumber: order.shippingInfo?.trackingNumber || '', trackingUrl: order.shippingInfo?.trackingUrl || '' }, statusHistory: (order.statusHistory || []).map((entry) => ({ status: entry.status, changedAt: entry.changedAt, changedBy: entry.changedBy })), items: order.items.map((item) => ({ ...item, id: String(item._id), productId: String(item.productId) })) });
const dayStart = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
router.use(requireAuth, requireAdmin);


/* =========================================================
   TESTIMONIAL MANAGEMENT
========================================================= */

const testimonialSchema = z
  .object({
    name: z.string().trim().min(2).max(100),

    designation: z.string().trim().max(150).optional(),

    message: z.string().trim().min(10).max(1000),

    rating: z.number().int().min(1).max(5),

    image: z.string().trim().max(2048).optional(),

    isApproved: z.boolean().optional(),

    isFeatured: z.boolean().optional(),
  })
  .strict();


/* =========================================================
   GET ALL TESTIMONIALS - ADMIN
========================================================= */

router.get('/testimonials', async (request, response, next) => {
  try {
    const page = Math.max(
      1,
      Number(request.query.page) || 1
    );

    const limit = Math.min(
      50,
      Math.max(1, Number(request.query.limit) || 20)
    );

    const query = {};

    if (typeof request.query.approved === 'string') {
      if (request.query.approved === 'true') {
        query.isApproved = true;
      }

      if (request.query.approved === 'false') {
        query.isApproved = false;
      }
    }

    if (
      typeof request.query.search === 'string' &&
      request.query.search.trim()
    ) {
      const term = request.query.search
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      query.$or = [
        {
          name: {
            $regex: term,
            $options: 'i',
          },
        },
        {
          message: {
            $regex: term,
            $options: 'i',
          },
        },
      ];
    }

    const [testimonials, total] = await Promise.all([
      Testimonial.find(query)
        .sort({
          createdAt: -1,
        })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),

      Testimonial.countDocuments(query),
    ]);

    return response.json({
      success: true,

      testimonials: testimonials.map((testimonial) => ({
        ...testimonial,
        id: String(testimonial._id),

        userId: testimonial.userId
          ? String(testimonial.userId)
          : null,
      })),

      page,

      pages: Math.max(
        1,
        Math.ceil(total / limit)
      ),

      total,
    });
  } catch (error) {
    next(error);
  }
});


/* =========================================================
   ADD TESTIMONIAL - ADMIN
========================================================= */

router.post(
  '/testimonials',
  requireSameOrigin,
  async (request, response, next) => {
    try {
      const input = testimonialSchema.parse(request.body);

      const testimonial = await Testimonial.create({
        name: input.name,

        designation: input.designation || '',

        message: input.message,

        rating: input.rating,

        image: input.image || '',

        isApproved:
          input.isApproved !== undefined
            ? input.isApproved
            : true,

        isFeatured:
          input.isFeatured !== undefined
            ? input.isFeatured
            : false,
      });

      await audit(
        request.user.id,
        'create',
        'testimonial',
        String(testimonial._id),
        {
          name: testimonial.name,
          rating: testimonial.rating,
        }
      );

      return response.status(201).json({
        success: true,

        testimonial: {
          ...testimonial.toObject(),

          id: String(testimonial._id),

          userId: testimonial.userId
            ? String(testimonial.userId)
            : null,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);


/* =========================================================
   UPDATE TESTIMONIAL
========================================================= */

router.patch(
  '/testimonials/:id',
  requireSameOrigin,
  async (request, response, next) => {
    try {
      if (!mongoose.isValidObjectId(request.params.id)) {
        return response.status(404).json({
          success: false,
          error: 'Testimonial not found',
        });
      }

      const input = testimonialSchema
        .partial()
        .strict()
        .parse(request.body);

      if (Object.keys(input).length === 0) {
        return response.status(400).json({
          success: false,
          error: 'No changes provided',
        });
      }

      const testimonial =
        await Testimonial.findByIdAndUpdate(
          request.params.id,
          {
            $set: {
              ...input,
            },
          },
          {
            new: true,
            runValidators: true,
          }
        );

      if (!testimonial) {
        return response.status(404).json({
          success: false,
          error: 'Testimonial not found',
        });
      }

      await audit(
        request.user.id,
        'update',
        'testimonial',
        String(testimonial._id),
        input
      );

      return response.json({
        success: true,

        testimonial: {
          ...testimonial.toObject(),

          id: String(testimonial._id),

          userId: testimonial.userId
            ? String(testimonial.userId)
            : null,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);


/* =========================================================
   DELETE TESTIMONIAL
========================================================= */

router.delete(
  '/testimonials/:id',
  requireSameOrigin,
  async (request, response, next) => {
    try {
      if (!mongoose.isValidObjectId(request.params.id)) {
        return response.status(404).json({
          success: false,
          error: 'Testimonial not found',
        });
      }

      const testimonial =
        await Testimonial.findById(
          request.params.id
        );

      if (!testimonial) {
        return response.status(404).json({
          success: false,
          error: 'Testimonial not found',
        });
      }

      await Testimonial.deleteOne({
        _id: testimonial._id,
      });

      await audit(
        request.user.id,
        'delete',
        'testimonial',
        String(testimonial._id),
        {
          name: testimonial.name,
          rating: testimonial.rating,
        }
      );

      return response.json({
        success: true,
        message: 'Testimonial deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);


router.get('/orders', async (request, response, next) => { try {
  const page = Math.max(1, Number(request.query.page) || 1); const limit = Math.min(50, Math.max(1, Number(request.query.limit) || 20)); const query = {};
  if (typeof request.query.status === 'string' && statuses.includes(request.query.status)) query.status = request.query.status;
  if (typeof request.query.search === 'string' && request.query.search.trim()) { const term = request.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); query.$or = [{ customerName: { $regex: term, $options: 'i' } }, { customerEmail: { $regex: term, $options: 'i' } }]; if (mongoose.isValidObjectId(request.query.search)) query.$or.push({ _id: request.query.search }); }
  const dateRange = {}; if (typeof request.query.from === 'string' && request.query.from && !Number.isNaN(Date.parse(request.query.from))) dateRange.$gte = new Date(request.query.from); if (typeof request.query.to === 'string' && request.query.to && !Number.isNaN(Date.parse(request.query.to))) { const to = new Date(request.query.to); to.setHours(23, 59, 59, 999); dateRange.$lte = to; } if (Object.keys(dateRange).length) query.createdAt = dateRange;
  const [orders, total] = await Promise.all([Order.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Order.countDocuments(query)]);
  response.json({ success: true, orders: orders.map(formatOrder), page, pages: Math.max(1, Math.ceil(total / limit)), total });
} catch (error) { next(error); } });
router.get('/orders/:id', async (request, response, next) => { try { if (!mongoose.isValidObjectId(request.params.id)) return response.status(404).json({ success: false, error: 'Order not found' }); const order = await Order.findById(request.params.id).lean(); if (!order) return response.status(404).json({ success: false, error: 'Order not found' }); response.json({ success: true, order: formatOrder(order) }); } catch (error) { next(error); } });
router.patch('/orders/:id', requireSameOrigin, async (request, response, next) => { try {
  if (!mongoose.isValidObjectId(request.params.id)) return response.status(404).json({ success: false, error: 'Order not found' });
  const input = z.object({ status: z.enum([...ORDER_STATUSES, ...LEGACY_STATUSES]).optional(), adminNotes: z.string().trim().max(2000).optional(), cancelReason: z.string().trim().max(500).optional(), courierName: z.string().trim().max(80).optional(), trackingNumber: z.string().trim().max(120).optional(), trackingUrl: z.string().trim().max(2048).optional(), sendEmail: z.boolean().default(true) }).strict().superRefine((value, context) => { if (value.trackingUrl !== undefined && !isSafeTrackingUrl(value.trackingUrl)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Tracking URL must use http or https' }); }).parse(request.body);
  const result = await applyOrderTransition({ orderId: request.params.id, adminId: request.user.id, input });
  await audit(request.user.id, 'update_shipping_status', 'order', String(result.order._id), { from: result.previousStatus, to: result.order.status, shippingChanged: result.shippingChanged, notesChanged: input.adminNotes !== undefined });
  let notificationFailed = false;
  if (result.notificationRequired && input.sendEmail) { try { await sendOrderStatusEmail(result.order); } catch { notificationFailed = true; console.error('Order status email failed'); } }
  response.json({ success: true, order: formatOrder(result.order.toObject()), notificationFailed, unchanged: !result.changed });
} catch (error) { if (['OrderNotFound'].includes(error.message)) return response.status(404).json({ success: false, error: 'Order not found' }); if (error.message === 'InvalidStatusTransition') return response.status(400).json({ success: false, error: 'Select a valid order status' }); next(error); } });
router.delete('/orders/:id', requireSameOrigin, async (request, response, next) => { try {
  if (!mongoose.isValidObjectId(request.params.id)) return response.status(404).json({ success: false, error: 'Order not found' });
  const order = await Order.findById(request.params.id);
  if (!order) return response.status(404).json({ success: false, error: 'Order not found' });
  if (normalizeStatus(order.status) !== 'cancelled') return response.status(409).json({ success: false, error: 'Cancel the order before deleting its history' });
  await Order.deleteOne({ _id: order._id });
  await audit(request.user.id, 'delete', 'order', String(order._id), { customerEmail: order.customerEmail, total: order.total, status: order.status });
  response.json({ success: true });
} catch (error) { next(error); } });
router.get('/dashboard', async (_request, response, next) => { try {
  const now = new Date(); const today = dayStart(now); const month = new Date(now.getFullYear(), now.getMonth(), 1); const paid = { paymentStatus: 'paid', status: { $ne: 'cancelled' } };
  const [todayData, monthData, productCount, lowStock, recentOrders] = await Promise.all([
    Order.aggregate([{ $match: { ...paid, createdAt: { $gte: today } } }, { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: '$total' } } }]),
    Order.aggregate([{ $match: { ...paid, createdAt: { $gte: month } } }, { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: '$total' } } }]), Product.countDocuments({ isActive: true }),
    Product.aggregate([{ $match: { isActive: true } }, { $unwind: '$sizes' }, { $match: { 'sizes.stock': { $lte: 5 } } }, { $project: { name: 1, size: '$sizes.size', stock: '$sizes.stock' } }, { $sort: { stock: 1 } }, { $limit: 20 }]), Order.find().sort({ createdAt: -1 }).limit(10).lean(),
  ]);
  response.json({ success: true, summary: { today: todayData[0] || { orders: 0, revenue: 0 }, month: monthData[0] || { orders: 0, revenue: 0 }, productCount, lowStockCount: lowStock.length }, lowStock, recentOrders: recentOrders.map(formatOrder) });
} catch (error) { next(error); } });
router.get('/analytics', async (request, response, next) => { try {
  const range = ['daily', 'weekly', 'monthly'].includes(request.query.range) ? request.query.range : 'daily'; const now = new Date(); const from = new Date(now); from.setDate(now.getDate() - (range === 'daily' ? 30 : range === 'weekly' ? 84 : 365)); const dateFormat = range === 'monthly' ? '%Y-%m' : '%Y-%m-%d'; const paid = { paymentStatus: 'paid', status: { $ne: 'cancelled' }, createdAt: { $gte: from } };
  const [revenue, bestSellers, categorySales, statusDistribution] = await Promise.all([
    Order.aggregate([{ $match: paid }, { $group: { _id: { $dateToString: { format: dateFormat, date: '$createdAt' } }, revenue: { $sum: '$total' }, orders: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Order.aggregate([{ $match: paid }, { $unwind: '$items' }, { $group: { _id: '$items.productId', name: { $first: '$items.name' }, sold: { $sum: '$items.quantity' }, revenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } } } }, { $sort: { sold: -1 } }, { $limit: 10 }]),
    Order.aggregate([{ $match: paid }, { $unwind: '$items' }, { $lookup: { from: 'products', localField: 'items.productId', foreignField: '_id', as: 'product' } }, { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } }, { $lookup: { from: 'categories', localField: 'product.categoryId', foreignField: '_id', as: 'category' } }, { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } }, { $group: { _id: { $ifNull: ['$category.name', 'Uncategorized'] }, revenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } }, items: { $sum: '$items.quantity' } } }, { $sort: { revenue: -1 } }]),
    Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
  ]);
  response.json({ success: true, range, revenue: revenue.map((item) => ({ date: item._id, revenue: item.revenue, orders: item.orders })), bestSellers, categorySales: categorySales.map((item) => ({ category: item._id, revenue: item.revenue, items: item.items })), statusDistribution: statusDistribution.map((item) => ({ status: item._id, count: item.count })) });
} catch (error) { next(error); } });
router.get('/activity', async (request, response, next) => { try { const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 30)); response.json({ success: true, activity: await AdminActivityLog.find().populate('adminId', 'name email').sort({ createdAt: -1 }).limit(limit).lean() }); } catch (error) { next(error); } });
export default router;
