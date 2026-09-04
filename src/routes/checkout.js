import { Router } from "express";
import { z } from "zod";

import { Address, Order, Product } from "../models.js";
import { makeOrderItems } from "../commerce.js";
import { requireAuth, requireSameOrigin } from "../auth.js";
import { sendOrderConfirmationEmail } from "../email.js";

const router = Router();

/* =========================================================
   VALIDATION SCHEMAS
========================================================= */

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

const lineSchema = z
  .object({
    id: objectId,

    size: z.enum(["S", "M", "L", "XL", "XXL"]),

    quantity: z.number().int().min(1).max(10),
  })
  .strict();

const addressInput = z
  .object({
    name: z.string().trim().min(2).max(120),

    phone: z.string().regex(/^\d{10}$/),

    addressLine: z.string().trim().min(8).max(300),

    city: z.string().trim().min(2).max(80),

    state: z.string().trim().min(2).max(80),

    pincode: z.string().regex(/^\d{6}$/),
  })
  .strict();

/* =========================================================
   CHECKOUT REQUEST SCHEMA
========================================================= */

const checkoutSchema = z
  .object({
    cart: z.array(lineSchema).min(1).max(50),

    address: addressInput.optional(),

    addressId: objectId.optional(),

    saveAddress: z.boolean().optional(),

    paymentMethod: z
      .enum(['COD'])
      .default('COD'),
  })
  .strict()
  .superRefine((data, context) => {
    if (
      (data.address ? 1 : 0) +
        (data.addressId ? 1 : 0) !==
      1
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide one shipping address',
      });
    }
  });

/* =========================================================
   IDEMPOTENCY KEY
========================================================= */

const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,128}$/);

/* =========================================================
   GENERATE CUSTOMER ORDER ID
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
   CHECKOUT RESPONSE
========================================================= */

function checkoutResponse(order) {
  return {
    success: true,

    orderId: String(order._id),

    customerOrderId: order.orderNumber,

    status: order.status,

    paymentMethod:
      order.paymentMethod || "COD",

    paymentStatus:
      order.paymentStatus,

    total: order.total,
  };
}

/* =========================================================
   AUTH PROTECTION
========================================================= */

router.use(requireAuth, requireSameOrigin);

/* =========================================================
   CREATE CASH ON DELIVERY ORDER
========================================================= */

router.post("/", async (request, response, next) => {
  try {
    /* -----------------------------------------------------
       VALIDATE REQUEST
    ----------------------------------------------------- */

    const input = checkoutSchema.parse(
      request.body,
    );

    const idempotencyKey =
      idempotencyKeySchema.parse(
        request.get("Idempotency-Key"),
      );

    /* -----------------------------------------------------
       PREVENT DUPLICATE PRODUCTS WITH SAME SIZE
    ----------------------------------------------------- */

    const duplicateLines = new Set(
      input.cart.map(
        (line) => `${line.id}:${line.size}`,
      ),
    );

    if (
      duplicateLines.size !==
      input.cart.length
    ) {
      return response.status(400).json({
        success: false,

        error:
          "Duplicate cart lines are not allowed",
      });
    }

    /* -----------------------------------------------------
       IDEMPOTENCY CHECK

       Prevents duplicate orders when customer clicks
       Place Order multiple times.
    ----------------------------------------------------- */

    const priorOrder = await Order.findOne({
      userId: request.user.id,

      idempotencyKey,
    }).lean();

    if (priorOrder) {
      return response.json(
        checkoutResponse(priorOrder),
      );
    }

    /* -----------------------------------------------------
       GET SHIPPING ADDRESS
    ----------------------------------------------------- */

    let address;

    if (input.addressId) {
      address = await Address.findOne({
        _id: input.addressId,

        userId: request.user.id,
      }).lean();

      if (!address) {
        return response.status(404).json({
          success: false,

          error: "Saved address not found",
        });
      }
    } else {
      address = input.address;
    }

    /* -----------------------------------------------------
       LOAD PRODUCTS FROM DATABASE

       Never trust prices from frontend.
    ----------------------------------------------------- */

    const productIds = [
      ...new Set(
        input.cart.map((line) => line.id),
      ),
    ];

    const products = await Product.find({
      _id: {
        $in: productIds,
      },

      isActive: true,

      status: "published",
    })
      .populate("categoryId", "name")
      .lean();

    /* -----------------------------------------------------
       CHECK ALL PRODUCTS EXIST
    ----------------------------------------------------- */

    if (
      products.length !== productIds.length
    ) {
      return response.status(400).json({
        success: false,

        error:
          "A product in your cart is no longer available",
      });
    }

    /* -----------------------------------------------------
       VALIDATE STOCK AND CREATE ORDER ITEMS
    ----------------------------------------------------- */

    let items;

    try {
      items = makeOrderItems(
        products,
        input.cart,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "InsufficientStock"
      ) {
        return response.status(409).json({
          success: false,

          error:
            "A selected size is no longer available",
        });
      }

      throw error;
    }

    /* -----------------------------------------------------
       CALCULATE PRICES SERVER SIDE
    ----------------------------------------------------- */

    const subtotal =
      Math.round(
        items.reduce(
          (sum, item) =>
            sum +
            item.price * item.quantity,
          0,
        ) * 100,
      ) / 100;

    const shipping = 0;

    const total = subtotal + shipping;

    /* -----------------------------------------------------
       SAVE ADDRESS IF CUSTOMER REQUESTED
    ----------------------------------------------------- */

    if (
      input.saveAddress &&
      !input.addressId
    ) {
      const existingAddress =
        await Address.exists({
          userId: request.user.id,
        });

      await Address.create({
        ...address,

        userId: request.user.id,

        isDefault: !existingAddress,
      });
    }

    /* -----------------------------------------------------
       CREATE CONFIRMED COD ORDER
    ----------------------------------------------------- */

    let order;

    try {
      order = await Order.create({
        /* CUSTOMER-FACING ORDER ID */

        orderNumber: generateOrderId(),

        /* USER */

        userId: request.user.id,

        /* IDEMPOTENCY */

        idempotencyKey,

        /* CUSTOMER DETAILS */

        customerName: address.name,

        customerEmail: request.user.email,

        customerPhone: address.phone,

        /* SHIPPING ADDRESS */

        shippingAddress:
          address.addressLine,

        city: address.city,

        state: address.state,

        postalCode: address.pincode,

        /* AMOUNTS */

        subtotal,

        shipping,

        total,

        /* PAYMENT */

        paymentMethod: "COD",

        /*
          COD has not been paid yet.
        */

        paymentStatus: "pending",

        /* ORDER STATUS */

        status: "confirmed",

        /* STATUS HISTORY */

        statusHistory: [
          {
            status: "confirmed",

            changedAt: new Date(),

            changedBy: request.user.id,
          },
        ],

        /* ORDER PRODUCTS */

        items,
      });
    } catch (error) {
      /* ---------------------------------------------------
         HANDLE DUPLICATE REQUEST / IDEMPOTENCY
      --------------------------------------------------- */

      if (error?.code === 11000) {
        const existingOrder =
          await Order.findOne({
            userId: request.user.id,

            idempotencyKey,
          }).lean();

        if (existingOrder) {
          return response.json(
            checkoutResponse(existingOrder),
          );
        }
      }

      throw error;
    }

    /* -----------------------------------------------------
       SEND ORDER CONFIRMATION EMAIL

       Email failure will NOT cancel the order.
    ----------------------------------------------------- */

    sendOrderConfirmationEmail(order).catch(
      (error) => {
        console.error(
          "COD order confirmation email failed:",
          error,
        );
      },
    );

    /* -----------------------------------------------------
       SUCCESS
    ----------------------------------------------------- */

    return response.status(201).json(
      checkoutResponse(order),
    );
  } catch (error) {
    next(error);
  }
});

export default router;