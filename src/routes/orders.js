import { Router } from "express";
import mongoose from "mongoose";

import { Order, Product } from "../models.js";
import { requireAuth } from "../auth.js";
import {
  isSafeTrackingUrl,
  normalizeStatus,
} from "../order-status.js";

const router = Router();

/* =========================================================
   FORMAT CUSTOMER ORDER
========================================================= */

const formatCustomerOrder = (order) => {
  return {
    ...order,

    id: String(order._id),

    orderId:
      order.orderId ||
      order.orderNumber ||
      `JE${String(order._id)
        .slice(-8)
        .toUpperCase()}`,

    status: normalizeStatus(
      order.status || "confirmed",
    ),

    paymentStatus:
      order.paymentStatus || "pending",

    shippingInfo: {
      courierName:
        order.shippingInfo?.courierName || "",

      trackingNumber:
        order.shippingInfo?.trackingNumber || "",

      trackingUrl:
        isSafeTrackingUrl(
          order.shippingInfo?.trackingUrl,
        )
          ? order.shippingInfo.trackingUrl
          : "",
    },

    statusHistory: (
      order.statusHistory || []
    ).map((entry) => ({
      status: normalizeStatus(
        entry.status,
      ),

      changedAt: entry.changedAt,
    })),

    items: (order.items || []).map(
      (item) => ({
        ...item,

        id: String(item._id),

        productId: item.productId
          ? String(item.productId)
          : "",
      }),
    ),
  };
};

/* =========================================================
   CUSTOMER ORDERS LIST

   IMPORTANT:
   COD orders are NOT filtered by paymentStatus.

   Logged-in user can see:
   - COD pending orders
   - Online paid orders
   - Confirmed orders
========================================================= */

router.get(
  "/",
  requireAuth,
  async (request, response, next) => {
    try {
      const orders = await Order.find({
        userId: request.user.id,
      })
        .sort({
          createdAt: -1,
        })
        .limit(50)
        .lean();

      return response.json({
        success: true,

        orders: orders.map(
          formatCustomerOrder,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

/* =========================================================
   TRACK ORDER

   IMPORTANT:
   This route MUST come BEFORE "/:id"
========================================================= */

router.get(
  "/track",
  async (req, res) => {
    try {
      const { orderId } = req.query;

      if (
        !orderId ||
        typeof orderId !== "string"
      ) {
        return res.status(400).json({
          error:
            "Order ID is required.",
        });
      }

      const enteredOrderId = orderId
        .trim()
        .toUpperCase();

      if (!enteredOrderId) {
        return res.status(400).json({
          error:
            "Please enter a valid Order ID.",
        });
      }

      let order = null;

      /* ===============================================
         STEP 1: CUSTOM ORDER ID

         Example:
         JE123456789ABC
      =============================================== */

      order = await Order.findOne({
        $or: [
          {
            orderId: enteredOrderId,
          },
          {
            orderNumber: enteredOrderId,
          },
        ],
      }).lean();

      /* ===============================================
         STEP 2: REMOVE JE PREFIX
      =============================================== */

      const cleanOrderId =
        enteredOrderId.replace(
          /^JE/i,
          "",
        );

      /* ===============================================
         STEP 3: FULL MONGODB OBJECT ID
      =============================================== */

      if (
        !order &&
        mongoose.Types.ObjectId.isValid(
          cleanOrderId,
        )
      ) {
        order = await Order.findById(
          cleanOrderId,
        ).lean();
      }

      /* ===============================================
         STEP 4: OLD ORDER FORMAT

         JE + LAST 8 CHARACTERS
      =============================================== */

      if (
        !order &&
        cleanOrderId.length === 8
      ) {
        const oldOrders =
          await Order.aggregate([
            {
              $addFields: {
                mongoIdString: {
                  $toString: "$_id",
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
                          "$mongoIdString",
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

      /* ===============================================
         ORDER NOT FOUND
      =============================================== */

      if (!order) {
        return res.status(404).json({
          error:
            "We could not find an order with this Order ID.",
        });
      }

      /* ===============================================
         NORMALIZE STATUS
      =============================================== */

      const normalizedStatus =
        normalizeStatus(
          order.status || "confirmed",
        );

      /* ===============================================
         RETURN TRACKING DATA
      =============================================== */

      return res.status(200).json({
        success: true,

        order: {
          id: String(order._id),

          orderId:
            order.orderId ||
            order.orderNumber ||
            `JE${String(order._id)
              .slice(-8)
              .toUpperCase()}`,

          createdAt:
            order.createdAt,

          customerName:
            order.customerName || "",

          customerPhone:
            order.customerPhone
              ? `******${String(
                  order.customerPhone,
                ).slice(-4)}`
              : "",

          customerEmail:
            order.customerEmail || "",

          status: normalizedStatus,

          paymentMethod:
            order.paymentMethod || "COD",

          paymentStatus:
            order.paymentStatus || "pending",

          total: order.total || 0,

          items: (
            order.items || []
          ).map((item) => ({
            id:
              item._id?.toString() || "",

            name:
              item.name || "",

            quantity:
              item.quantity || 0,

            size:
              item.size || "",

            price:
              item.price || 0,

            image:
              item.image || "",
          })),

          shippingInfo: {
            courierName:
              order.shippingInfo
                ?.courierName || "",

            trackingNumber:
              order.shippingInfo
                ?.trackingNumber || "",

            trackingUrl:
              isSafeTrackingUrl(
                order.shippingInfo
                  ?.trackingUrl,
              )
                ? order.shippingInfo
                    .trackingUrl
                : "",
          },

          statusHistory: (
            order.statusHistory || []
          )
            .map((history) => ({
              status:
                normalizeStatus(
                  history.status,
                ),

              changedAt:
                history.changedAt,
            }))
            .filter(
              (history) =>
                history.status !== "pending",
            ),
        },
      });
    } catch (error) {
      console.error(
        "Track order error:",
        error,
      );

      return res.status(500).json({
        error:
          "Unable to track your order. Please try again later.",
      });
    }
  },
);

/* =========================================================
   SINGLE CUSTOMER ORDER

   IMPORTANT:
   COD orders must also be accessible.
========================================================= */

router.get(
  "/:id",
  requireAuth,
  async (request, response, next) => {
    try {
      const { id } = request.params;

      if (
        !mongoose.isValidObjectId(id)
      ) {
        return response.status(404).json({
          success: false,

          error: "Order not found",
        });
      }

      /* ===============================================
         GET ORDER

         NO paymentStatus: "paid" FILTER

         This allows COD orders to appear.
      =============================================== */

      const order = await Order.findOne({
        _id: id,

        userId: request.user.id,
      }).lean();

      if (!order) {
        return response.status(404).json({
          success: false,

          error: "Order not found",
        });
      }

      /* ===============================================
         PURCHASED PRODUCTS
      =============================================== */

      const productIds = (
        order.items || []
      )
        .map((item) => item.productId)
        .filter(Boolean);

      const purchased =
        await Product.find({
          _id: {
            $in: productIds,
          },
        })
          .populate(
            "categoryId",
            "name",
          )
          .lean();

      /* ===============================================
         RELATED PRODUCTS
      =============================================== */

      const categoryIds = [
        ...new Set(
          purchased
            .map((product) =>
              String(
                product.categoryId?._id ||
                  product.categoryId ||
                  "",
              ),
            )
            .filter(Boolean),
        ),
      ];

      const related =
        categoryIds.length > 0
          ? await Product.find({
              _id: {
                $nin: productIds,
              },

              categoryId: {
                $in: categoryIds,
              },

              isActive: true,

              status: "published",
            })
              .populate(
                "categoryId",
                "name",
              )
              .sort({
                createdAt: -1,
              })
              .limit(4)
              .lean()
          : [];

      /* ===============================================
         FORMAT RELATED PRODUCTS
      =============================================== */

      const formatProduct = (product) => {
        const discount =
          product.discountType ===
          "percentage"
            ? product.price *
              (product.discount || 0) /
              100
            : product.discount || 0;

        return {
          ...product,

          id: String(product._id),

          category:
            product.categoryId?.name || "",

          categoryId:
            String(
              product.categoryId?._id ||
                product.categoryId ||
                "",
            ),

          salePrice:
            product.isOnSale
              ? Math.round(
                  Math.max(
                    0,
                    product.price - discount,
                  ) * 100,
                ) / 100
              : product.price,
        };
      };

      /* ===============================================
         RESPONSE
      =============================================== */

      return response.json({
        success: true,

        order:
          formatCustomerOrder(order),

        relatedProducts:
          related.map(formatProduct),
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;