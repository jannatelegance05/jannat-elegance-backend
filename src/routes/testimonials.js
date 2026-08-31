import { Router } from 'express';
import { z } from 'zod';

import { Testimonial } from '../models.js';

import {
  requireAuth,
  requireSameOrigin,
} from '../auth.js';

const router = Router();


// ============================================
// GET PUBLIC TESTIMONIALS
// ============================================

router.get('/', async (_request, response, next) => {
  try {
    const testimonials = await Testimonial.find({
      isApproved: true,
      isActive: true,
    })
      .select(
        'name avatarUrl rating message createdAt'
      )
      .sort({
        createdAt: -1,
      })
      .limit(50)
      .lean();

    return response.json({
      success: true,
      testimonials,
    });
  } catch (error) {
    next(error);
  }
});


// ============================================
// ADD TESTIMONIAL
// ============================================

router.post(
  '/',
  requireAuth,
  requireSameOrigin,
  async (request, response, next) => {
    try {
      const input = z
        .object({
          rating: z
            .number()
            .int()
            .min(1)
            .max(5),

          message: z
            .string()
            .trim()
            .min(10)
            .max(1000),
        })
        .strict()
        .parse(request.body);

      const testimonial =
        await Testimonial.create({
          userId: request.user._id,

          name:
            request.user.name ||
            'Jannat Elegance Customer',

          avatarUrl:
            request.user.avatarUrl || '',

          rating: input.rating,

          message: input.message,

          /*
            Admin approval required
          */

          isApproved: false,

          isActive: true,
        });

      return response.status(201).json({
        success: true,

        message:
          'Thank you for your feedback! Your testimonial has been submitted for review.',

        testimonial: {
          id: testimonial._id,
          rating: testimonial.rating,
          message: testimonial.message,
          isApproved:
            testimonial.isApproved,
          createdAt:
            testimonial.createdAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);


export default router;