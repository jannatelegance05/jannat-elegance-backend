import { Category } from './models.js';

// These are the collections shown on the homepage. They are database records,
// so admins can use them immediately and can add further categories at any time.
export const defaultCategories = [
  { name: 'Sharara Suit', imageUrl: '/images/products/Sharara-Suit/IMG-20260824-WA0016.jpg' },
  { name: 'Garara Suit', imageUrl: '/images/products/Garara-Suit/IMG-20260824-WA0003.jpg' },
  { name: 'Pant Suit', imageUrl: '/images/products/Pant-Suit/IMG-20260824-WA0021.jpg' },
  { name: 'Farshi Shalwar Suit', imageUrl: '/images/products/Farshi-Shalwar-Suit/IMG-20260824-WA0020.jpg' },
  { name: 'Frock Suit', imageUrl: '/images/products/Frock-Suit/IMG-20260824-WA0019.jpg' },
  { name: 'Gown', imageUrl: '/images/products/Gown/IMG-20260824-WA0015.jpg' },
  { name: 'Lehnga', imageUrl: '/images/products/Lehnga/IMG-20260824-WA0004.jpg' },
  { name: 'Plazo Suit', imageUrl: '/images/products/Plazo-Suit/IMG-20260824-WA0017.jpg' },
];

export async function ensureDefaultCategories() {
  // Insert defaults only for new databases. Existing categories retain any
  // admin changes, while legacy defaults receive their original image once.
  if (!await Category.exists({})) {
    await Category.insertMany(defaultCategories);
    return;
  }
  await Promise.all(defaultCategories.map((category) => Category.updateOne(
    { name: category.name, $or: [{ imageUrl: { $exists: false } }, { imageUrl: '' }, { imageUrl: null }] },
    { $set: { imageUrl: category.imageUrl } },
  )));
}
