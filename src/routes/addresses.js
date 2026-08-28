import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Address } from '../models.js';
import { requireAuth, requireSameOrigin } from '../auth.js';

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const addressInput = z.object({ name: z.string().trim().min(2).max(100), phone: z.string().regex(/^\d{10}$/), addressLine: z.string().trim().min(5).max(300), city: z.string().trim().min(2).max(100), state: z.string().trim().min(2).max(100), pincode: z.string().regex(/^\d{6}$/), landmark: z.string().trim().max(100).optional().or(z.literal('')), isDefault: z.boolean().optional() }).strict();
const addressResponse = (address) => ({ ...address, id: String(address._id) });

async function saveAddressForUser(userId, input, currentId) {
  const session = await mongoose.startSession();
  let address;
  try {
    await session.withTransaction(async () => {
      const mustDefault = input.isDefault || !(await Address.exists({ userId }).session(session));
      if (mustDefault) await Address.updateMany({ userId, ...(currentId ? { _id: { $ne: currentId } } : {}) }, { $set: { isDefault: false } }, { session });
      const values = { ...input, landmark: input.landmark || undefined, isDefault: Boolean(mustDefault) };
      if (currentId) address = await Address.findOneAndUpdate({ _id: currentId, userId }, { $set: values }, { new: true, session }); else [address] = await Address.create([{ ...values, userId }], { session });
    });
    return address;
  } finally { await session.endSession(); }
}

router.use(requireAuth);
router.get('/', async (request, response, next) => { try { response.json({ success: true, addresses: (await Address.find({ userId: request.user.id }).sort({ isDefault: -1, createdAt: -1 }).lean()).map(addressResponse) }); } catch (error) { next(error); } });
router.post('/', requireSameOrigin, async (request, response, next) => { try { const address = await saveAddressForUser(request.user.id, addressInput.parse(request.body)); response.status(201).json({ success: true, address: addressResponse(address.toObject()) }); } catch (error) { next(error); } });
router.patch('/:id', requireSameOrigin, async (request, response, next) => { try { const id = objectId.parse(request.params.id); const address = await saveAddressForUser(request.user.id, addressInput.parse(request.body), id); if (!address) return response.status(404).json({ success: false, error: 'Address not found' }); response.json({ success: true, address: addressResponse(address.toObject()) }); } catch (error) { if (error instanceof z.ZodError || mongoose.isValidObjectId(request.params.id)) return next(error); response.status(404).json({ success: false, error: 'Address not found' }); } });
router.delete('/:id', requireSameOrigin, async (request, response, next) => {
  try {
    const id = objectId.parse(request.params.id); const session = await mongoose.startSession(); let deleted;
    try { await session.withTransaction(async () => { deleted = await Address.findOneAndDelete({ _id: id, userId: request.user.id }, { session }); if (deleted?.isDefault) { const nextDefault = await Address.findOne({ userId: request.user.id }).sort({ createdAt: -1 }).session(session); if (nextDefault) { nextDefault.isDefault = true; await nextDefault.save({ session }); } } }); } finally { await session.endSession(); }
    if (!deleted) return response.status(404).json({ success: false, error: 'Address not found' }); response.json({ success: true });
  } catch (error) { if (error instanceof z.ZodError) return response.status(404).json({ success: false, error: 'Address not found' }); next(error); }
});
export default router;
