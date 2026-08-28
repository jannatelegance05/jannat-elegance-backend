import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import crypto from 'crypto';
import { z } from 'zod';
import { User, Otp } from '../models.js';
import { clearSession, issueSession, publicUser, requireAuth, requireSameOrigin } from '../auth.js';
import { createOtp, hashOtp, sendOtpEmail, sendPasswordResetEmail } from '../email.js';
import { config } from '../config.js';

const router = Router();
const googleClient = new OAuth2Client(config.googleClientId);
const credentials = z.object({ email: z.string().email().transform((value) => value.toLowerCase()), password: z.string().min(8).max(128) }).strict();
const attemptWindows = new Map();
function limitAttempts(max, windowMs) { return (request, response, next) => { const key = `${request.ip}:${request.body?.email || ''}`; const now = Date.now(); const active = (attemptWindows.get(key) || []).filter((time) => now - time < windowMs); if (active.length >= max) return response.status(429).json({ success: false, error: 'Too many attempts. Please try again later.' }); active.push(now); attemptWindows.set(key, active); next(); }; }

router.post('/register', requireSameOrigin, limitAttempts(5, 60 * 60 * 1000), async (request, response, next) => {
  try {
    const input = credentials.extend({ name: z.string().trim().min(2).max(100), phone: z.string().regex(/^\d{10}$/).optional() }).strict().parse(request.body);
    if (await User.exists({ email: input.email })) return response.status(409).json({ success: false, error: 'An account already exists for this email' });
    const user = await User.create({ name: input.name, email: input.email, phone: input.phone, passwordHash: await bcrypt.hash(input.password, 12) });
    return response.status(201).json({ success: true, user: publicUser(user) });
  } catch (error) { next(error); }
});

router.post('/login', requireSameOrigin, limitAttempts(5, 15 * 60 * 1000), async (request, response, next) => {
  try {
    const input = credentials.parse(request.body);
    const user = await User.findOne({ email: input.email });
    if (!user?.passwordHash || !(await bcrypt.compare(input.password, user.passwordHash))) return response.status(401).json({ success: false, error: 'Invalid email or password' });
    issueSession(response, user);
    return response.json({ success: true, user: publicUser(user) });
  } catch (error) { next(error); }
});

router.post('/google', requireSameOrigin, limitAttempts(10, 15 * 60 * 1000), async (request, response, next) => {
  try {
    if (!config.googleClientId) return response.status(503).json({ success: false, error: 'Google sign-in is not configured' });
    const { credential } = z.object({ credential: z.string().min(1) }).parse(request.body);
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: config.googleClientId });
    const profile = ticket.getPayload();
    if (!profile?.sub || !profile.email || !profile.email_verified) return response.status(401).json({ success: false, error: 'Google account email is not verified' });
    const user = await User.findOneAndUpdate({ $or: [{ googleSubject: profile.sub }, { email: profile.email.toLowerCase() }] }, { $setOnInsert: { email: profile.email.toLowerCase(), role: 'customer' }, $set: { googleSubject: profile.sub, name: profile.name || undefined, emailVerifiedAt: new Date() } }, { new: true, upsert: true });
    issueSession(response, user);
    return response.json({ success: true, user: publicUser(user) });
  } catch (error) { next(error); }
});

router.post('/otp/send', requireSameOrigin, limitAttempts(3, 15 * 60 * 1000), async (request, response, next) => {
  try {
    const { email } = z.object({ email: z.string().email().transform((value) => value.toLowerCase()) }).parse(request.body);
    const code = createOtp();
    await Otp.deleteMany({ email, purpose: 'email_verification' });
    await Otp.create({ email, purpose: 'email_verification', codeHash: hashOtp(code), expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    await sendOtpEmail(email, code);
    return response.json({ success: true, message: 'Verification code sent' });
  } catch (error) { next(error); }
});

router.post('/otp/verify', requireSameOrigin, limitAttempts(5, 15 * 60 * 1000), async (request, response, next) => {
  try {
    const { email, code } = z.object({ email: z.string().email().transform((value) => value.toLowerCase()), code: z.string().regex(/^\d{6}$/) }).parse(request.body);
    const otp = await Otp.findOne({ email, purpose: 'email_verification', expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
    if (!otp || otp.attempts >= 5 || otp.codeHash !== hashOtp(code)) { if (otp) await Otp.updateOne({ _id: otp.id }, { $inc: { attempts: 1 } }); return response.status(400).json({ success: false, error: 'Invalid or expired verification code' }); }
    await Promise.all([Otp.deleteOne({ _id: otp.id }), User.updateOne({ email }, { $set: { emailVerifiedAt: new Date() } })]);
    return response.json({ success: true, message: 'Email verified' });
  } catch (error) { next(error); }
});

router.post('/forgot-password', requireSameOrigin, limitAttempts(3, 15 * 60 * 1000), async (request, response, next) => {
  try {
    const { email } = z.object({ email: z.string().email().transform((value) => value.toLowerCase()) }).parse(request.body);
    const user = await User.findOne({ email });
    // Always return the same response so email addresses cannot be enumerated.
    if (!user) return response.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
    const token = crypto.randomBytes(32).toString('hex');
    await Otp.deleteMany({ email, purpose: 'password_reset' });
    await Otp.create({ email, purpose: 'password_reset', codeHash: hashOtp(token), expiresAt: new Date(Date.now() + 30 * 60 * 1000) });
    await sendPasswordResetEmail(email, token);
    response.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
  } catch (error) { next(error); }
});

router.post('/reset-password', requireSameOrigin, limitAttempts(5, 15 * 60 * 1000), async (request, response, next) => {
  try {
    const { email, token, password } = z.object({ email: z.string().email().transform((value) => value.toLowerCase()), token: z.string().regex(/^[a-f\d]{64}$/i), password: z.string().min(8).max(128) }).parse(request.body);
    const reset = await Otp.findOne({ email, purpose: 'password_reset', codeHash: hashOtp(token), expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
    if (!reset || reset.attempts >= 5) { if (reset) await Otp.updateOne({ _id: reset._id }, { $inc: { attempts: 1 } }); return response.status(400).json({ success: false, error: 'This reset link is invalid or expired' }); }
    const user = await User.findOneAndUpdate({ email }, { $set: { passwordHash: await bcrypt.hash(password, 12) } }, { new: true });
    if (!user) return response.status(400).json({ success: false, error: 'This reset link is invalid or expired' });
    await Otp.deleteOne({ _id: reset._id });
    response.json({ success: true });
  } catch (error) { next(error); }
});

router.get('/me', requireAuth, (request, response) => response.json({ success: true, user: publicUser(request.user) }));
router.post('/logout', requireSameOrigin, (_request, response) => { clearSession(response); response.json({ success: true }); });
export default router;
