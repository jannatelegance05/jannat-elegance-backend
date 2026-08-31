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


router.get('/track', async (req, res) => {
  try {
    const { orderId } = req.query;

    /* ================================================
       VALIDATE ORDER ID
    ================================================= */

    if (!orderId || typeof orderId !== 'string') {
      return res.status(400).json({
        error: 'Order ID is required.',
      });
    }

    const cleanOrderId = orderId
      .trim()
      .replace(/^JE/i, '')
      .toUpperCase();

    if (!cleanOrderId) {
      return res.status(400).json({
        error: 'Please enter a valid Order ID.',
      });
    }

    let order = null;

    /* ================================================
       METHOD 1
       FULL MONGODB OBJECT ID

       Example:
       JE68B123456789ABCDEF123456
    ================================================= */

    if (mongoose.Types.ObjectId.isValid(cleanOrderId)) {
      order = await Order.findById(cleanOrderId).lean();
    }

    /* ================================================
       METHOD 2
       LAST 8 CHARACTERS OF MONGODB ID

       Example database ID:

       68B123456789ABCDEF123456

       User enters:

       JEEF123456
    ================================================= */

    if (!order && cleanOrderId.length === 8) {
      const orders = await Order.find({})
        .sort({ createdAt: -1 })
        .select(
          '_id createdAt customerName customerPhone status total items shippingInfo statusHistory'
        )
        .lean();

      order =
        orders.find(
          (item) =>
            item._id
              .toString()
              .slice(-8)
              .toUpperCase() === cleanOrderId
        ) || null;
    }

    /* ================================================
       ORDER NOT FOUND
    ================================================= */

    if (!order) {
      return res.status(404).json({
        error:
          'We could not find an order with this Order ID.',
      });
    }

    /* ================================================
       NORMALIZE STATUS
    ================================================= */

    const normalizedStatus = normalizeStatus(
      order.status || 'pending'
    );

    /* ================================================
       STATUS HISTORY
    ================================================= */

    let statusHistory = (order.statusHistory || [])
      .map((history) => ({
        status: normalizeStatus(history.status),

        changedAt:
          history.changedAt || order.createdAt,
      }))
      .filter(
        (history) =>
          history.status !== 'pending'
      );

    /*
      IMPORTANT:

      Old orders may not have statusHistory.

      Add fallback status.
    */

    if (statusHistory.length === 0) {
      statusHistory = [
        {
          status: normalizedStatus,

          changedAt: order.createdAt,
        },
      ];
    }

    /* ================================================
       RETURN TRACKING DATA
    ================================================= */

    return res.status(200).json({
      order: {
        /*
          Return MongoDB ID.
          Frontend will display last 8 characters.
        */

        id: order._id.toString(),

        createdAt: order.createdAt,

        customerName:
          order.customerName || 'Customer',

        /*
          SECURITY:
          Hide most of the phone number.
        */

        customerPhone: order.customerPhone
          ? `******${String(
              order.customerPhone
            ).slice(-4)}`
          : '',

        status: normalizedStatus,

        total: Number(order.total || 0),

        items: (order.items || []).map(
          (item) => ({
            id: item._id
              ? item._id.toString()
              : item.productId
              ? item.productId.toString()
              : '',

            name:
              item.name || 'Product',

            quantity:
              Number(item.quantity || 1),

            size:
              item.size || 'N/A',

            image:
              item.image || '',
          })
        ),

        shippingInfo: {
          courierName:
            order.shippingInfo?.courierName ||
            '',

          trackingNumber:
            order.shippingInfo?.trackingNumber ||
            '',

          trackingUrl:
            order.shippingInfo?.trackingUrl ||
            '',
        },

        statusHistory,
      },
    });

  } catch (error) {

    console.error(
      'Track order error:',
      error
    );

    return res.status(500).json({
      error:
        'Unable to track your order. Please try again later.',
    });

  }
});

export default router;
