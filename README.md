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

## Delhivery One shipping

Shipping is integrated with Delhivery One. Set the `DELHIVERY_*` variables from `.env.example` (API token from Delhivery One → Settings → API Setup, and the exact registered pickup location name). Start with `DELHIVERY_ENV=staging` and a staging token, then switch to `production`.

- **Checkout** checks pincode serviceability (`GET /api/shipping/serviceability?pincode=`) and blocks pincodes Delhivery explicitly cannot serve. Delhivery outages never block checkout.
- **Admin → Order detail** creates the shipment (AWB is assigned automatically), shows the rate quote, downloads the shipping label, syncs tracking and cancels shipments. **Admin → Orders** schedules warehouse pickups and syncs all active shipments.
- **Tracking** refreshes automatically every `DELHIVERY_SYNC_INTERVAL_MINUTES`, whenever a customer tracks an order (at most every 10 minutes), and instantly through the scan-push webhook. Ask Delhivery support to push status updates to `https://<api-host>/api/webhooks/delhivery?token=<DELHIVERY_WEBHOOK_TOKEN>`.
- Order status moves forward automatically (Packed → In Transit → Out for Delivery → Delivered, or Returned for RTO) and the customer gets the usual status email.
