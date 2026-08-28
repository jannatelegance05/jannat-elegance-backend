import { Category } from './models.js';

// These are the collections shown on the homepage. They are database records,
// so admins can use them immediately and can add further categories at any time.
export const defaultCategoryNames = [
  'Sharara Suit', 'Garara Suit', 'Pant Suit', 'Farshi Shalwar Suit',
  'Frock Suit', 'Gown', 'Lehnga', 'Plazo Suit',
];

export async function ensureDefaultCategories() {
  // Seed only a completely new database. Admin deletions must remain deleted
  // after later backend restarts.
  if (await Category.exists({})) return;
  await Category.bulkWrite(defaultCategoryNames.map((name) => ({
    updateOne: { filter: { name }, update: { $setOnInsert: { name } }, upsert: true },
  })), { ordered: false });
}
