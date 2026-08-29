import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Product, WishlistItem } from '../models.js';
import { calculateSalePrice } from '../commerce.js';
import { requireAuth, requireSameOrigin } from '../auth.js';

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const idsInput = z.object({ productIds: z.array(objectId).max(50).refine((ids) => new Set(ids).size === ids.length, 'Duplicate products are not allowed') }).strict();
const formatProduct = (product) => ({ id: String(product._id), name: product.name, description: product.description, category: product.categoryId?.name || '', categoryId: String(product.categoryId?._id || product.categoryId), price: product.price, discount: product.discount || 0, discountType: product.discountType || 'percentage', isOnSale: Boolean(product.isOnSale), salePrice: calculateSalePrice(product), sizes: product.sizes.map((size) => ({ size: size.size, stock: size.stock, ...(Number.isFinite(size.price) ? { price: size.price } : {}) })), imageUrls: product.imageUrls });

async function wishlistProducts(userId) {
  const saved = await WishlistItem.find({ userId }).sort({ createdAt: -1 }).lean();
  const products = await Product.find({ _id: { $in: saved.map((item) => item.productId) }, isActive: true, status: 'published' }).populate('categoryId', 'name').lean();
  const byId = new Map(products.map((product) => [String(product._id), product]));
  return saved.map((item) => byId.get(String(item.productId))).filter(Boolean).map(formatProduct);
}

router.use(requireAuth);
router.get('/', async (request, response, next) => { try { response.json({ success: true, products: await wishlistProducts(request.user.id) }); } catch (error) { next(error); } });
router.post('/sync', requireSameOrigin, async (request, response, next) => {
  try {
    const { productIds } = idsInput.parse(request.body);
    const products = await Product.find({ _id: { $in: productIds }, isActive: true, status: 'published' }).select('_id').lean();
    await WishlistItem.bulkWrite(products.map((product) => ({ updateOne: { filter: { userId: request.user.id, productId: product._id }, update: { $setOnInsert: { userId: request.user.id, productId: product._id } }, upsert: true } })), { ordered: false });
    response.json({ success: true, products: await wishlistProducts(request.user.id) });
  } catch (error) { next(error); }
});
router.post('/items/:productId', requireSameOrigin, async (request, response, next) => {
  try {
    if (!mongoose.isValidObjectId(request.params.productId)) return response.status(404).json({ success: false, error: 'Product not found' });
    const product = await Product.exists({ _id: request.params.productId, isActive: true, status: 'published' });
    if (!product) return response.status(404).json({ success: false, error: 'Product not found' });
    await WishlistItem.updateOne({ userId: request.user.id, productId: request.params.productId }, { $setOnInsert: { userId: request.user.id, productId: request.params.productId } }, { upsert: true });
    response.json({ success: true, products: await wishlistProducts(request.user.id) });
  } catch (error) { next(error); }
});
router.delete('/items/:productId', requireSameOrigin, async (request, response, next) => {
  try {
    if (!mongoose.isValidObjectId(request.params.productId)) return response.status(404).json({ success: false, error: 'Product not found' });
    await WishlistItem.deleteOne({ userId: request.user.id, productId: request.params.productId });
    response.json({ success: true, products: await wishlistProducts(request.user.id) });
  } catch (error) { next(error); }
});
export default router;
