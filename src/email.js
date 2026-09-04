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

const formatCurrency = (amount) => {
  const value = Number(amount || 0);

  return `₹${value.toLocaleString("en-IN", {
    maximumFractionDigits: 0,
  })}`;
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
   PREMIUM EMAIL WRAPPER
========================================================= */

const emailWrapper = ({
  preheader = "",
  content,
}) => {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  />
</head>

<body
  style="
    margin:0;
    padding:0;
    background-color:#f6f2f0;
  "
>

  <div
    style="
      display:none;
      max-height:0;
      overflow:hidden;
      opacity:0;
      color:transparent;
    "
  >
    ${preheader}
  </div>

  <table
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    role="presentation"
    style="
      width:100%;
      background:#f6f2f0;
    "
  >

    <tr>
      <td
        align="center"
        style="
          padding:40px 15px;
        "
      >

        <table
          width="100%"
          cellpadding="0"
          cellspacing="0"
          border="0"
          role="presentation"
          style="
            max-width:680px;
            width:100%;
            background:#ffffff;
            border-radius:18px;
            overflow:hidden;
          "
        >

          <!-- BRAND HEADER -->

          <tr>
            <td
              align="center"
              style="
                background:#551923;
                padding:38px 30px 34px;
              "
            >

              <div
                style="
                  font-family:Georgia,'Times New Roman',serif;
                  font-size:30px;
                  letter-spacing:7px;
                  color:#ffffff;
                  font-weight:600;
                  line-height:36px;
                "
              >
                JANNAT
              </div>

              <div
                style="
                  font-family:Arial,Helvetica,sans-serif;
                  font-size:10px;
                  letter-spacing:5px;
                  color:#e8bbc3;
                  margin-top:7px;
                  font-weight:700;
                "
              >
                ELLEGANCE
              </div>

            </td>
          </tr>

          ${content}

          <!-- FOOTER -->

          <tr>
            <td
              align="center"
              style="
                background:#3c161e;
                padding:38px 30px;
              "
            >

              <div
                style="
                  font-family:Georgia,'Times New Roman',serif;
                  font-size:21px;
                  color:#ffffff;
                  margin-bottom:10px;
                "
              >
                Jannat Elegance
              </div>

              <div
                style="
                  font-family:Arial,Helvetica,sans-serif;
                  font-size:13px;
                  line-height:22px;
                  color:#d9b8bf;
                  max-width:420px;
                "
              >
                Elegance, thoughtfully curated for every occasion.
              </div>

              <div
                style="
                  margin-top:22px;
                  font-family:Arial,Helvetica,sans-serif;
                  font-size:11px;
                  line-height:19px;
                  color:#a9828a;
                "
              >
                © ${new Date().getFullYear()} Jannat Elegance
                <br />
                Thank you for choosing us.
              </div>

            </td>
          </tr>

        </table>

      </td>
    </tr>

  </table>

</body>
</html>
  `;
};

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

    html: emailWrapper({
      preheader:
        "Your secure verification code is ready.",

      content: `
        <tr>
          <td
            style="
              padding:48px 40px;
              text-align:center;
            "
          >

            <h1
              style="
                margin:0;
                font-family:Georgia,'Times New Roman',serif;
                font-size:32px;
                font-weight:500;
                color:#3b2026;
              "
            >
              Verify Your Email
            </h1>

            <p
              style="
                margin:18px auto 28px;
                font-family:Arial,Helvetica,sans-serif;
                font-size:15px;
                line-height:25px;
                color:#756468;
              "
            >
              Please use the verification code below to complete
              your Jannat Elegance account setup.
            </p>

            <div
              style="
                display:inline-block;
                padding:22px 30px;
                background:#f8f0f1;
                border:1px solid #eadadd;
                border-radius:14px;
              "
            >
              <span
                style="
                  font-family:Arial,Helvetica,sans-serif;
                  font-size:32px;
                  font-weight:700;
                  letter-spacing:9px;
                  color:#551923;
                "
              >
                ${escapeHtml(code)}
              </span>
            </div>

            <p
              style="
                margin-top:28px;
                font-family:Arial,Helvetica,sans-serif;
                font-size:13px;
                color:#8b7479;
              "
            >
              This code expires in 10 minutes.
              Please do not share it with anyone.
            </p>

          </td>
        </tr>
      `,
    }),
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

    html: emailWrapper({
      preheader:
        "Reset your Jannat Elegance account password securely.",

      content: `
        <tr>
          <td
            style="
              padding:50px 40px;
              text-align:center;
            "
          >

            <h1
              style="
                margin:0;
                font-family:Georgia,'Times New Roman',serif;
                font-size:32px;
                font-weight:500;
                color:#3b2026;
              "
            >
              Reset Your Password
            </h1>

            <p
              style="
                margin:20px auto;
                font-family:Arial,Helvetica,sans-serif;
                font-size:15px;
                line-height:26px;
                color:#756468;
              "
            >
              We received a request to reset your password.
              Use the secure button below to create a new one.
            </p>

            <a
              href="${escapeHtml(resetUrl)}"
              style="
                display:inline-block;
                margin-top:15px;
                padding:16px 30px;
                background:#551923;
                color:#ffffff;
                text-decoration:none;
                border-radius:8px;
                font-family:Arial,Helvetica,sans-serif;
                font-size:13px;
                font-weight:700;
                letter-spacing:.5px;
              "
            >
              RESET PASSWORD →
            </a>

            <p
              style="
                margin-top:30px;
                font-family:Arial,Helvetica,sans-serif;
                font-size:13px;
                color:#8b7479;
                line-height:22px;
              "
            >
              This secure link expires in 30 minutes.
              <br />
              If you didn't request this, you can safely ignore this email.
            </p>

          </td>
        </tr>
      `,
    }),
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

    html: emailWrapper({
      preheader:
        "A new customer contact request has been received.",

      content: `
        <tr>
          <td style="padding:40px;">

            <h1
              style="
                margin:0 0 28px;
                font-family:Georgia,'Times New Roman',serif;
                font-size:30px;
                font-weight:500;
                color:#3b2026;
              "
            >
              New Contact Request
            </h1>

            <table
              width="100%"
              cellpadding="0"
              cellspacing="0"
              style="
                background:#faf6f5;
                border:1px solid #eadfdf;
                border-radius:12px;
              "
            >

              <tr>
                <td style="padding:20px;">

                  <p><strong>Name:</strong> ${escapeHtml(name)}</p>

                  <p><strong>Email:</strong> ${escapeHtml(email)}</p>

                  <p>
                    <strong>Phone:</strong>
                    ${escapeHtml(phone || "Not provided")}
                  </p>

                  <p><strong>Message:</strong></p>

                  <p style="line-height:24px;">
                    ${escapeHtml(message).replace(
                      /\n/g,
                      "<br />",
                    )}
                  </p>

                </td>
              </tr>

            </table>

          </td>
        </tr>
      `,
    }),
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

  /* =======================================================
     CUSTOMER ORDER NUMBER
  ======================================================= */

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

  /* =======================================================
     SHIPPING INFORMATION
  ======================================================= */

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

  /* =======================================================
     ORDER URL
  ======================================================= */

  const orderUrl =
    `${config.frontendOrigin}/orders/${encodeURIComponent(
      String(order._id),
    )}`;

  /* =======================================================
     ORDER ITEMS
  ======================================================= */

  const items =
    Array.isArray(order.items)
      ? order.items
      : [];

  const itemsHtml =
    items.length > 0
      ? items
          .map((item) => {
            const name = escapeHtml(
              item.name ||
                item.productName ||
                "Jannat Elegance Collection",
            );

            const quantity = Number(
              item.quantity || 1,
            );

            const size = escapeHtml(
              item.size || "",
            );

            const price = Number(
              item.price ||
                item.unitPrice ||
                0,
            );

            const image = safeUrl(
              item.image ||
                item.imageUrl ||
                item.productImage ||
                "",
            );

            return `
              <tr>
                <td
                  style="
                    padding:20px 0;
                    border-bottom:1px solid #eadfdf;
                  "
                >

                  <table
                    width="100%"
                    cellpadding="0"
                    cellspacing="0"
                    border="0"
                  >

                    <tr>

                      ${
                        image
                          ? `
                            <td
                              width="88"
                              valign="top"
                            >
                              <img
                                src="${image}"
                                alt="${name}"
                                width="76"
                                height="96"
                                style="
                                  display:block;
                                  width:76px;
                                  height:96px;
                                  object-fit:cover;
                                  border-radius:10px;
                                  border:1px solid #eadfdf;
                                "
                              />
                            </td>
                          `
                          : ""
                      }

                      <td
                        valign="top"
                        style="
                          padding-left:${image ? "16px" : "0"};
                        "
                      >

                        <div
                          style="
                            font-family:Arial,Helvetica,sans-serif;
                            font-size:16px;
                            line-height:23px;
                            font-weight:700;
                            color:#3b2026;
                          "
                        >
                          ${name}
                        </div>

                        <div
                          style="
                            margin-top:7px;
                            font-family:Arial,Helvetica,sans-serif;
                            font-size:13px;
                            line-height:20px;
                            color:#8b7479;
                          "
                        >
                          ${
                            size
                              ? `Size: ${size} &nbsp;•&nbsp; `
                              : ""
                          }
                          Qty: ${quantity}
                        </div>

                      </td>

                      <td
                        valign="top"
                        align="right"
                        style="
                          font-family:Arial,Helvetica,sans-serif;
                          font-size:16px;
                          font-weight:700;
                          color:#551923;
                          white-space:nowrap;
                        "
                      >
                        ${formatCurrency(
                          price * quantity,
                        )}
                      </td>

                    </tr>

                  </table>

                </td>
              </tr>
            `;
          })
          .join("")
      : `
        <tr>
          <td
            style="
              padding:20px 0;
              font-family:Arial,Helvetica,sans-serif;
              color:#756468;
            "
          >
            Your order details are being prepared.
          </td>
        </tr>
      `;

  /* =======================================================
     ORDER TOTAL
  ======================================================= */

  const total =
    Number(
      order.total ||
        order.totalAmount ||
        order.amount ||
        0,
    );

  /* =======================================================
     STATUS CONFIGURATION
  ======================================================= */

  const templates = {
    confirmed: {
      subject:
        "Your Jannat Elegance order is confirmed ✨",

      title:
        "Your Order is Confirmed",

      icon: "✓",

      intro: `
        Thank you for choosing Jannat Elegance, ${firstName}.
        Your order has been successfully received and our team
        is preparing your selection with care.
      `,

      accent: "#551923",
    },

    processing: {
      subject:
        "We're preparing your Jannat Elegance order",

      title:
        "Your Order is Being Prepared",

      icon: "✦",

      intro: `
        Our team is now carefully preparing your order
        for the next stage of its journey.
      `,

      accent: "#551923",
    },

    packed: {
      subject:
        "Your Jannat Elegance order has been packed",

      title:
        "Beautifully Packed for You",

      icon: "✦",

      intro: `
        Your selected pieces have been carefully packed
        and are almost ready to begin their journey to you.
      `,

      accent: "#551923",
    },

    shipped: {
      subject:
        "Your Jannat Elegance order is on its way",

      title:
        "Your Order is On Its Way",

      icon: "→",

      intro: `
        Great news, ${firstName}! Your order has been dispatched
        and is now making its way to you.
      `,

      accent: "#551923",
    },

    in_transit: {
      subject:
        "Your Jannat Elegance order is in transit",

      title:
        "Your Order is In Transit",

      icon: "→",

      intro: `
        Your order is travelling through the courier network
        and getting closer to you.
      `,

      accent: "#551923",
    },

    out_for_delivery: {
      subject:
        "Your Jannat Elegance order is arriving soon",

      title:
        "Out for Delivery",

      icon: "★",

      intro: `
        Exciting news, ${firstName}! Your order is out for delivery
        and should be arriving very soon.
      `,

      accent: "#551923",
    },

    delivered: {
      subject:
        "Your Jannat Elegance order has been delivered",

      title:
        "Your Order Has Arrived",

      icon: "♥",

      intro: `
        Your Jannat Elegance order has been successfully delivered.
        We hope every piece makes you feel as beautiful as you are.
      `,

      accent: "#551923",
    },

    cancelled: {
      subject:
        "Update regarding your Jannat Elegance order",

      title:
        "Order Update",

      icon: "!",

      intro: `
        Your order has been cancelled.
        ${
          order.cancelReason
            ? `Reason: ${escapeHtml(
                order.cancelReason,
              )}`
            : ""
        }
      `,

      accent: "#7a2935",
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
     SHIPPING DETAILS
  ======================================================= */

  const shippingDetails =
    courier || tracking || trackingUrl
      ? `
        <tr>
          <td
            style="
              padding:10px 40px 30px;
            "
          >

            <table
              width="100%"
              cellpadding="0"
              cellspacing="0"
              border="0"
              style="
                background:#f8f2f3;
                border:1px solid #eadadd;
                border-radius:14px;
              "
            >

              <tr>
                <td style="padding:24px;">

                  <div
                    style="
                      font-family:Georgia,'Times New Roman',serif;
                      font-size:21px;
                      color:#3b2026;
                      margin-bottom:18px;
                    "
                  >
                    Shipping Details
                  </div>

                  ${
                    courier
                      ? `
                        <p
                          style="
                            margin:8px 0;
                            font-family:Arial,Helvetica,sans-serif;
                            font-size:14px;
                            color:#756468;
                          "
                        >
                          <strong style="color:#3b2026;">
                            Courier:
                          </strong>
                          ${courier}
                        </p>
                      `
                      : ""
                  }

                  ${
                    tracking
                      ? `
                        <p
                          style="
                            margin:8px 0;
                            font-family:Arial,Helvetica,sans-serif;
                            font-size:14px;
                            color:#756468;
                          "
                        >
                          <strong style="color:#3b2026;">
                            Tracking Number:
                          </strong>
                          ${tracking}
                        </p>
                      `
                      : ""
                  }

                  ${
                    trackingUrl
                      ? `
                        <a
                          href="${trackingUrl}"
                          style="
                            display:inline-block;
                            margin-top:18px;
                            padding:13px 22px;
                            background:#551923;
                            color:#ffffff;
                            text-decoration:none;
                            border-radius:7px;
                            font-family:Arial,Helvetica,sans-serif;
                            font-size:12px;
                            font-weight:700;
                            letter-spacing:.5px;
                          "
                        >
                          TRACK YOUR ORDER →
                        </a>
                      `
                      : ""
                  }

                </td>
              </tr>

            </table>

          </td>
        </tr>
      `
      : "";

  /* =======================================================
     ORDER EMAIL CONTENT
  ======================================================= */

  const emailContent = `

    <!-- HERO -->

    <tr>
      <td
        align="center"
        style="
          padding:46px 40px 28px;
          background:#fffdfc;
        "
      >

        <div
          style="
            width:62px;
            height:62px;
            line-height:62px;
            text-align:center;
            border-radius:50%;
            background:#f7e8eb;
            color:${template.accent};
            font-family:Arial,Helvetica,sans-serif;
            font-size:29px;
            font-weight:bold;
            margin:0 auto 22px;
          "
        >
          ${template.icon}
        </div>

        <h1
          style="
            margin:0;
            font-family:Georgia,'Times New Roman',serif;
            font-size:34px;
            line-height:42px;
            font-weight:500;
            color:#3b2026;
          "
        >
          ${template.title}
        </h1>

        <p
          style="
            max-width:520px;
            margin:17px auto 0;
            font-family:Arial,Helvetica,sans-serif;
            font-size:15px;
            line-height:26px;
            color:#756468;
          "
        >
          ${template.intro}
        </p>

      </td>
    </tr>


    <!-- ORDER SUMMARY CARD -->

    <tr>
      <td
        style="
          padding:10px 40px 34px;
          background:#fffdfc;
        "
      >

        <table
          width="100%"
          cellpadding="0"
          cellspacing="0"
          border="0"
          style="
            background:#f8f2f3;
            border:1px solid #eadadd;
            border-radius:13px;
          "
        >

          <tr>

            <td
              style="
                padding:21px;
              "
            >

              <div
                style="
                  font-family:Arial,Helvetica,sans-serif;
                  font-size:10px;
                  font-weight:700;
                  letter-spacing:1.5px;
                  text-transform:uppercase;
                  color:#9a7a80;
                "
              >
                Order Number
              </div>

              <div
                style="
                  margin-top:8px;
                  font-family:Arial,Helvetica,sans-serif;
                  font-size:18px;
                  font-weight:700;
                  color:#551923;
                "
              >
                #${number}
              </div>

            </td>

            <td
              align="right"
              style="
                padding:21px;
              "
            >

              <div
                style="
                  font-family:Arial,Helvetica,sans-serif;
                  font-size:10px;
                  font-weight:700;
                  letter-spacing:1.5px;
                  text-transform:uppercase;
                  color:#9a7a80;
                "
              >
                Order Total
              </div>

              <div
                style="
                  margin-top:8px;
                  font-family:Arial,Helvetica,sans-serif;
                  font-size:21px;
                  font-weight:700;
                  color:#551923;
                "
              >
                ${formatCurrency(total)}
              </div>

            </td>

          </tr>

        </table>

      </td>
    </tr>


    <!-- PRODUCTS -->

    <tr>
      <td
        style="
          padding:8px 40px 0;
        "
      >

        <h2
          style="
            margin:0;
            font-family:Georgia,'Times New Roman',serif;
            font-size:24px;
            font-weight:500;
            color:#3b2026;
          "
        >
          Your Selection
        </h2>

        <p
          style="
            margin:8px 0 12px;
            font-family:Arial,Helvetica,sans-serif;
            font-size:13px;
            color:#967f84;
          "
        >
          A summary of the pieces you've chosen.
        </p>

        <table
          width="100%"
          cellpadding="0"
          cellspacing="0"
          border="0"
        >
          ${itemsHtml}
        </table>

      </td>
    </tr>


    <!-- TOTAL -->

    <tr>
      <td
        style="
          padding:24px 40px 28px;
        "
      >

        <table
          width="100%"
          cellpadding="0"
          cellspacing="0"
          border="0"
        >

          <tr>

            <td
              style="
                font-family:Arial,Helvetica,sans-serif;
                font-size:14px;
                color:#756468;
              "
            >
              Total Paid
            </td>

            <td
              align="right"
              style="
                font-family:Arial,Helvetica,sans-serif;
                font-size:24px;
                font-weight:700;
                color:#551923;
              "
            >
              ${formatCurrency(total)}
            </td>

          </tr>

        </table>

      </td>
    </tr>


    ${shippingDetails}


    <!-- JOURNEY -->

    <tr>
      <td
        style="
          padding:10px 40px 34px;
        "
      >

        <table
          width="100%"
          cellpadding="0"
          cellspacing="0"
          border="0"
          style="
            background:#fbf7f5;
            border:1px solid #eee2df;
            border-radius:14px;
          "
        >

          <tr>
            <td style="padding:28px;">

              <h3
                style="
                  margin:0 0 20px;
                  font-family:Georgia,'Times New Roman',serif;
                  font-size:21px;
                  font-weight:500;
                  color:#3b2026;
                "
              >
                Your Order Journey
              </h3>

              <div
                style="
                  font-family:Arial,Helvetica,sans-serif;
                  font-size:14px;
                  line-height:25px;
                  color:#756468;
                "
              >
                <strong style="color:#551923;">
                  01 — Order Confirmed
                </strong>
                <br />

                <strong style="color:#551923;">
                  02 — Carefully Prepared
                </strong>
                <br />

                <strong style="color:#551923;">
                  03 — Dispatched to You
                </strong>
                <br />

                <strong style="color:#551923;">
                  04 — Delivered with Love
                </strong>
              </div>

            </td>
          </tr>

        </table>

      </td>
    </tr>


    <!-- CTA -->

    <tr>
      <td
        align="center"
        style="
          padding:5px 40px 48px;
        "
      >

        <a
          href="${escapeHtml(orderUrl)}"
          style="
            display:inline-block;
            padding:17px 34px;
            background:#551923;
            color:#ffffff;
            text-decoration:none;
            border-radius:8px;
            font-family:Arial,Helvetica,sans-serif;
            font-size:13px;
            font-weight:700;
            letter-spacing:.6px;
          "
        >
          VIEW MY ORDER →
        </a>

      </td>
    </tr>
  `;

  /* =======================================================
     SEND PREMIUM EMAIL
  ======================================================= */

  return send({
    to: order.customerEmail,

    subject: template.subject,

    html: emailWrapper({
      preheader: template.subject,

      content: emailContent,
    }),
  });
}