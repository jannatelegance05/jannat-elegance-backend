import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { User } from './models.js';

const COOKIE_NAME = 'jannat_access';
const cookieOptions = { httpOnly: true, secure: config.isProduction, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000, path: '/' };

export function issueSession(response, user) {
  const token = jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: '7d', issuer: 'jannat-elegance' });
  response.cookie(COOKIE_NAME, token, cookieOptions);
}
export function clearSession(response) { response.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: undefined }); }
export async function requireAuth(request, response, next) {
  try {
    const token = request.cookies[COOKIE_NAME] || request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return response.status(401).json({ success: false, error: 'Unauthorized' });
    const payload = jwt.verify(token, config.jwtSecret, { issuer: 'jannat-elegance' });
    const user = await User.findById(payload.sub).select('-passwordHash');
    if (!user) return response.status(401).json({ success: false, error: 'Unauthorized' });
    request.user = user;
    next();
  } catch { return response.status(401).json({ success: false, error: 'Unauthorized' }); }
}
export function requireAdmin(request, response, next) { return request.user?.role === 'admin' ? next() : response.status(403).json({ success: false, error: 'Unauthorized' }); }
export function publicUser(user) { return { id: user.id, name: user.name, email: user.email, phone: user.phone, avatarUrl: user.avatarUrl, role: user.role, emailVerified: Boolean(user.emailVerifiedAt) }; }
// Complements the HttpOnly, SameSite cookie: a foreign site cannot submit an
// authenticated state-changing request to this API.
export function requireSameOrigin(request, response, next) {
  const origin = request.get('origin');
  if (origin && !config.frontendOrigins.includes(origin)) return response.status(403).json({ success: false, error: 'Invalid request origin' });
  next();
}
