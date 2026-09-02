import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;
const userSchema = new Schema({ name: String, email: { type: String, required: true, unique: true, lowercase: true, trim: true }, phone: String, avatarUrl: String, passwordHash: String, role: { type: String, enum: ['customer', 'admin'], default: 'customer' }, googleSubject: { type: String, unique: true, sparse: true }, emailVerifiedAt: Date }, { timestamps: true });
const otpSchema = new Schema({ email: { type: String, index: true }, purpose: { type: String, enum: ['email_verification', 'password_reset'], required: true }, codeHash: String, expiresAt: { type: Date, index: { expires: 0 } }, attempts: { type: Number, default: 0 } }, { timestamps: true });
const addressSchema = new Schema({ userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, name: String, phone: String, addressLine: String, city: String, state: String, pincode: String, landmark: String, isDefault: { type: Boolean, default: false } }, { timestamps: true });
addressSchema.index({ userId: 1, isDefault: 1 });
const cartItemSchema = new Schema({ userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true }, name: String, price: Number, category: String, size: String, image: String, quantity: Number }, { timestamps: true });
cartItemSchema.index({ userId: 1, productId: 1, size: 1 }, { unique: true });
const statusHistorySchema = new Schema({ status: { type: String, enum: ['pending', 'confirmed', 'processing', 'packed', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'cancelled', 'returned', 'exchanged'] }, changedAt: { type: Date, default: Date.now }, changedBy: { type: Schema.Types.ObjectId, ref: 'User' } }, { _id: false });
// const orderSchema = new Schema({ userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, customerName: String, customerEmail: String, customerPhone: String, shippingAddress: String, city: String, state: String, postalCode: String, subtotal: Number, shipping: Number, total: Number, razorpayOrderId: { type: String, unique: true, sparse: true }, paymentId: String, idempotencyKey: { type: String, sparse: true }, paymentStatus: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' }, paidAt: Date, stockReducedAt: Date, paymentSource: String, status: { type: String, enum: ['pending', 'confirmed', 'processing', 'packed', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'cancelled', 'returned', 'exchanged'], default: 'pending' }, shippingInfo: { courierName: { type: String, default: '' }, trackingNumber: { type: String, default: '' }, trackingUrl: { type: String, default: '' } }, statusHistory: [statusHistorySchema], deliveredAt: Date, cancelledAt: Date, items: [{ productId: { type: Schema.Types.ObjectId, ref: 'Product' }, name: String, price: Number, quantity: Number, size: String, image: String }], adminNotes: String, cancelReason: String, stockRestoredAt: Date }, { timestamps: true });
const orderSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    orderNumber: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    customerName: String,

    customerEmail: String,

    customerPhone: String,

    shippingAddress: String,

    city: String,

    state: String,

    postalCode: String,

    subtotal: Number,

    shipping: Number,

    total: Number,

    razorpayOrderId: {
      type: String,
      unique: true,
      sparse: true,
    },

    paymentId: String,

    idempotencyKey: {
      type: String,
      sparse: true,
    },

    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed'],
      default: 'pending',
    },

    paidAt: Date,

    stockReducedAt: Date,

    paymentSource: String,

    status: {
      type: String,
       enum: [
    'confirmed',
    'processing',
    'packed',
    'shipped',
    'in_transit',
    'out_for_delivery',
    'delivered',
    'cancelled',
    'returned',
    'exchanged'
  ],
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

    statusHistory: [statusHistorySchema],

    deliveredAt: Date,

    cancelledAt: Date,

    items: [
      {
        productId: {
          type: Schema.Types.ObjectId,
          ref: 'Product',
        },

        name: String,

        price: Number,

        quantity: Number,

        size: String,

        image: String,
      },
    ],

    adminNotes: String,

    cancelReason: String,

    stockRestoredAt: Date,
  },
  {
    timestamps: true,
  }
);
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
const wishlistItemSchema = new Schema({ userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true } }, { timestamps: true });
wishlistItemSchema.index({ userId: 1, productId: 1 }, { unique: true });
const webhookEventSchema = new Schema({ eventId: { type: String, required: true, unique: true }, eventType: String, razorpayOrderId: String, paymentId: String, processedAt: Date, failedAt: Date, failureCode: String }, { timestamps: true });
const categorySchema = new Schema({ name: { type: String, unique: true, trim: true }, imageUrl: { type: String, default: '' } }, { timestamps: true });
const ProductSchema = new Schema({
  name: {
    type: String,
    required: true,
  },

  description: {
    type: String,
    required: true,
  },

  categoryId: {
    type: String,
    required: true,
  },

  price: {
    type: Number,
    required: true,
  },

  discount: {
    type: Number,
    default: 0,
  },

  discountType: {
    type: String,
    enum: ['percentage', 'flat'],
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

  // ✅ ADD THIS
  videoUrls: {
    type: [String],
    default: [],
  },

  sizes: {
    type: Array,
    default: [],
  },

  metaTitle: String,

  metaDescription: String,

  isActive: {
    type: Boolean,
    default: true,
  },

  status: {
    type: String,
    default: 'draft',
  },
});
productSchema.index({ isActive: 1, status: 1, isFeatured: 1, categoryId: 1, createdAt: -1 });
const adminActivityLogSchema = new Schema({ adminId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, action: { type: String, required: true }, entityType: { type: String, required: true }, entityId: { type: String, required: true }, details: Schema.Types.Mixed }, { timestamps: true });
const testimonialSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    name: {
      type: String,
      required: true,
    },

    avatarUrl: {
      type: String,
      default: '',
    },

    designation: {
      type: String,
      default: '',
    },

    message: {
      type: String,
      required: true,
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
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    isFeatured: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

export const Testimonial =
  mongoose.models.Testimonial ||
  mongoose.model('Testimonial', testimonialSchema);



export const User = models.User || model('User', userSchema);
export const Otp = models.Otp || model('Otp', otpSchema);
export const Address = models.Address || model('Address', addressSchema);
export const CartItem = models.CartItem || model('CartItem', cartItemSchema);
export const WishlistItem = models.WishlistItem || model('WishlistItem', wishlistItemSchema);
export const WebhookEvent = models.WebhookEvent || model('WebhookEvent', webhookEventSchema);
export const Order = models.Order || model('Order', orderSchema);
export const Category = models.Category || model('Category', categorySchema);
export const Product = models.Product || model('Product', productSchema);
export const AdminActivityLog = models.AdminActivityLog || model('AdminActivityLog', adminActivityLogSchema);
