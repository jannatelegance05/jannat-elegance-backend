import crypto from "crypto";
import { config } from "./config.js";

/* =========================================================
   HELPERS
========================================================= */

const escapeHtml = (value) => {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character],
  );
};

const safeUrl = (value) => {
  try {
    const url = new URL(String(value));

    return ["http:", "https:"].includes(url.protocol)
      ? url.toString()
      : "";
  } catch {
    return "";
  }
};

/* =========================================================
   RESEND EMAIL SENDER
========================================================= */

const send = async ({
  to,
  subject,
  html,
  replyTo,
}) => {
  if (!config.resendApiKey) {
    throw new Error(
      "RESEND_API_KEY is not configured",
    );
  }

  if (!config.emailFrom) {
    throw new Error(
      "EMAIL_FROM is not configured",
    );
  }

  if (!to) {
    throw new Error(
      "Recipient email address is missing",
    );
  }

  const payload = {
    from: config.emailFrom,
    to: [to],
    subject,
    html,
    ...(replyTo
      ? { reply_to: replyTo }
      : {}),
  };

  const response = await fetch(
    "https://api.resend.com/emails",
    {
      method: "POST",

      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        "Content-Type": "application/json",
      },

      body: JSON.stringify(payload),
    },
  );

  const responseText = await response.text();

  let responseData = null;

  try {
    responseData = JSON.parse(responseText);
  } catch {
    responseData = responseText;
  }

  /* -------------------------------------------------------
     SHOW REAL RESEND ERROR
  ------------------------------------------------------- */

  if (!response.ok) {
    console.error(
      "Resend API Error:",
      JSON.stringify(
        responseData,
        null,
        2,
      ),
    );

    const errorMessage =
      responseData?.message ||
      responseData?.error ||
      responseData?.name ||
      responseText ||
      "Email provider rejected the message";

    throw new Error(
      `Resend email failed: ${errorMessage}`,
    );
  }

  console.log(
    "Email sent successfully:",
    responseData,
  );

  return responseData;
};

/* =========================================================
   OTP
========================================================= */

export function createOtp() {
  return String(
    crypto.randomInt(
      100000,
      1000000,
    ),
  );
}

export function hashOtp(code) {
  return crypto
    .createHash("sha256")
    .update(code)
    .digest("hex");
}

/* =========================================================
   EMAIL VERIFICATION OTP
========================================================= */

export async function sendOtpEmail(
  email,
  code,
) {
  return send({
    to: email,

    subject:
      "Your Jannat Elegance verification code",

    html: `
      <main
        style="
          font-family: Arial, sans-serif;
          color: #3f0a1c;
          max-width: 600px;
          margin: auto;
          padding: 24px;
        "
      >
        <h1
          style="
            font-size: 24px;
            margin-bottom: 20px;
          "
        >
          Verify your email
        </h1>

        <p>
          Your verification code is:
        </p>

        <div
          style="
            margin: 24px 0;
            padding: 20px;
            background: #fff5f7;
            border-radius: 12px;
            text-align: center;
          "
        >
          <strong
            style="
              font-size: 28px;
              letter-spacing: 6px;
              color: #800020;
            "
          >
            ${escapeHtml(code)}
          </strong>
        </div>

        <p>
          This code expires in
          <strong>10 minutes</strong>.
        </p>

        <p>
          Do not share this code with anyone.
        </p>

        <p>
          With love,<br />
          <strong>Jannat Elegance</strong>
        </p>
      </main>
    `,
  });
}

/* =========================================================
   PASSWORD RESET EMAIL
========================================================= */

export async function sendPasswordResetEmail(
  email,
  token,
) {
  const resetUrl =
    `${config.frontendOrigin}` +
    `/reset-password?email=${encodeURIComponent(
      email,
    )}&token=${encodeURIComponent(token)}`;

  return send({
    to: email,

    subject:
      "Reset your Jannat Elegance password",

    html: `
      <main
        style="
          font-family: Arial, sans-serif;
          color: #3f0a1c;
          max-width: 600px;
          margin: auto;
          padding: 24px;
        "
      >
        <h1>
          Reset your password
        </h1>

        <p>
          We received a request to reset your password.
        </p>

        <p>
          Use the secure button below to create a new password.
        </p>

        <p style="margin: 30px 0">
          <a
            href="${escapeHtml(resetUrl)}"
            style="
              display: inline-block;
              padding: 14px 24px;
              background: #800020;
              color: #ffffff;
              text-decoration: none;
              border-radius: 999px;
              font-weight: bold;
            "
          >
            Reset Password
          </a>
        </p>

        <p>
          This link expires in
          <strong>30 minutes</strong>.
        </p>

        <p>
          If you did not request this,
          you can safely ignore this email.
        </p>

        <p>
          With love,<br />
          <strong>Jannat Elegance</strong>
        </p>
      </main>
    `,
  });
}

/* =========================================================
   CONTACT FORM EMAIL
========================================================= */

export async function sendContactEmail({
  name,
  email,
  phone,
  message,
}) {
  return send({
    to: config.contactEmail,

    replyTo: email,

    subject: `New contact request from ${name}`,

    html: `
      <main
        style="
          font-family: Arial, sans-serif;
          color: #3f0a1c;
          max-width: 600px;
          margin: auto;
          padding: 24px;
        "
      >
        <h1>
          New Contact Request
        </h1>

        <p>
          <strong>Name:</strong>
          ${escapeHtml(name)}
        </p>

        <p>
          <strong>Email:</strong>
          ${escapeHtml(email)}
        </p>

        <p>
          <strong>Phone:</strong>
          ${escapeHtml(
            phone || "Not provided",
          )}
        </p>

        <p>
          <strong>Message:</strong>
        </p>

        <p>
          ${escapeHtml(message).replace(
            /\n/g,
            "<br />",
          )}
        </p>
      </main>
    `,
  });
}

/* =========================================================
   ORDER CONFIRMATION EMAIL
========================================================= */

export async function sendOrderConfirmationEmail(
  order,
) {
  const plainOrder =
    typeof order?.toObject === "function"
      ? order.toObject()
      : order;

  return sendOrderStatusEmail({
    ...plainOrder,
    status: "confirmed",
  });
}

/* =========================================================
   ORDER STATUS EMAIL
========================================================= */

export async function sendOrderStatusEmail(
  order,
) {
  if (!order?.customerEmail) {
    console.warn(
      "Order email skipped: customer email is missing",
    );

    return;
  }

  /* -------------------------------------------------------
     CUSTOMER ORDER NUMBER
  ------------------------------------------------------- */

  const customerOrderNumber =
    order.orderNumber ||
    order.orderId ||
    `JE${String(order._id)
      .slice(-8)
      .toUpperCase()}`;

  const number = escapeHtml(
    customerOrderNumber,
  );

  const firstName = escapeHtml(
    (order.customerName || "there")
      .trim()
      .split(/\s+/)[0],
  );

  /* -------------------------------------------------------
     SHIPPING INFORMATION
  ------------------------------------------------------- */

  const shipping =
    order.shippingInfo?.toObject?.() ||
    order.shippingInfo ||
    {};

  const courier = escapeHtml(
    shipping.courierName || "",
  );

  const tracking = escapeHtml(
    shipping.trackingNumber || "",
  );

  const trackingUrl = safeUrl(
    shipping.trackingUrl,
  );

  /* -------------------------------------------------------
     ORDER URL
  ------------------------------------------------------- */

  const orderUrl =
    `${config.frontendOrigin}/orders/${encodeURIComponent(
      String(order._id),
    )}`;

  /* =======================================================
     EMAIL TEMPLATES
  ======================================================= */

  const templates = {
    confirmed: {
      subject:
        "Your Jannat Elegance order has been confirmed",

      message: `
        Your order
        <strong>#${number}</strong>
        has been confirmed.
        We're preparing it and will keep you updated.
      `,
    },

    processing: {
      subject:
        "Your Jannat Elegance order is being processed",

      message: `
        Your order
        <strong>#${number}</strong>
        is currently being processed.
      `,
    },

    packed: {
      subject:
        "Your Jannat Elegance order has been packed",

      message: `
        Your order
        <strong>#${number}</strong>
        has been packed and is getting ready for shipment.
      `,
    },

    shipped: {
      subject:
        "Your Jannat Elegance order is on the way",

      message: `
        Great news!

        Your order
        <strong>#${number}</strong>
        has been shipped.
      `,
    },

    in_transit: {
      subject:
        "Your Jannat Elegance order is in transit",

      message: `
        Your order
        <strong>#${number}</strong>
        is travelling through the courier network.
      `,
    },

    out_for_delivery: {
      subject:
        "Your Jannat Elegance order is out for delivery",

      message: `
        Your order
        <strong>#${number}</strong>
        is out for delivery and should arrive soon.
      `,
    },

    delivered: {
      subject:
        "Your Jannat Elegance order has been delivered",

      message: `
        Your order
        <strong>#${number}</strong>
        has been delivered.

        We hope you love your Jannat Elegance purchase.
      `,
    },

    cancelled: {
      subject:
        "Your Jannat Elegance order has been cancelled",

      message: `
        Your order
        <strong>#${number}</strong>
        has been cancelled.

        ${
          order.cancelReason
            ? `Reason: ${escapeHtml(
                order.cancelReason,
              )}`
            : ""
        }
      `,
    },
  };

  const template =
    templates[order.status];

  if (!template) {
    console.warn(
      `No email template found for order status: ${order.status}`,
    );

    return;
  }

  /* =======================================================
     SHIPPING DETAILS BLOCK
  ======================================================= */

  const shippingDetails =
    courier || tracking || trackingUrl
      ? `
        <div
          style="
            margin-top: 24px;
            padding: 20px;
            background: #fff5f7;
            border-radius: 14px;
          "
        >
          <strong
            style="
              font-size: 16px;
              color: #800020;
            "
          >
            Shipping Details
          </strong>

          ${
            courier
              ? `
                <p>
                  <strong>Courier:</strong>
                  ${courier}
                </p>
              `
              : ""
          }

          ${
            tracking
              ? `
                <p>
                  <strong>Tracking Number:</strong>
                  ${tracking}
                </p>
              `
              : ""
          }

          ${
            trackingUrl
              ? `
                <p style="margin-top: 20px">
                  <a
                    href="${trackingUrl}"
                    style="
                      display: inline-block;
                      padding: 12px 20px;
                      background: #800020;
                      color: #ffffff;
                      text-decoration: none;
                      border-radius: 999px;
                      font-weight: bold;
                    "
                  >
                    Track Your Order
                  </a>
                </p>
              `
              : ""
          }
        </div>
      `
      : "";

  /* =======================================================
     SEND EMAIL
  ======================================================= */

  return send({
    to: order.customerEmail,

    subject: template.subject,

    html: `
      <main
        style="
          font-family: Arial, sans-serif;
          color: #3f0a1c;
          max-width: 600px;
          margin: auto;
          padding: 24px;
        "
      >
        <h1
          style="
            font-size: 28px;
            color: #800020;
            margin-bottom: 24px;
          "
        >
          Jannat Elegance
        </h1>

        <p>
          Hi ${firstName},
        </p>

        <p>
          ${template.message}
        </p>

        ${shippingDetails}

        <p style="margin-top: 28px">
          <a
            href="${escapeHtml(orderUrl)}"
            style="
              color: #800020;
              font-weight: bold;
              text-decoration: none;
            "
          >
            View Your Order →
          </a>
        </p>

        <hr
          style="
            border: none;
            border-top: 1px solid #eeeeee;
            margin: 30px 0;
          "
        />

        <p
          style="
            color: #777777;
            font-size: 13px;
            line-height: 1.6;
          "
        >
          With love,<br />
          <strong>Jannat Elegance</strong>
        </p>
      </main>
    `,
  });
}