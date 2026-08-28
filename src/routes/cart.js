import { Router } from 'express';
import { z } from 'zod';
import { CartItem, Product } from '../models.js';
import { requireAuth, requireSameOrigin } from '../auth.js';

const router = Router();
const cartLine = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i), size: z.enum(['S', 'M', 'L', 'XL', 'XXL']), quantity: z.number().int().min(1).max(10) });
router.use(requireAuth);
router.get('/', async (request, response, next) => { try { const cart = await CartItem.find({ userId: request.user.id }).lean(); response.json({ success: true, cart: cart.map((line) => ({ id: String(line.productId), name: line.name, price: line.price, category: line.category, size: line.size, image: line.image, quantity: line.quantity })) }); } catch (error) { next(error); } });
router.post('/', requireSameOrigin, async (request, response, next) => {
  try {
    const { cart } = z.object({ cart: z.array(cartLine).max(50) }).parse(request.body);
    const ids = [...new Set(cart.map((line) => line.id))];
    const products = await Product.find({ _id: { $in: ids }, isActive: true, status: 'published' }).populate('categoryId', 'name').lean();
    if (products.length !== ids.length) return response.status(400).json({ success: false, error: 'One or more products are unavailable' });
    const productsById = new Map(products.map((product) => [String(product._id), product]));
    const documents = cart.map((line) => {
      const product = productsById.get(line.id); const selectedSize = product.sizes.find((item) => item.size === line.size);
      if (!selectedSize || selectedSize.stock < line.quantity) throw new Error('Requested size is unavailable');
      const salePrice = product.isOnSale ? Math.max(0, product.price - (product.discountType === 'percentage' ? product.price * product.discount / 100 : product.discount)) : product.price;
      return { userId: request.user.id, productId: line.id, name: product.name, price: Math.round(salePrice * 100) / 100, category: product.categoryId?.name || '', size: line.size, image: product.imageUrls[0] || '', quantity: line.quantity };
    });
    await CartItem.deleteMany({ userId: request.user.id });
    if (documents.length) await CartItem.insertMany(documents);
    response.json({ success: true });
  } catch (error) { if (error.message === 'Requested size is unavailable') return response.status(400).json({ success: false, error: error.message }); next(error); }
});
export default router;
