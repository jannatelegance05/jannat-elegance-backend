import dotenv from 'dotenv';

// Deployment platforms inject process.env or provide backend/.env. The second
// lookup keeps the existing root .env working for this local monorepo.
dotenv.config();
dotenv.config({ path: new URL('../../.env', import.meta.url) });

const required = ['MONGODB_URI', 'JWT_SECRET'];
if (process.env.NODE_ENV === 'production') required.push('FRONTEND_ORIGIN', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'RESEND_API_KEY', 'EMAIL_FROM', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET');
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}

export const config = {
  // Cloud hosts such as Render provide PORT. BACKEND_PORT remains available for local development.
  port: Number(process.env.PORT || process.env.BACKEND_PORT || 4000),
  mongoUri: process.env.MONGODB_URI,
  jwtSecret: process.env.JWT_SECRET,
  frontendOrigins: (process.env.FRONTEND_ORIGIN || 'http://localhost:3000').split(',').map((origin) => origin.trim()).filter(Boolean),
  frontendOrigin: (process.env.FRONTEND_ORIGIN || 'http://localhost:3000').split(',')[0].trim(),
  isProduction: process.env.NODE_ENV === 'production',
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  resendApiKey: process.env.RESEND_API_KEY,
  emailFrom: process.env.EMAIL_FROM,
  contactEmail: process.env.CONTACT_EMAIL || 'jannatelegance05@gmail.com',
  razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME,
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY,
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET,
  delhivery: {
    // Dashboard-pasted values often carry stray spaces or capitals.
    apiToken: (process.env.DELHIVERY_API_TOKEN || '').trim(),
    environment: ['production', 'prod', 'live'].includes((process.env.DELHIVERY_ENV || '').trim().toLowerCase()) ? 'production' : 'staging',
    pickupLocation: (process.env.DELHIVERY_PICKUP_LOCATION || '').trim(),
    originPincode: (process.env.DELHIVERY_ORIGIN_PINCODE || '').trim(),
    sellerName: process.env.DELHIVERY_SELLER_NAME || 'Jannat Elegance',
    sellerAddress: process.env.DELHIVERY_SELLER_ADDRESS || '',
    sellerGstin: process.env.DELHIVERY_SELLER_GSTIN || '',
    hsnCode: process.env.DELHIVERY_HSN_CODE || '6204',
    shippingMode: process.env.DELHIVERY_SHIPPING_MODE === 'Express' ? 'Express' : 'Surface',
    defaultWeightGrams: Number(process.env.DELHIVERY_DEFAULT_WEIGHT_GRAMS) || 500,
    defaultLengthCm: Number(process.env.DELHIVERY_DEFAULT_LENGTH_CM) || 30,
    defaultWidthCm: Number(process.env.DELHIVERY_DEFAULT_WIDTH_CM) || 25,
    defaultHeightCm: Number(process.env.DELHIVERY_DEFAULT_HEIGHT_CM) || 5,
    webhookToken: process.env.DELHIVERY_WEBHOOK_TOKEN || '',
    syncIntervalMinutes: Math.max(0, Number(process.env.DELHIVERY_SYNC_INTERVAL_MINUTES ?? 30) || 0),
    blockUnserviceable: process.env.DELHIVERY_BLOCK_UNSERVICEABLE !== 'false',
  },
};
if (config.isProduction && config.jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters long');
