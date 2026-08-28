# Jannat Elegance Backend

Express and MongoDB API for Jannat Elegance.

## Local setup

```bash
npm install
copy .env.example .env
npm run dev
```

Configure MongoDB, JWT, Cloudinary, Resend, Razorpay, and Google OAuth values in `.env`. Do not commit that file.

## Production

Set `NODE_ENV=production`, provide every variable in `.env.example`, set `FRONTEND_ORIGIN` to the public frontend HTTPS URL, and configure the Razorpay webhook endpoint as `/api/webhooks/razorpay`.
