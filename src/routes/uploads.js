import { Router } from 'express';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config.js';
import { hasAllowedImageSignature } from '../image-validation.js';
import { requireAdmin, requireAuth, requireSameOrigin } from '../auth.js';

const router = Router();
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 10 }, fileFilter: (_request, file, callback) => callback(null, allowedTypes.has(file.mimetype)) });
const uploadBuffer = (buffer) => new Promise((resolve, reject) => cloudinary.uploader.upload_stream({ folder: 'jannat-elegance/products', resource_type: 'image', transformation: [{ quality: 'auto', fetch_format: 'auto' }] }, (error, result) => error ? reject(error) : resolve(result)).end(buffer));

router.use(requireAuth, requireAdmin, requireSameOrigin);
router.post('/images', upload.array('images', 10), async (request, response, next) => {
  try {
    if (!config.cloudinaryCloudName || !config.cloudinaryApiKey || !config.cloudinaryApiSecret) return response.status(503).json({ success: false, error: 'Image uploads are not configured' });
    if (!request.files?.length || request.files.some((file) => !hasAllowedImageSignature(file.buffer))) return response.status(400).json({ success: false, error: 'Upload valid JPG, PNG, or WebP images up to 5 MB each' });
    cloudinary.config({ cloud_name: config.cloudinaryCloudName, api_key: config.cloudinaryApiKey, api_secret: config.cloudinaryApiSecret, secure: true });
    const results = await Promise.all(request.files.map((file) => uploadBuffer(file.buffer)));
    response.status(201).json({ success: true, images: results.map((result) => ({ url: result.secure_url, publicId: result.public_id })) });
  } catch (error) { next(error); }
});
router.use((error, _request, response, next) => {
  if (error instanceof multer.MulterError) return response.status(400).json({ success: false, error: error.code === 'LIMIT_FILE_SIZE' ? 'Each image must be 5 MB or smaller' : 'Invalid image upload' });
  next(error);
});
export default router;
