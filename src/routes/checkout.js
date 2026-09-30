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
   RAZORPAY PAYMENT LOGGING
========================================================= */

/**
 * Fetches the payment directly from Razorpay.
 *
 * IMPORTANT:
 * Never log the Razorpay secret/key_secret.
 *
 * This function is used to diagnose failed payments and
 * independently inspect the actual Razorpay payment object.
 */
async function fetchAndLogRazorpayPayment(paymentId) {
  if (!paymentId) {
    console.error(
      "[RAZORPAY] Payment details lookup skipped: no payment ID."
    );

    return null;
  }

  try {
    const payment =
      await razorpay.payments.fetch(
        paymentId
      );

    console.error(
      "========== RAZORPAY PAYMENT DETAILS =========="
    );

    console.error(
      JSON.stringify(
        {
          id: payment?.id || null,

          order_id:
            payment?.order_id || null,

          status:
            payment?.status || null,

          amount:
            payment?.amount ?? null,

          currency:
            payment?.currency || null,

          method:
            payment?.method || null,

          // Failure diagnostics
          error_code:
            payment?.error_code || null,

          error_description:
            payment?.error_description || null,

          error_source:
            payment?.error_source || null,

          error_step:
            payment?.error_step || null,

          error_reason:
            payment?.error_reason || null,
        },
        null,
        2
      )
    );

    console.error(
      "==============================================="
    );

    return payment;
  } catch (error) {
    console.error(
      "========== RAZORPAY PAYMENT LOOKUP FAILED =========="
    );

    console.error(
      JSON.stringify(
        {
          message:
            error?.message || null,

          statusCode:
            error?.statusCode || null,

          code:
            error?.code || null,

          error:
            error?.error || null,
        },
        null,
        2
      )
    );

    console.error(
      "===================================================="
    );

    return null;
  }
}

/* =========================================================
   PAYMENT FAILED DIAGNOSTICS
========================================================= */

/**
 * Called by the frontend when Razorpay Checkout emits
 * payment.failed.
 *
 * This endpoint is diagnostic only.
 *
 * It does NOT mark an order as failed or paid.
 */
router.post(
  "/payment-failed",
  requireSameOrigin,
  async (request, response) => {
    try {
      const body = z
        .object({
          paymentId: z
            .string()
            .min(1),

          orderId: z
            .string()
            .min(1)
            .optional(),

          razorpayOrderId: z
            .string()
            .min(1)
            .optional(),

          error: z
            .object({
              code: z
                .string()
                .optional(),

              description: z
                .string()
                .optional(),

              source: z
                .string()
                .optional(),

              step: z
                .string()
                .optional(),

              reason: z
                .string()
                .optional(),
            })
            .optional(),
        })
        .strict()
        .parse(request.body);

      console.error(
        "========== RAZORPAY CHECKOUT PAYMENT FAILED =========="
      );

      console.error(
        JSON.stringify(
          {
            frontendPaymentId:
              body.paymentId,

            frontendOrderId:
              body.orderId || null,

            frontendRazorpayOrderId:
              body.razorpayOrderId || null,

            frontendErrorCode:
              body.error?.code || null,

            frontendErrorDescription:
              body.error?.description || null,

            frontendErrorSource:
              body.error?.source || null,

            frontendErrorStep:
              body.error?.step || null,

            frontendErrorReason:
              body.error?.reason || null,
          },
          null,
          2
        )
      );

      console.error(
        "======================================================"
      );

      /*
       * Ask Razorpay directly for the payment object.
       *
       * This is the important part for diagnosis.
       */
      const payment =
        await fetchAndLogRazorpayPayment(
          body.paymentId
        );

      /*
       * If the payment exists, verify that the
       * frontend-provided Razorpay order ID matches.
       */
      if (
        payment &&
        body.razorpayOrderId &&
        payment.order_id &&
        payment.order_id !==
          body.razorpayOrderId
      ) {
        console.error(
          "[RAZORPAY] WARNING: frontend Razorpay order ID does not match payment.order_id."
        );
      }

      return response.json({
        success: true,
        logged: true,
      });
    } catch (error) {
      console.error(
        "[RAZORPAY] Failed-payment diagnostic endpoint error:",
        error
      );

      /*
       * Do not make the customer's payment flow fail
       * because diagnostic logging failed.
       */
      return response.status(200).json({
        success: false,
        logged: false,
      });
    }
  }
);

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
        await razorpay.orders.create({
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
        });

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

      /*
       * Log Razorpay API errors without logging
       * the secret key.
       */
      console.error(
        "========== CHECKOUT / RAZORPAY ORDER ERROR =========="
      );

      console.error(
        JSON.stringify(
          {
            message:
              error?.message || null,

            statusCode:
              error?.statusCode || null,

            code:
              error?.code || null,

            error:
              error?.error || null,
          },
          null,
          2
        )
      );

      console.error(
        "====================================================="
      );

      next(error);
    }
  }
);

/* =========================================================
   VERIFY RAZORPAY PAYMENT
========================================================= */

/* =========================================================
   VERIFY RAZORPAY PAYMENT
========================================================= */

router.post(
  "/verify",
  requireSameOrigin,
  async (request, response, next) => {
    try {
      const body = z
        .object({
          razorpay_order_id: z.string().min(1),
          razorpay_payment_id: z.string().min(1),
          razorpay_signature: z.string().min(1),
        })
        .strict()
        .parse(request.body);

      /* ---------------------------------------------------
         FIND LOCAL ORDER
      --------------------------------------------------- */

      const order = await Order.findOne({
        razorpayOrderId: body.razorpay_order_id,
      });

      if (!order) {
        console.error(
          "[RAZORPAY] Verification failed: local order not found.",
          {
            razorpayOrderId: body.razorpay_order_id,
            razorpayPaymentId: body.razorpay_payment_id,
          }
        );

        return response.status(404).json({
          success: false,
          error: "Order not found",
        });
      }

      /* ---------------------------------------------------
         VERIFY PAYMENT METHOD
      --------------------------------------------------- */

      if (order.paymentMethod !== "RAZORPAY") {
        console.error(
          "[RAZORPAY] Verification failed: invalid payment method.",
          {
            orderId: String(order._id),
            paymentMethod: order.paymentMethod,
            razorpayOrderId: body.razorpay_order_id,
          }
        );

        return response.status(400).json({
          success: false,
          error: "Invalid payment method",
        });
      }

      /* ---------------------------------------------------
         VERIFY SIGNATURE
      --------------------------------------------------- */

      const generatedSignature = crypto
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
          Buffer.from(generatedSignature),
          Buffer.from(body.razorpay_signature)
        );

      if (!signaturesMatch) {
        console.error(
          "[RAZORPAY] INVALID PAYMENT SIGNATURE",
          {
            razorpayOrderId: body.razorpay_order_id,
            razorpayPaymentId: body.razorpay_payment_id,
          }
        );

        return response.status(400).json({
          success: false,
          error: "Invalid payment signature",
        });
      }

      console.log(
        "[RAZORPAY] Payment signature verified.",
        {
          razorpayOrderId: body.razorpay_order_id,
          razorpayPaymentId: body.razorpay_payment_id,
        }
      );

      /* ---------------------------------------------------
         FETCH ACTUAL RAZORPAY PAYMENT
      --------------------------------------------------- */

      let payment =
        await fetchAndLogRazorpayPayment(
          body.razorpay_payment_id
        );

      if (!payment) {
        console.error(
          "[RAZORPAY] Unable to fetch payment from Razorpay.",
          {
            paymentId: body.razorpay_payment_id,
          }
        );

        return response.status(502).json({
          success: false,
          error:
            "Unable to verify payment with Razorpay",
        });
      }

      console.log(
        "[RAZORPAY] Initial payment status:",
        {
          paymentId: payment.id,
          orderId: payment.order_id,
          status: payment.status,
          amount: payment.amount,
          currency: payment.currency,
          method: payment.method,
          errorCode: payment.error_code,
          errorDescription:
            payment.error_description,
          errorSource: payment.error_source,
          errorStep: payment.error_step,
          errorReason: payment.error_reason,
        }
      );

      /* ---------------------------------------------------
         VERIFY RAZORPAY ORDER ID
      --------------------------------------------------- */

      if (
        payment.order_id !==
        body.razorpay_order_id
      ) {
        console.error(
          "[RAZORPAY] PAYMENT ORDER ID MISMATCH",
          {
            expected:
              body.razorpay_order_id,
            received:
              payment.order_id,
            paymentId:
              body.razorpay_payment_id,
          }
        );

        return response.status(400).json({
          success: false,
          error:
            "Payment order mismatch",
        });
      }

      /* ---------------------------------------------------
         VERIFY AMOUNT
      --------------------------------------------------- */

      const expectedAmount =
        Math.round(
          Number(order.total) * 100
        );

      const razorpayAmount =
        Number(payment.amount);

      if (
        !Number.isFinite(
          razorpayAmount
        ) ||
        razorpayAmount !==
          expectedAmount
      ) {
        console.error(
          "[RAZORPAY] PAYMENT AMOUNT MISMATCH",
          {
            orderId:
              String(order._id),

            razorpayOrderId:
              body.razorpay_order_id,

            paymentId:
              body.razorpay_payment_id,

            expectedAmount,

            razorpayAmount,
          }
        );

        return response.status(400).json({
          success: false,
          error:
            "Payment amount mismatch",
        });
      }

      /* ---------------------------------------------------
         IDEMPOTENT PAYMENT HANDLING
      --------------------------------------------------- */

      if (
        order.paymentStatus === "paid" ||
        order.stockReducedAt
      ) {
        console.log(
          "[RAZORPAY] Order already marked as paid.",
          {
            orderId:
              String(order._id),

            razorpayOrderId:
              body.razorpay_order_id,

            paymentId:
              body.razorpay_payment_id,
          }
        );

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
         CAPTURE AUTHORIZED PAYMENT

         Razorpay may return "authorized" before capture.
         Capture it server-side before marking the order
         as paid.
      --------------------------------------------------- */

      if (
        payment.status === "authorized"
      ) {
        console.log(
          "[RAZORPAY] Payment is authorized. Starting server-side capture.",
          {
            paymentId:
              body.razorpay_payment_id,

            razorpayOrderId:
              body.razorpay_order_id,

            amount:
              expectedAmount,

            currency:
              payment.currency || "INR",
          }
        );

        try {
          const captureResult =
            await razorpay.payments.capture(
              body.razorpay_payment_id,
              expectedAmount,
              payment.currency || "INR"
            );

          console.log(
            "[RAZORPAY] Capture API response:",
            {
              paymentId:
                captureResult?.id,

              orderId:
                captureResult?.order_id,

              status:
                captureResult?.status,

              amount:
                captureResult?.amount,

              currency:
                captureResult?.currency,

              method:
                captureResult?.method,

              errorCode:
                captureResult?.error_code,

              errorDescription:
                captureResult?.error_description,

              errorSource:
                captureResult?.error_source,

              errorStep:
                captureResult?.error_step,

              errorReason:
                captureResult?.error_reason,
            }
          );
        } catch (captureError) {
          console.error(
            "========== RAZORPAY CAPTURE ERROR =========="
          );

          console.error(
            JSON.stringify(
              {
                message:
                  captureError?.message ||
                  null,

                code:
                  captureError?.code ||
                  null,

                statusCode:
                  captureError?.statusCode ||
                  null,

                description:
                  captureError?.description ||
                  null,

                reason:
                  captureError?.reason ||
                  null,

                source:
                  captureError?.source ||
                  null,

                step:
                  captureError?.step ||
                  null,

                error:
                  captureError?.error ||
                  null,
              },
              null,
              2
            )
          );

          console.error(
            "============================================="
          );

          return response.status(502).json({
            success: false,
            error:
              captureError?.description ||
              captureError?.message ||
              "Unable to capture Razorpay payment",
          });
        }

        /* -------------------------------------------------
           FETCH PAYMENT AGAIN AFTER CAPTURE
        ------------------------------------------------- */

        payment =
          await fetchAndLogRazorpayPayment(
            body.razorpay_payment_id
          );

        if (!payment) {
          console.error(
            "[RAZORPAY] Payment could not be fetched after capture.",
            {
              paymentId:
                body.razorpay_payment_id,
            }
          );

          return response.status(502).json({
            success: false,
            error:
              "Unable to verify payment after capture",
          });
        }

        console.log(
          "[RAZORPAY] Payment status after capture:",
          {
            paymentId:
              payment.id,

            orderId:
              payment.order_id,

            status:
              payment.status,

            amount:
              payment.amount,

            currency:
              payment.currency,

            method:
              payment.method,

            errorCode:
              payment.error_code,

            errorDescription:
              payment.error_description,

            errorSource:
              payment.error_source,

            errorStep:
              payment.error_step,

            errorReason:
              payment.error_reason,
          }
        );

        /* -------------------------------------------------
           VERIFY ORDER ID AGAIN
        ------------------------------------------------- */

        if (
          payment.order_id !==
          body.razorpay_order_id
        ) {
          console.error(
            "[RAZORPAY] PAYMENT ORDER ID MISMATCH AFTER CAPTURE",
            {
              expected:
                body.razorpay_order_id,

              received:
                payment.order_id,

              paymentId:
                body.razorpay_payment_id,
            }
          );

          return response.status(400).json({
            success: false,
            error:
              "Payment order mismatch after capture",
          });
        }

        /* -------------------------------------------------
           VERIFY AMOUNT AGAIN
        ------------------------------------------------- */

        const capturedAmount =
          Number(payment.amount);

        if (
          !Number.isFinite(
            capturedAmount
          ) ||
          capturedAmount !==
            expectedAmount
        ) {
          console.error(
            "[RAZORPAY] PAYMENT AMOUNT MISMATCH AFTER CAPTURE",
            {
              orderId:
                String(order._id),

              razorpayOrderId:
                body.razorpay_order_id,

              paymentId:
                body.razorpay_payment_id,

              expectedAmount,

              capturedAmount,
            }
          );

          return response.status(400).json({
            success: false,
            error:
              "Payment amount mismatch after capture",
          });
        }
      }

      /* ---------------------------------------------------
         PAYMENT MUST NOW BE CAPTURED
      --------------------------------------------------- */

      if (
        payment.status !== "captured"
      ) {
        console.error(
          "[RAZORPAY] PAYMENT NOT CAPTURED",
          {
            paymentId:
              payment.id,

            razorpayOrderId:
              payment.order_id,

            status:
              payment.status,

            method:
              payment.method,

            errorCode:
              payment.error_code,

            errorDescription:
              payment.error_description,

            errorSource:
              payment.error_source,

            errorStep:
              payment.error_step,

            errorReason:
              payment.error_reason,
          }
        );

        return response.status(400).json({
          success: false,

          error:
            payment.error_description ||
            `Payment status is ${payment.status}`,
        });
      }

      /* ---------------------------------------------------
         MARK ORDER PAID
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

      if (
        result.newlyPaid
      ) {
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

      console.log(
        "[RAZORPAY] PAYMENT VERIFIED AND ORDER PAID",
        {
          orderId:
            String(result.order._id),

          customerOrderId:
            result.order.orderNumber,

          razorpayOrderId:
            body.razorpay_order_id,

          paymentId:
            body.razorpay_payment_id,

          paymentStatus:
            result.order.paymentStatus,
        }
      );

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
      console.error(
        "========== RAZORPAY VERIFY ERROR =========="
      );

      console.error(
        JSON.stringify(
          {
            message:
              error?.message ||
              null,

            code:
              error?.code ||
              null,

            statusCode:
              error?.statusCode ||
              null,

            description:
              error?.description ||
              null,

            reason:
              error?.reason ||
              null,

            source:
              error?.source ||
              null,

            step:
              error?.step ||
              null,

            error:
              error?.error ||
              null,
          },
          null,
          2
        )
      );

      console.error(
        "============================================"
      );

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