import crypto from 'crypto';
import { config } from './config.js';

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const safeUrl = (value) => { try { const url = new URL(String(value)); return ['http:', 'https:'].includes(url.protocol) ? url.toString() : ''; } catch { return ''; } };
const send = async ({ to, subject, html, replyTo }) => { if (!config.resendApiKey || !config.emailFrom) throw new Error('Email service is not configured'); const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: config.emailFrom, to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }) }); if (!response.ok) throw new Error('Email provider rejected the message'); };

export function createOtp() { return String(crypto.randomInt(100000, 1000000)); }
export function hashOtp(code) { return crypto.createHash('sha256').update(code).digest('hex'); }
export async function sendOtpEmail(email, code) { return send({ to: email, subject: 'Your Jannat Elegance verification code', html: `<p>Your verification code is <strong style="font-size:24px;letter-spacing:4px">${code}</strong>.</p><p>It expires in 10 minutes. Do not share it with anyone.</p>` }); }
export async function sendPasswordResetEmail(email, token) { const resetUrl = `${config.frontendOrigin}/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`; return send({ to: email, subject: 'Reset your Jannat Elegance password', html: `<h1>Reset your password</h1><p>Use the secure link below to set a new password. It expires in 30 minutes.</p><p><a href="${resetUrl}">Reset password</a></p><p>If you did not request this, you can safely ignore this email.</p>` }); }

export async function sendContactEmail({ name, email, phone, message }) {
  return send({
    to: config.contactEmail,
    replyTo: email,
    subject: `New contact request from ${name}`,
    html: `<main style="font-family:Arial,sans-serif;color:#3f0a1c;max-width:600px;margin:auto"><h1>New contact request</h1><p><strong>Name:</strong> ${escapeHtml(name)}</p><p><strong>Email:</strong> ${escapeHtml(email)}</p><p><strong>Phone:</strong> ${escapeHtml(phone || 'Not provided')}</p><p><strong>Message:</strong></p><p>${escapeHtml(message).replace(/\n/g, '<br />')}</p></main>`,
  });
}

export async function sendOrderConfirmationEmail(order) { const plainOrder = typeof order?.toObject === 'function' ? order.toObject() : order; return sendOrderStatusEmail({ ...plainOrder, status: 'confirmed' }); }
export async function sendOrderStatusEmail(order) {
  if (!order.customerEmail) return;
  if (!config.resendApiKey || !config.emailFrom) throw new Error('Email service is not configured');
  const number = `JE${String(order._id).slice(-8).toUpperCase()}`; const firstName = escapeHtml((order.customerName || 'there').trim().split(/\s+/)[0]); const shipping = order.shippingInfo?.toObject?.() || order.shippingInfo || {}; const courier = escapeHtml(shipping.courierName || ''); const tracking = escapeHtml(shipping.trackingNumber || ''); const trackingUrl = safeUrl(shipping.trackingUrl); const orderUrl = `${config.frontendOrigin}/orders/${encodeURIComponent(String(order._id))}`;
  const templates = { confirmed: { subject: 'Your Jannat Elegance order has been confirmed', message: `Your order <strong>#${number}</strong> has been confirmed. We’re preparing it and will let you know when it moves to the next stage.` }, processing: { subject: 'Your Jannat Elegance order is being processed', message: `Your order <strong>#${number}</strong> is being processed.` }, packed: { subject: 'Your Jannat Elegance order has been packed', message: `Your order <strong>#${number}</strong> has been packed and is getting ready for shipment.` }, shipped: { subject: 'Your Jannat Elegance order is on the way', message: `Your order <strong>#${number}</strong> is on the way!` }, in_transit: { subject: 'Your Jannat Elegance order is in transit', message: `Your order <strong>#${number}</strong> is in transit through the courier network and is on its way to you.` }, out_for_delivery: { subject: 'Your Jannat Elegance order is out for delivery', message: `Your order <strong>#${number}</strong> is out for delivery and is expected to arrive soon.` }, delivered: { subject: 'Your Jannat Elegance order has been delivered', message: `Your order <strong>#${number}</strong> has been delivered. We hope you love your Jannat Elegance purchase.` }, cancelled: { subject: 'Your Jannat Elegance order has been cancelled', message: `Your order <strong>#${number}</strong> has been cancelled.${order.cancelReason ? ` Reason: ${escapeHtml(order.cancelReason)}.` : ''}` } };
  const template = templates[order.status]; if (!template) return;
  const shippingDetails = courier || tracking ? `<div style="padding:16px;background:#fff5f7;border-radius:12px"><strong>Shipping details</strong>${courier ? `<p>Courier: ${courier}</p>` : ''}${tracking ? `<p>Tracking number: ${tracking}</p>` : ''}${trackingUrl ? `<p><a href="${trackingUrl}" style="display:inline-block;padding:10px 16px;background:#800020;color:#fff;text-decoration:none;border-radius:999px">Track your order</a></p>` : ''}</div>` : '';
  return send({ to: order.customerEmail, subject: template.subject, html: `<main style="font-family:Arial,sans-serif;color:#3f0a1c;max-width:600px;margin:auto"><p>Hi ${firstName},</p><p>${template.message}</p>${shippingDetails}<p><a href="${orderUrl}">View your order</a></p><p>With love,<br />Jannat Elegance</p></main>` });
}
