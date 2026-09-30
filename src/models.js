import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;

/* =========================================================
   USER
========================================================= */

const userSchema = new Schema(
  {
    name: {
      type: String,
      default: '',
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    phone: {
      type: String,
      default: '',
      trim: true,
    },

    avatarUrl: {
      type: String,
      default: '',
    },

    passwordHash: {
      type: String,
      default: '',
    },

    role: {
      type: String,
      enum: ['customer', 'admin'],
      default: 'customer',
      index: true,
    },

    googleSubject: {
      type: String,
      unique: true,
      sparse: true,
    },

    emailVerifiedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

/* =========================================================
   OTP
========================================================= */

const otpSchema = new Schema(
  {
    email: {
      type: String,
      index: true,
      lowercase: true,
      trim: true,
    },

    purpose: {
      type: String,
      enum: [
        'email_verification',
        'password_reset',
      ],
      required: true,
    },

    codeHash: {
      type: String,
      required: true,
    },

    expiresAt: {
      type: Date,
      index: {
        expires: 0,
      },
    },

    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

/* =========================================================
   ADDRESS
========================================================= */

const addressSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    name: {
      type: String,
      default: '',
      trim: true,
    },

    phone: {
      type: String,
      default: '',
      trim: true,
    },

    addressLine: {
      type: String,
      default: '',
      trim: true,
    },

    city: {
      type: String,
      default: '',
      trim: true,
    },

    state: {
      type: String,
      default: '',
      trim: true,
    },

    pincode: {
      type: String,
      default: '',
      trim: true,
    },

    landmark: {
      type: String,
      default: '',
      trim: true,
    },

    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

addressSchema.index({
  userId: 1,
  isDefault: 1,
});

/* =========================================================
   CART ITEM
========================================================= */

const cartItemSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },

    name: {
      type: String,
      default: '',
    },

    price: {
      type: Number,
      default: 0,
    },

    category: {
      type: String,
      default: '',
    },

    size: {
      type: String,
      default: '',
    },

    image: {
      type: String,
      default: '',
    },

    quantity: {
      type: Number,
      default: 1,
      min: 1,
    },
  },
  {
    timestamps: true,
  }
);

cartItemSchema.index(
  {
    userId: 1,
    productId: 1,
    size: 1,
  },
  {
    unique: true,
  }
);

/* =========================================================
   ORDER STATUS HISTORY
========================================================= */

const ORDER_STATUSES = [
  'confirmed',
  'processing',
  'packed',
  'shipped',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'returned',
  'exchanged',
];

const statusHistorySchema = new Schema(
  {
    status: {
      type: String,
      enum: ORDER_STATUSES,
      required: true,
    },

    changedAt: {
      type: Date,
      default: Date.now,
    },

    changedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    _id: false,
  }
);

/* =========================================================
   ORDER ITEM
========================================================= */

const orderItemSchema = new Schema(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
    },

    name: {
      type: String,
      default: '',
    },

    price: {
      type: Number,
      default: 0,
    },

    quantity: {
      type: Number,
      default: 1,
      min: 1,
    },

    size: {
      type: String,
      default: '',
    },

    image: {
      type: String,
      default: '',
    },
  },
  {
    _id: false,
  }
);

/* =========================================================
   ORDER
========================================================= */

const orderSchema = new Schema(
  {
    /*
     * IMPORTANT:
     * Optional because guest checkout does not have a User.
     */
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    orderNumber: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      trim: true,
    },

    customerName: {
      type: String,
      default: '',
    },

    customerEmail: {
      type: String,
      default: '',
      lowercase: true,
      trim: true,
    },

    customerPhone: {
      type: String,
      default: '',
      trim: true,
    },

    shippingAddress: {
      type: String,
      default: '',
    },

    city: {
      type: String,
      default: '',
    },

    state: {
      type: String,
      default: '',
    },

    postalCode: {
      type: String,
      default: '',
    },

    subtotal: {
      type: Number,
      default: 0,
    },

    shipping: {
      type: Number,
      default: 0,
    },

    total: {
      type: Number,
      default: 0,
    },

    razorpayOrderId: {
      type: String,
      unique: true,
      sparse: true,
    },

    paymentId: {
      type: String,
      default: '',
    },

    /*
     * Guest checkout idempotency key.
     *
     * IMPORTANT:
     * Do NOT add index: true here.
     * The unique sparse index is declared below once.
     */
    idempotencyKey: {
      type: String,
      sparse: true,
      trim: true,
    },

    /* =====================================================
       PAYMENT METHOD
    ===================================================== */

    paymentMethod: {
      type: String,
      enum: [
        'COD',
        'RAZORPAY',
      ],
      default: 'COD',
      index: true,
    },

    paymentStatus: {
      type: String,
      enum: [
        'pending',
        'paid',
        'failed',
      ],
      default: 'pending',
    },

    paidAt: {
      type: Date,
      default: null,
    },

    stockReducedAt: {
      type: Date,
      default: null,
    },

    paymentSource: {
      type: String,
      default: '',
    },

    status: {
      type: String,
      enum: ORDER_STATUSES,
      default: 'confirmed',
    },

    shippingInfo: {
      courierName: {
        type: String,
        default: '',
      },

      trackingNumber: {
        type: String,
        default: '',
      },

      trackingUrl: {
        type: String,
        default: '',
      },
    },

    statusHistory: {
      type: [statusHistorySchema],
      default: [],
    },

    deliveredAt: {
      type: Date,
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    items: {
      type: [orderItemSchema],
      default: [],
    },

    adminNotes: {
      type: String,
      default: '',
    },

    cancelReason: {
      type: String,
      default: '',
    },

    stockRestoredAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

/*
 * Order listing index
 */
orderSchema.index({
  status: 1,
  createdAt: -1,
});

/*
 * IMPORTANT:
 * Global unique sparse idempotency index.
 *
 * This works for both:
 * - logged-in orders
 * - guest orders
 */
orderSchema.index(
  {
    idempotencyKey: 1,
  },
  {
    unique: true,
    sparse: true,
  }
);

/* =========================================================
   WISHLIST
========================================================= */

const wishlistItemSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

wishlistItemSchema.index(
  {
    userId: 1,
    productId: 1,
  },
  {
    unique: true,
  }
);

/* =========================================================
   WEBHOOK EVENTS
========================================================= */

const webhookEventSchema = new Schema(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
    },

    eventType: {
      type: String,
      default: '',
    },

    razorpayOrderId: {
      type: String,
      default: '',
    },

    paymentId: {
      type: String,
      default: '',
    },

    processedAt: {
      type: Date,
      default: null,
    },

    failedAt: {
      type: Date,
      default: null,
    },

    failureCode: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

/* =========================================================
   CATEGORY
========================================================= */

const categorySchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 2,
      maxlength: 80,
    },

    imageUrl: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

/*
 * DO NOT add:
 *
 * categorySchema.index({ name: 1 });
 *
 * because name: { unique: true } already creates that index.
 */

/* =========================================================
   PRODUCT SIZE
========================================================= */

const productSizeSchema = new Schema(
  {
    size: {
      type: String,
      enum: [
        'S',
        'M',
        'L',
        'XL',
        'XXL',
      ],
      required: true,
    },

    stock: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    price: {
      type: Number,
      min: 0,
      default: null,
    },
  },
  {
    _id: false,
  }
);

/* =========================================================
   PRODUCT
========================================================= */

const productSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 160,
    },

    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 5000,
    },

    categoryId: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
      index: true,
    },

    price: {
      type: Number,
      required: true,
      min: 0,
    },

    discount: {
      type: Number,
      default: 0,
      min: 0,
    },

    discountType: {
      type: String,
      enum: [
        'percentage',
        'flat',
      ],
      default: 'percentage',
    },

    isOnSale: {
      type: Boolean,
      default: false,
    },

    isFeatured: {
      type: Boolean,
      default: false,
    },

    imageUrls: {
      type: [String],
      default: [],
    },

    videoUrls: {
      type: [String],
      default: [],
    },

    sizes: {
      type: [productSizeSchema],
      default: [],
    },

    metaTitle: {
      type: String,
      default: '',
      trim: true,
      maxlength: 160,
    },

    metaDescription: {
      type: String,
      default: '',
      trim: true,
      maxlength: 320,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    status: {
      type: String,
      enum: [
        'draft',
        'published',
      ],
      default: 'draft',
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

productSchema.index({
  isActive: 1,
  status: 1,
  isFeatured: 1,
  categoryId: 1,
  createdAt: -1,
});

productSchema.index({
  categoryId: 1,
  createdAt: -1,
});

productSchema.index({
  name: 1,
});

/* =========================================================
   ADMIN ACTIVITY LOG
========================================================= */

const adminActivityLogSchema = new Schema(
  {
    adminId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    action: {
      type: String,
      required: true,
    },

    entityType: {
      type: String,
      required: true,
    },

    entityId: {
      type: String,
      required: true,
    },

    details: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

adminActivityLogSchema.index({
  adminId: 1,
  createdAt: -1,
});

/* =========================================================
   TESTIMONIAL
========================================================= */

const testimonialSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    avatarUrl: {
      type: String,
      default: '',
    },

    designation: {
      type: String,
      default: '',
      trim: true,
    },

    message: {
      type: String,
      required: true,
      trim: true,
    },

    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },

    isApproved: {
      type: Boolean,
      default: false,
      index: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    isFeatured: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

/* =========================================================
   MODELS EXPORT
========================================================= */

export const User =
  models.User ||
  model('User', userSchema);

export const Otp =
  models.Otp ||
  model('Otp', otpSchema);

export const Address =
  models.Address ||
  model('Address', addressSchema);

export const CartItem =
  models.CartItem ||
  model('CartItem', cartItemSchema);

export const WishlistItem =
  models.WishlistItem ||
  model('WishlistItem', wishlistItemSchema);

export const WebhookEvent =
  models.WebhookEvent ||
  model('WebhookEvent', webhookEventSchema);

export const Order =
  models.Order ||
  model('Order', orderSchema);

export const Category =
  models.Category ||
  model('Category', categorySchema);

export const Product =
  models.Product ||
  model('Product', productSchema);

export const AdminActivityLog =
  models.AdminActivityLog ||
  model(
    'AdminActivityLog',
    adminActivityLogSchema
  );

export const Testimonial =
  models.Testimonial ||
  model(
    'Testimonial',
    testimonialSchema
  );