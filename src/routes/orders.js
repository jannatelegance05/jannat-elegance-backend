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


/* =====================================================
   TRACK ORDER

   Supports:

   NEW ORDERS:
   JE123456789ABC

   OLD ORDERS:
   JE + last 8 characters of MongoDB ObjectId

   FULL MONGODB ID:
   68abc123456789abcdef1234
===================================================== */

router.get('/track', async (req, res) => {
  try {
    const { orderId } = req.query;

    if (!orderId || typeof orderId !== 'string') {
      return res.status(400).json({
        error: 'Order ID is required.',
      });
    }

    const enteredOrderId = orderId
      .trim()
      .toUpperCase();

    if (!enteredOrderId) {
      return res.status(400).json({
        error: 'Please enter a valid Order ID.',
      });
    }

    let order = null;

    /* =====================================================
       STEP 1: CHECK NEW CUSTOM ORDER ID

       Example:
       JE123456789ABC
    ===================================================== */

    order = await Order.findOne({
      orderId: enteredOrderId,
    }).lean();


    /* =====================================================
       STEP 2: REMOVE JE PREFIX

       Example:

       JEABC12345 → ABC12345
       jeABC12345 → ABC12345
    ===================================================== */

    const cleanOrderId = enteredOrderId.replace(/^JE/i, '');


    /* =====================================================
       STEP 3: CHECK FULL MONGODB OBJECT ID

       Example:
       68abc123456789abcdef1234
    ===================================================== */

    if (!order && mongoose.Types.ObjectId.isValid(cleanOrderId)) {
      order = await Order.findById(cleanOrderId).lean();
    }


    /* =====================================================
       STEP 4: CHECK OLD ORDER FORMAT

       OLD FRONTEND FORMAT:

       MongoDB ID:
       68abc123456789abcdef1234

       Displayed as:
       JEEF1234

       So we compare the LAST 8 characters.
    ===================================================== */

    if (!order && cleanOrderId.length === 8) {
      const oldOrders = await Order.aggregate([
        {
          $addFields: {
            mongoIdString: {
              $toString: '$_id',
            },
          },
        },
        {
          $match: {
            $expr: {
              $eq: [
                {
                  $toUpper: {
                    $substrCP: [
                      '$mongoIdString',
                      16,
                      8,
                    ],
                  },
                },
                cleanOrderId.toUpperCase(),
              ],
            },
          },
        },
        {
          $limit: 1,
        },
      ]);

      if (oldOrders.length > 0) {
        order = oldOrders[0];
      }
    }


    /* =====================================================
       ORDER NOT FOUND
    ===================================================== */

    if (!order) {
      return res.status(404).json({
        error:
          'We could not find an order with this Order ID.',
      });
    }


    /* =====================================================
       NORMALIZE STATUS
    ===================================================== */

    const normalizedStatus = normalizeStatus(
      order.status || 'pending'
    );


    /* =====================================================
       RETURN TRACKING DATA
    ===================================================== */

    return res.status(200).json({
      order: {

        /*
          NEW ORDER:
          Return custom JE Order ID

          OLD ORDER:
          Generate JE + last 8 MongoDB ID characters
        */

        id: order.orderId
          ? order.orderId
          : `JE${order._id
              .toString()
              .slice(-8)
              .toUpperCase()}`,

        createdAt: order.createdAt,

        customerName: order.customerName || '',

        customerPhone: order.customerPhone
          ? `******${order.customerPhone.slice(-4)}`
          : '',

        status: normalizedStatus,

        total: order.total || 0,

        items: (order.items || []).map((item) => ({
          id: item._id?.toString() || '',

          name: item.name || '',

          quantity: item.quantity || 0,

          size: item.size || '',

          image: item.image || '',
        })),

        shippingInfo: {
          courierName:
            order.shippingInfo?.courierName || '',

          trackingNumber:
            order.shippingInfo?.trackingNumber || '',

          trackingUrl:
            order.shippingInfo?.trackingUrl || '',
        },

        statusHistory: (order.statusHistory || [])
          .map((history) => ({
            status: normalizeStatus(
              history.status
            ),

            changedAt: history.changedAt,
          }))
          .filter(
            (history) =>
              history.status !== 'pending'
          ),
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
