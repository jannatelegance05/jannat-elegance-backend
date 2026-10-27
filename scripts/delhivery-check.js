/*
 * Delhivery One connection test.
 *
 *   npm run delhivery:test                 read-only checks (token, pincodes, rate)
 *   npm run delhivery:test -- 110001       also check a specific delivery pincode
 *   npm run delhivery:test -- --create     also create a test shipment, then cancel it
 *   npm run delhivery:test -- --create --keep   create without cancelling
 *
 * Reads DELHIVERY_* from .env. No database connection is used.
 */
import 'dotenv/config';

// config.js requires these, but this script never touches MongoDB or sessions.
process.env.MONGODB_URI ||= 'mongodb://unused';
process.env.JWT_SECRET ||= 'unused-for-delhivery-test';

const { config } = await import('../src/config.js');
const delhivery = await import('../src/delhivery.js');
const { Order } = await import('../src/models.js');

const args = process.argv.slice(2);
const shouldCreate = args.includes('--create');
const keep = args.includes('--keep');
const destinationPincode = args.find((arg) => /^\d{6}$/.test(arg)) || '110001';
const settings = config.delhivery;

const ok = (message) => console.log(`  ✔ ${message}`);
const fail = (message) => console.log(`  ✖ ${message}`);
const step = (title) => console.log(`\n${title}`);
const describe = (error) => `${error.message}${error.details ? `\n      ${JSON.stringify(error.details).slice(0, 400)}` : ''}`;

console.log(`Delhivery One test — ${settings.environment.toUpperCase()}`);
if (!settings.apiToken) {
  fail('DELHIVERY_API_TOKEN is not set in jannat-ellegance-backend/.env');
  process.exit(1);
}
console.log(`  Pickup location: ${settings.pickupLocation || '(not set)'}`);
console.log(`  Origin pincode:  ${settings.originPincode || '(not set)'}`);

let failures = 0;

step('1. Token + origin pincode serviceability');
try {
  const origin = await delhivery.checkServiceability(settings.originPincode || '201301');
  ok(`Token accepted. Origin ${origin.pincode}: pickup ${origin.pickup ? 'yes' : 'no'}, ${origin.city || 'city unknown'}`);
} catch (error) { failures += 1; fail(describe(error)); }

step(`2. Delivery pincode ${destinationPincode}`);
try {
  const result = await delhivery.checkServiceability(destinationPincode);
  (result.serviceable ? ok : fail)(`${result.serviceable ? 'Serviceable' : 'Not serviceable'} — prepaid ${result.prepaid ? 'yes' : 'no'}, COD ${result.cod ? 'yes' : 'no'}${result.city ? `, ${result.city}` : ''}${result.remarks ? `, remarks: ${result.remarks}` : ''}`);
} catch (error) { failures += 1; fail(describe(error)); }

step('3. Shipping rate estimate');
if (!settings.originPincode) fail('Skipped: DELHIVERY_ORIGIN_PINCODE is not set');
else {
  try {
    const rate = await delhivery.getShippingRate({ pincode: destinationPincode, weightGrams: settings.defaultWeightGrams });
    ok(`₹${rate.total} for ${settings.defaultWeightGrams} g ${settings.shippingMode}, prepaid`);
  } catch (error) { failures += 1; fail(describe(error)); }
}

if (shouldCreate) {
  step('4. Test shipment');
  // In-memory order only; save() is replaced so nothing is written to the database.
  const order = new Order({
    orderNumber: `JETEST${Date.now().toString().slice(-8)}`,
    customerName: 'Test Customer',
    customerEmail: '',
    customerPhone: '9999999999',
    shippingAddress: 'Test address, please do not deliver',
    city: 'New Delhi',
    state: 'Delhi',
    postalCode: destinationPincode,
    subtotal: 1,
    total: 1,
    paymentMethod: 'RAZORPAY',
    paymentStatus: 'paid',
    items: [{ name: 'Test item', price: 1, quantity: 1, size: 'M' }],
  });
  order.save = async function save() { return this; };

  try {
    await delhivery.createShipment(order);
    const waybill = order.shippingInfo.delhivery.waybill;
    ok(`Shipment created. AWB ${waybill} (reference ${order.orderNumber})`);

    try { ok(`Label: ${await delhivery.getLabelUrl(waybill)}`); } catch (error) { fail(`Label: ${describe(error)}`); }
    try {
      const tracking = await delhivery.trackWaybill(waybill);
      ok(`Tracking status: ${tracking?.status || 'not available yet'}`);
    } catch (error) { fail(`Tracking: ${describe(error)}`); }

    if (keep) console.log(`  ! Kept AWB ${waybill}. Cancel it in Delhivery One if it is not needed.`);
    else {
      try { await delhivery.cancelShipment(order); ok(`Cancelled AWB ${waybill}`); } catch (error) {
        failures += 1;
        fail(`Cancel failed — cancel AWB ${waybill} manually in Delhivery One. ${describe(error)}`);
      }
    }
  } catch (error) { failures += 1; fail(describe(error)); }
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
// exitCode (not exit()) lets open fetch sockets close cleanly on Windows.
process.exitCode = failures ? 1 : 0;
