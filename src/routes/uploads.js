import { Router } from 'express';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';

import { config } from '../config.js';
import { hasAllowedImageSignature } from '../image-validation.js';
import {
  requireAdmin,
  requireAuth,
  requireSameOrigin,
} from '../auth.js';

const router = Router();

/* =========================================================
   IMAGE CONFIGURATION
========================================================= */

const allowedImageTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/* =========================================================
   VIDEO CONFIGURATION
========================================================= */

const allowedVideoTypes = new Set([
  'video/mp4',
  'video/webm',
]);

/* =========================================================
   MULTER
========================================================= */

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 10,
  },

  fileFilter: (_request, file, callback) => {
    const allowed =
      allowedImageTypes.has(file.mimetype) ||
      allowedVideoTypes.has(file.mimetype);

    callback(null, allowed);
  },
});

/* =========================================================
   CLOUDINARY CONFIG
========================================================= */

const configureCloudinary = () => {
  cloudinary.config({
    cloud_name: config.cloudinaryCloudName,
    api_key: config.cloudinaryApiKey,
    api_secret: config.cloudinaryApiSecret,
    secure: true,
  });
};

/* =========================================================
   UPLOAD IMAGE BUFFER
========================================================= */

const uploadImageBuffer = (buffer) =>
  new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: 'jannat-elegance/products/images',

          resource_type: 'image',

          transformation: [
            {
              quality: 'auto',
              fetch_format: 'auto',
            },
          ],
        },

        (error, result) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(result);
        }
      )
      .end(buffer);
  });

/* =========================================================
   UPLOAD VIDEO BUFFER
========================================================= */

const uploadVideoBuffer = (buffer) =>
  new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: 'jannat-elegance/products/videos',
          resource_type: 'video',
          chunk_size: 6_000_000,
        },

        (error, result) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(result);
        }
      )
      .end(buffer);
  });

/* =========================================================
   AUTH
========================================================= */

router.use(
  requireAuth,
  requireAdmin,
  requireSameOrigin
);

/* =========================================================
   UPLOAD IMAGES
========================================================= */

router.post(
  '/images',

  upload.array('images', 10),

  async (request, response, next) => {
    try {
      if (
        !config.cloudinaryCloudName ||
        !config.cloudinaryApiKey ||
        !config.cloudinaryApiSecret
      ) {
        return response.status(503).json({
          success: false,

          error:
            'Image uploads are not configured',
        });
      }

      if (!request.files?.length) {
        return response.status(400).json({
          success: false,

          error:
            'Please select at least one image',
        });
      }

      const invalidImage = request.files.some(
        (file) =>
          !allowedImageTypes.has(file.mimetype) ||
          !hasAllowedImageSignature(file.buffer)
      );

      if (invalidImage) {
        return response.status(400).json({
          success: false,

          error:
            'Upload valid JPG, PNG, or WebP images',
        });
      }

      configureCloudinary();

      const results = await Promise.all(
        request.files.map((file) =>
          uploadImageBuffer(file.buffer)
        )
      );

      return response.status(201).json({
        success: true,

        images: results.map((result) => ({
          url: result.secure_url,

          publicId: result.public_id,
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

/* =========================================================
   UPLOAD VIDEOS
========================================================= */

router.post(
  '/videos',

  upload.array('videos', 5),

  async (request, response, next) => {
    try {
      if (
        !config.cloudinaryCloudName ||
        !config.cloudinaryApiKey ||
        !config.cloudinaryApiSecret
      ) {
        return response.status(503).json({
          success: false,

          error:
            'Video uploads are not configured',
        });
      }

      if (!request.files?.length) {
        return response.status(400).json({
          success: false,

          error:
            'Please select at least one video',
        });
      }

      const invalidVideo = request.files.some(
        (file) =>
          !allowedVideoTypes.has(file.mimetype)
      );

      if (invalidVideo) {
        return response.status(400).json({
          success: false,

          error:
            'Only MP4 and WebM videos are allowed',
        });
      }

      configureCloudinary();

      const results = await Promise.all(
        request.files.map((file) =>
          uploadVideoBuffer(file.buffer)
        )
      );

      return response.status(201).json({
        success: true,

        videos: results.map((result) => ({
          url: result.secure_url,

          publicId: result.public_id,

          duration: result.duration || null,

          format: result.format || null,
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

/* =========================================================
   MULTER ERROR HANDLER
========================================================= */

router.use(
  (error, _request, response, next) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return response.status(400).json({
          success: false,

          error:
            'Each uploaded file must be 100 MB or smaller',
        });
      }

      return response.status(400).json({
        success: false,

        error: 'Invalid file upload',
      });
    }

    next(error);
  }
);

export default router;