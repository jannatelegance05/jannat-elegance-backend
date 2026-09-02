import { Router } from 'express';
import { z } from 'zod';
import { requireSameOrigin } from '../auth.js';
import { sendContactEmail } from '../email.js';

const router = Router();
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 5;

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().regex(/^$|^[6-9]\d{9}$/),
  message: z.string().trim().min(10).max(1000),
}).strict();

router.post('/', requireSameOrigin, async (request, response, next) => {
  try {
    const now = Date.now();
    const key = request.ip || 'unknown';
    const recent = (attempts.get(key) || []).filter((time) => now - time < WINDOW_MS);
    if (recent.length >= MAX_REQUESTS) {
      return response.status(429).json({ success: false, error: 'Too many messages. Please try again later.' });
    }
    attempts.set(key, [...recent, now]);

    await sendContactEmail(schema.parse(request.body));
    return response.json({ success: true, message: 'Your message has been sent successfully.' });
  } catch (error) {
    next(error);
  }
});

export default router;
