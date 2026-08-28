import { Router } from 'express';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { z } from 'zod';
import { User } from '../models.js';
import { config } from '../config.js';
import { hasAllowedImageSignature } from '../image-validation.js';
import { publicUser, requireAuth, requireSameOrigin } from '../auth.js';

const router = Router();
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 }, fileFilter: (_request, file, callback) => callback(null, allowedTypes.has(file.mimetype)) });
const profileInput = z.object({ name: z.string().trim().min(2).max(100), phone: z.string().regex(/^\d{10}$/).optional().or(z.literal('')) });
const uploadBuffer = (buffer) => new Promise((resolve, reject) => cloudinary.uploader.upload_stream({ folder: 'jannat-elegance/profiles', resource_type: 'image', transformation: [{ width: 512, height: 512, crop: 'fill', gravity: 'face', quality: 'auto', fetch_format: 'auto' }] }, (error, result) => error ? reject(error) : resolve(result)).end(buffer));

router.use(requireAuth, requireSameOrigin);
router.patch('/', async (request, response, next) => {
  try {
    const input = profileInput.parse(request.body);
    const user = await User.findByIdAndUpdate(request.user.id, { $set: { name: input.name, phone: input.phone || undefined } }, { new: true });
    response.json({ success: true, user: publicUser(user) });
  } catch (error) { next(error); }
});
router.post('/avatar', upload.single('avatar'), async (request, response, next) => {
  try {
    if (!config.cloudinaryCloudName || !config.cloudinaryApiKey || !config.cloudinaryApiSecret) return response.status(503).json({ success: false, error: 'Profile photo uploads are not configured' });
    if (!request.file || !hasAllowedImageSignature(request.file.buffer)) return response.status(400).json({ success: false, error: 'Upload a valid JPG, PNG, or WebP image up to 5 MB' });
    cloudinary.config({ cloud_name: config.cloudinaryCloudName, api_key: config.cloudinaryApiKey, api_secret: config.cloudinaryApiSecret, secure: true });
    const result = await uploadBuffer(request.file.buffer);
    const user = await User.findByIdAndUpdate(request.user.id, { $set: { avatarUrl: result.secure_url } }, { new: true });
    response.json({ success: true, user: publicUser(user) });
  } catch (error) { next(error); }
});
router.delete('/avatar', async (request, response, next) => {
  try {
    const user = await User.findByIdAndUpdate(request.user.id, { $unset: { avatarUrl: 1 } }, { new: true });
    response.json({ success: true, user: publicUser(user) });
  } catch (error) { next(error); }
});
router.use((error, _request, response, next) => {
  if (error instanceof multer.MulterError) return response.status(400).json({ success: false, error: error.code === 'LIMIT_FILE_SIZE' ? 'Profile photo must be 5 MB or smaller' : 'Invalid profile photo' });
  next(error);
});
export default router;
