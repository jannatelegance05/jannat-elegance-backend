import { Router } from "express";
import crypto from "crypto";
import Razorpay from "razorpay";
import { z } from "zod";

import { Order, Product } from "../models.js";
import { makeOrderItems, markOrderPaid } from "../commerce.js";
import { requireSameOrigin } from "../auth.js";
import { sendOrderConfirmationEmail } from "../email.js";
import { config } from "../config.js";

const router = Router();

const razorpay = new Razorpay({
  key_id: config.razorpayKeyId,
  key_secret: config.razorpayKeySecret,
});

/* =========================================================
   VALIDATION
========================================================= */

const objectId = z
  .string()
  .regex(/^[a-f\d]{24}$/i);

const lineSchema = z
  .object({
    id: objectId,

    size: z.enum([
      "S",
      "M",
      "L",
      "XL",
      "XXL",
    ]),

    quantity: z
      .number()
      .int()
      .min(1)
      .max(10),
  })
  .strict();

const addressInput = z
  .object({
    name: z
      .string()
      .trim()
      .min(2)
      .max(120),

    email: z
      .string()
      .trim()
      .email()
      .max(160),

    phone: z
      .string()
      .regex(/^\d{10}$/),

    addressLine: z
      .string()
      .trim()
      .min(8)
      .max(300),

    city: z
      .string()
      .trim()
      .min(2)
      .max(80),

    state: z
      .string()
      .trim()
      .min(2)
      .max(80),

    pincode: z
      .string()
      .regex(/^\d{6}$/),

    landmark: z
      .string()
      .trim()
      .max(100)
      .optional()
      .or(z.literal("")),
  })
  .strict();

const checkoutSchema = z
  .object({
    cart: z
      .array(lineSchema)
      .min(1)
      .max(50),

    address: addressInput,

    paymentMethod: z
      .literal("RAZORPAY")
      .default("RAZORPAY"),
  })
  .strict();

const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,128}$/);

/* =========================================================
   ORDER NUMBER
========================================================= */

function generateOrderId() {
  const timestamp = Date.now()
    .toString()
    .slice(-10);

  const random = Math.random()
    .toString(36)
    .substring(2, 6)
    .toUpperCase();

  return `JE${timestamp}${random}`;
}

/* =========================================================
   RESPONSE
========================================================= */

function checkoutResponse(order, razorpayOrder) {
  return {
    success: true,

    orderId: String(order._id),

    customerOrderId: order.orderNumber,

    status: order.status,

    paymentMethod:
      order.paymentMethod,

    paymentStatus:
      order.paymentStatus,

    total: order.total,

    amount: Math.round(order.total * 100),

    currency: "INR",

    key: config.razorpayKeyId,

    razorpayOrderId:
      razorpayOrder?.id ||
      order.razorpayOrderId,
  };
}

/* =========================================================
   CREATE RAZORPAY ORDER
========================================================= */

router.post(
  "/",
  requireSameOrigin,
  async (request, response, next) => {
    let createdOrderId = null;

    try {
      /* ---------------------------------------------------
         VALIDATE REQUEST
      --------------------------------------------------- */

      const input =
        checkoutSchema.parse(
          request.body
        );

      const idempotencyKey =
        idempotencyKeySchema.parse(
          request.get(
            "Idempotency-Key"
          )
        );

      /* ---------------------------------------------------
         DUPLICATE CART LINES
      --------------------------------------------------- */

      const uniqueLines = new Set(
        input.cart.map(
          (line) =>
            `${line.id}:${line.size}`
        )
      );

      if (
        uniqueLines.size !==
        input.cart.length
      ) {
        return response.status(400).json({
          success: false,
          error:
            "Duplicate cart lines are not allowed",
        });
      }

      /* ---------------------------------------------------
         IDEMPOTENCY
         
         Guest orders have no userId, so we use the
         idempotency key globally.
      --------------------------------------------------- */

      const priorOrder =
        await Order.findOne({
          idempotencyKey,
        }).lean();

      if (priorOrder) {
        return response.json(
          checkoutResponse(
            priorOrder,
            priorOrder.razorpayOrderId
              ? {
                  id: priorOrder.razorpayOrderId,
                }
              : null
          )
        );
      }

      /* ---------------------------------------------------
         LOAD PRODUCTS
         
         Prices ALWAYS come from database.
      --------------------------------------------------- */

      const productIds = [
        ...new Set(
          input.cart.map(
            (line) => line.id
          )
        ),
      ];

      const products =
        await Product.find({
          _id: {
            $in: productIds,
          },

          isActive: true,

          status: "published",
        })
          .populate(
            "categoryId",
            "name"
          )
          .lean();

      if (
        products.length !==
        productIds.length
      ) {
        return response.status(400).json({
          success: false,
          error:
            "A product in your cart is no longer available",
        });
      }

      /* ---------------------------------------------------
         VALIDATE STOCK + CREATE ORDER ITEMS
      --------------------------------------------------- */

      let items;

      try {
        items = makeOrderItems(
          products,
          input.cart
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message ===
            "InsufficientStock"
        ) {
          return response.status(409).json({
            success: false,
            error:
              "A selected size is no longer available",
          });
        }

        throw error;
      }

      /* ---------------------------------------------------
         SERVER-SIDE PRICE CALCULATION
      --------------------------------------------------- */

      const subtotal =
        Math.round(
          items.reduce(
            (sum, item) =>
              sum +
              item.price *
                item.quantity,
            0
          ) * 100
        ) / 100;

      const shipping = 0;

      const total =
        subtotal + shipping;

      /* ---------------------------------------------------
         CREATE LOCAL ORDER
         
         Payment remains pending until Razorpay
         verification succeeds.
      --------------------------------------------------- */

      let order;

      try {
        order =
          await Order.create({
            orderNumber:
              generateOrderId(),

            /*
             * Guest checkout:
             * userId intentionally omitted.
             */

            idempotencyKey,

            customerName:
              input.address.name,

            customerEmail:
              input.address.email,

            customerPhone:
              input.address.phone,

            shippingAddress:
              [
                input.address.addressLine,
                input.address.landmark,
              ]
                .filter(Boolean)
                .join(", "),

            city:
              input.address.city,

            state:
              input.address.state,

            postalCode:
              input.address.pincode,

            subtotal,

            shipping,

            total,

            paymentMethod:
              "RAZORPAY",

            paymentStatus:
              "pending",

            status:
              "confirmed",

            statusHistory: [
              {
                status:
                  "confirmed",

                changedAt:
                  new Date(),
              },
            ],

            items,
          });
      } catch (error) {
        /*
         * MongoDB duplicate idempotency request.
         */

        if (
          error?.code === 11000
        ) {
          const existing =
            await Order.findOne({
              idempotencyKey,
            }).lean();

          if (existing) {
            return response.json(
              checkoutResponse(
                existing,
                existing.razorpayOrderId
                  ? {
                      id: existing.razorpayOrderId,
                    }
                  : null
              )
            );
          }
        }

        throw error;
      }

      createdOrderId =
        order._id;

      /* ---------------------------------------------------
         CREATE RAZORPAY ORDER
      --------------------------------------------------- */

      const paymentOrder =
        await razorpay.orders.create(
          {
            amount:
              Math.round(
                total * 100
              ),

            currency: "INR",

            receipt:
              `je_${String(
                order._id
              ).slice(-16)}`,

            notes: {
              orderId:
                String(order._id),

              customerOrderId:
                order.orderNumber,
            },
          }
        );

      /* ---------------------------------------------------
         SAVE RAZORPAY ORDER ID
      --------------------------------------------------- */

      order.razorpayOrderId =
        paymentOrder.id;

      await order.save();

      /* ---------------------------------------------------
         SUCCESS
      --------------------------------------------------- */

      return response.status(201).json(
        checkoutResponse(
          order,
          paymentOrder
        )
      );
    } catch (error) {
      /*
       * If Razorpay order creation failed after our
       * local order was created, remove the pending
       * local order.
       */

      if (createdOrderId) {
        try {
          await Order.deleteOne({
            _id: createdOrderId,

            paymentStatus:
              "pending",
          });
        } catch (cleanupError) {
          console.error(
            "Checkout cleanup failed:",
            cleanupError
          );
        }
      }

      next(error);
    }
  }
);

/* =========================================================
   VERIFY RAZORPAY PAYMENT
========================================================= */

router.post(
  "/verify",
  requireSameOrigin,
  async (request, response, next) => {
    try {
      const body =
        z
          .object({
            razorpay_order_id:
              z.string().min(1),

            razorpay_payment_id:
              z.string().min(1),

            razorpay_signature:
              z.string().min(1),
          })
          .strict()
          .parse(request.body);

      /* ---------------------------------------------------
         FIND ORDER
         
         We do NOT trust the frontend's orderId.
         The Razorpay order ID identifies the local order.
      --------------------------------------------------- */

      const order =
        await Order.findOne({
          razorpayOrderId:
            body.razorpay_order_id,
        });

      if (!order) {
        return response.status(404).json({
          success: false,
          error:
            "Order not found",
        });
      }

      /* ---------------------------------------------------
         VERIFY SIGNATURE
         
         Razorpay signature:
         HMAC_SHA256(
           razorpay_order_id + "|" + razorpay_payment_id,
           RAZORPAY_KEY_SECRET
         )
      --------------------------------------------------- */

      const generatedSignature =
        crypto
          .createHmac(
            "sha256",
            config.razorpayKeySecret
          )
          .update(
            `${body.razorpay_order_id}|${body.razorpay_payment_id}`
          )
          .digest("hex");

      const signaturesMatch =
        generatedSignature.length ===
          body.razorpay_signature.length &&
        crypto.timingSafeEqual(
          Buffer.from(
            generatedSignature
          ),
          Buffer.from(
            body.razorpay_signature
          )
        );

      if (!signaturesMatch) {
        return response.status(400).json({
          success: false,
          error:
            "Invalid payment signature",
        });
      }

      /* ---------------------------------------------------
         IDEMPOTENT PAYMENT HANDLING
      --------------------------------------------------- */

      if (
        order.paymentStatus ===
          "paid" ||
        order.stockReducedAt
      ) {
        return response.json({
          success: true,

          orderId:
            String(order._id),

          customerOrderId:
            order.orderNumber,

          paymentStatus:
            order.paymentStatus,
        });
      }

      /* ---------------------------------------------------
         MARK ORDER PAID
         
         Existing commerce helper:
         - transaction
         - stock validation
         - stock reduction
         - payment status
         - payment ID
         - paidAt
         - payment source
      --------------------------------------------------- */

      const result =
        await markOrderPaid({
          razorpayOrderId:
            body.razorpay_order_id,

          paymentId:
            body.razorpay_payment_id,

          source:
            "browser_verify",
        });

      /* ---------------------------------------------------
         SEND CONFIRMATION EMAIL
      --------------------------------------------------- */

      if (result.newlyPaid) {
        sendOrderConfirmationEmail(
          result.order
        ).catch((error) => {
          console.error(
            "Guest order confirmation email failed:",
            error
          );
        });
      }

      /* ---------------------------------------------------
         SUCCESS
      --------------------------------------------------- */

      return response.json({
        success: true,

        orderId:
          String(result.order._id),

        customerOrderId:
          result.order.orderNumber,

        paymentStatus:
          result.order.paymentStatus,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message ===
          "InsufficientStock"
      ) {
        return response.status(409).json({
          success: false,
          error:
            "Payment was received, but the selected product is no longer available. Please contact support.",
        });
      }

      next(error);
    }
  }
);

export default router;