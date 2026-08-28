import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AdminActivityLog, Category, Product } from '../models.js';
import { requireAdmin, requireAuth, requireSameOrigin } from '../auth.js';

const router = Router();
const sizeValues = ['S', 'M', 'L', 'XL', 'XXL'];
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const productInput = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().min(10).max(5000),
  categoryId: objectId,
  price: z.number().finite().nonnegative().max(10000000),
  discount: z.number().finite().nonnegative().max(10000000).default(0),
  discountType: z.enum(['percentage', 'flat']).default('percentage'),
  isOnSale: z.boolean().default(false),
  isActive: z.boolean().default(true),
  status: z.enum(['draft', 'published']).default('draft'),
  sizes: z.array(z.object({ size: z.enum(sizeValues), stock: z.number().int().min(0).max(100000) })).min(1).max(sizeValues.length)
    .refine((items) => new Set(items.map((item) => item.size)).size === items.length, 'Duplicate sizes are not allowed'),
  imageUrls: z.array(z.string().url()).min(1).max(10),
  metaTitle: z.string().trim().max(160).optional().or(z.literal('')),
  metaDescription: z.string().trim().max(320).optional().or(z.literal('')),
}).strict();

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const formatProduct = (product) => { const salePrice = product.isOnSale ? Math.max(0, product.price - (product.discountType === 'percentage' ? product.price * product.discount / 100 : product.discount)) : product.price; return { ...product, id: String(product._id), category: product.categoryId?.name || '', categoryId: product.categoryId?._id ? String(product.categoryId._id) : String(product.categoryId), salePrice: Math.round(salePrice * 100) / 100 }; };
const audit = (adminId, action, entityType, entityId, details) => AdminActivityLog.create({ adminId, action, entityType, entityId, details });

router.get('/', async (request, response, next) => {
  try {
    const page = Math.max(1, Number(request.query.page) || 1);
    const limit = Math.min(48, Math.max(1, Number(request.query.limit) || 24));
    const query = { isActive: true, status: 'published' };
    if (typeof request.query.category === 'string' && mongoose.isValidObjectId(request.query.category)) query.categoryId = request.query.category;
    if (typeof request.query.search === 'string' && request.query.search.trim()) {
      const term = { $regex: escapeRegex(request.query.search.trim()), $options: 'i' };
      query.$or = [{ name: term }, { description: term }];
    }
    if (typeof request.query.size === 'string' && sizeValues.includes(request.query.size)) query.sizes = { $elemMatch: { size: request.query.size, stock: { $gt: 0 } } };
    const [items, total] = await Promise.all([
      Product.find(query).populate('categoryId', 'name').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Product.countDocuments(query),
    ]);
    response.json({ success: true, products: items.map(formatProduct), page, pages: Math.max(1, Math.ceil(total / limit)), total });
  } catch (error) { next(error); }
});

router.get('/categories/list', async (_request, response, next) => { try { response.json({ success: true, categories: await Category.find().sort({ name: 1 }).lean() }); } catch (error) { next(error); } });

router.get('/:id', async (request, response, next) => {
  try {
    if (!mongoose.isValidObjectId(request.params.id)) return response.status(404).json({ success: false, error: 'Product not found' });
    const product = await Product.findOne({ _id: request.params.id, isActive: true, status: 'published' }).populate('categoryId', 'name').lean();
    if (!product) return response.status(404).json({ success: false, error: 'Product not found' });
    response.json({ success: true, product: formatProduct(product) });
  } catch (error) { next(error); }
});

export const adminProductRoutes = Router();
adminProductRoutes.use(requireAuth, requireAdmin, requireSameOrigin);
adminProductRoutes.get('/categories', async (_request, response, next) => { try { response.json({ success: true, categories: await Category.find().sort({ name: 1 }).lean() }); } catch (error) { next(error); } });
adminProductRoutes.post('/categories', async (request, response, next) => {
  try {
    const { name } = z.object({ name: z.string().trim().min(2).max(80) }).strict().parse(request.body);
    const category = await Category.create({ name });
    await audit(request.user.id, 'create', 'category', String(category._id), { name });
    response.status(201).json({ success: true, category });
  } catch (error) { if (error?.code === 11000) return response.status(409).json({ success: false, error: 'Category already exists' }); next(error); }
});
adminProductRoutes.delete('/categories/:id', async (request, response, next) => {
  try {
    if (!mongoose.isValidObjectId(request.params.id)) return response.status(404).json({ success: false, error: 'Category not found' });
    const category = await Category.findById(request.params.id);
    if (!category) return response.status(404).json({ success: false, error: 'Category not found' });
    const productCount = await Product.countDocuments({ categoryId: category._id });
    if (productCount) return response.status(409).json({ success: false, error: `Move or delete the ${productCount} product${productCount === 1 ? '' : 's'} in this category first` });
    await Category.deleteOne({ _id: category._id });
    await audit(request.user.id, 'delete', 'category', String(category._id), { name: category.name });
    response.json({ success: true });
  } catch (error) { next(error); }
});
adminProductRoutes.get('/products', async (request, response, next) => {
  try {
    const page = Math.max(1, Number(request.query.page) || 1); const limit = Math.min(50, Math.max(1, Number(request.query.limit) || 20)); const query = {};
    if (typeof request.query.category === 'string' && mongoose.isValidObjectId(request.query.category)) query.categoryId = request.query.category;
    if (typeof request.query.search === 'string' && request.query.search.trim()) query.name = { $regex: escapeRegex(request.query.search.trim()), $options: 'i' };
    const [items, total] = await Promise.all([Product.find(query).populate('categoryId', 'name').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Product.countDocuments(query)]);
    response.json({ success: true, products: items.map(formatProduct), page, pages: Math.max(1, Math.ceil(total / limit)), total });
  } catch (error) { next(error); }
});
adminProductRoutes.get('/products/:id', async (request, response, next) => { try { if (!mongoose.isValidObjectId(request.params.id)) return response.status(404).json({ success: false, error: 'Product not found' }); const product = await Product.findById(request.params.id).populate('categoryId', 'name').lean(); if (!product) return response.status(404).json({ success: false, error: 'Product not found' }); response.json({ success: true, product: formatProduct(product) }); } catch (error) { next(error); } });
adminProductRoutes.post('/products', async (request, response, next) => {
  try {
    const input = productInput.parse(request.body);
    if (!await Category.exists({ _id: input.categoryId })) return response.status(400).json({ success: false, error: 'Category does not exist' });
    const product = await Product.create(input);
    await audit(request.user.id, 'create', 'product', String(product._id), { name: product.name });
    response.status(201).json({ success: true, product });
  } catch (error) { next(error); }
});
adminProductRoutes.patch('/products/:id', async (request, response, next) => {
  try {
    if (!mongoose.isValidObjectId(request.params.id)) return response.status(404).json({ success: false, error: 'Product not found' });
    const input = productInput.partial().parse(request.body);
    if (input.categoryId && !await Category.exists({ _id: input.categoryId })) return response.status(400).json({ success: false, error: 'Category does not exist' });
    const product = await Product.findByIdAndUpdate(request.params.id, { $set: input }, { new: true, runValidators: true });
    if (!product) return response.status(404).json({ success: false, error: 'Product not found' });
    await audit(request.user.id, 'update', 'product', String(product._id), Object.keys(input));
    response.json({ success: true, product });
  } catch (error) { next(error); }
});
adminProductRoutes.delete('/products/:id', async (request, response, next) => {
  try {
    if (!mongoose.isValidObjectId(request.params.id)) return response.status(404).json({ success: false, error: 'Product not found' });
    const product = await Product.findByIdAndUpdate(request.params.id, { $set: { isActive: false } }, { new: true });
    if (!product) return response.status(404).json({ success: false, error: 'Product not found' });
    await audit(request.user.id, 'soft_delete', 'product', String(product._id), { name: product.name });
    response.json({ success: true });
  } catch (error) { next(error); }
});

export default router;
