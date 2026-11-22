// The HBS booking fee, paid through Wix Payments on Susy's Wix site.
//
// - createCheckout: a Wix-hosted checkout for exactly this job's fee (Checkout Sessions API). The
//   client can pay but can't change the amount; coupons and gift cards are off.
// - findPayment: looks up the Wix order made from the job's checkout and says whether it is paid,
//   for the right amount. The job page and the team never take the client's word for it.
//
// The Wix key needs two permissions beyond the team app's: "Generate checkout sessions" and
// "Read Orders". Without them Wix answers 401/403, and the client sees that payments aren't on yet.

import { wixRequest, WixError } from '../team/wix.mjs';
import { money, dateLabel } from './rules.mjs';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHECKOUT_HOSTS = new Set(['www.hairbysusy.com', 'hairbysusy.com', 'www.wix.com']);

export class PayError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail || ''; }
}

function payErrorFrom(e) {
  if (e instanceof PayError) return e;
  if (e instanceof WixError && (e.status === 401 || e.status === 403)) return new PayError('payments_off', 'wix_' + e.status);
  if (e instanceof WixError) return new PayError('payments_failed', 'wix_' + e.status + (e.code ? ' ' + e.code : ''));
  if (e && e.code === 'wix_not_set') return new PayError('payments_off', 'wix_not_set');
  return new PayError('payments_failed', (e && (e.name || e.message)) || 'error');
}

// The line on the checkout page and on the Wix order. It names the job, so every booking fee in
// the Wix dashboard says which job it paid for.
export function itemName(id, doc) {
  return ((doc.test ? 'TEST · ' : '') + 'HBS booking fee · Job ' + id + ' · ' + doc.city + ', ' + dateLabel(doc.date)).slice(0, 200);
}

export function jobLink(origin, id, key) {
  return origin + '/book/job/?j=' + encodeURIComponent(id) + '&k=' + encodeURIComponent(key);
}

export async function createCheckout({ id, doc, key, origin }) {
  const c = doc.client || {};
  const customerInfo = {};
  if (c.first) customerInfo.firstName = c.first.slice(0, 100);
  if (c.last) customerInfo.lastName = c.last.slice(0, 100);
  if (c.email) customerInfo.email = c.email;
  if (c.phone) customerInfo.phone = c.phone;
  const link = jobLink(origin, id, key);
  let r;
  try {
    r = await wixRequest('POST', '/payments/platform/v1/checkout-sessions/generate', {
      body: {
        cart: { items: [{ name: itemName(id, doc), quantity: 1, price: money(doc.fee_cents) }], customerInfo },
        callbackUrls: { thankYouPageUrl: link + '&paid=1', continueBrowsingUrl: link },
        externalInfo: { hbsJob: id },
      },
      timeout: 12000,
    });
  } catch (e) {
    throw payErrorFrom(e);
  }
  const s = (r && r.checkoutSession) || {};
  let url = null;
  try { url = new URL(String(s.redirectUrl || '')); } catch { url = null; }
  if (!GUID_RE.test(String(s.id || '')) || !url || url.protocol !== 'https:' || !CHECKOUT_HOSTS.has(url.hostname)) {
    throw new PayError('payments_failed', 'unexpected checkout');
  }
  return { id: s.id, url: url.toString() };
}

const toCents = (amount) => {
  const n = Number(String(amount ?? '').trim());
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

// What Wix says about this job's booking fee:
//   { state: 'paid', orderId, number, cents, at }   paid in full, for the job's fee
//   { state: 'pending' }                            an order exists but isn't paid yet
//   { state: 'refunded', orderId, number }          paid, then refunded
//   { state: 'none' }                               nothing paid
export async function findPayment(id, doc) {
  const sessions = ((doc.pay && doc.pay.sessions) || []).map((s) => s && s.id).filter((x) => GUID_RE.test(String(x || '')));
  const name = itemName(id, doc);
  const match = [{ 'lineItems.productName.original': { $hasSome: [name] } }];
  if (sessions.length) match.unshift({ checkoutId: { $in: sessions } });
  let r;
  try {
    r = await wixRequest('POST', '/ecom/v1/orders/search', {
      body: {
        search: {
          filter: { $and: [{ $or: match }, { status: { $in: ['APPROVED', 'PENDING'] } }] },
          cursorPaging: { limit: 20 },
        },
      },
      timeout: 10000,
    });
  } catch (e) {
    throw payErrorFrom(e);
  }
  const mine = (r.orders || []).filter((o) => sessions.includes(o.checkoutId) || (o.lineItems || []).some((li) =>
    (li.productName && li.productName.original === name) || (li.catalogReference && li.catalogReference.options && li.catalogReference.options.hbsJob === id)));
  const usd = (o) => !o.currency || o.currency === 'USD';
  const subtotal = (o) => toCents(o.priceSummary && o.priceSummary.subtotal && o.priceSummary.subtotal.amount);

  const paid = mine.find((o) => o.paymentStatus === 'PAID' && usd(o) && subtotal(o) === doc.fee_cents);
  if (paid) {
    return { state: 'paid', orderId: paid.id, number: String(paid.number || ''), cents: subtotal(paid), at: paid.purchasedDate || paid.createdDate || new Date().toISOString() };
  }
  const refunded = mine.find((o) => o.paymentStatus === 'FULLY_REFUNDED');
  if (refunded) return { state: 'refunded', orderId: refunded.id, number: String(refunded.number || '') };
  if (mine.length) return { state: 'pending', orderId: mine[0].id, number: String(mine[0].number || ''), status: String(mine[0].paymentStatus || '') };
  return { state: 'none' };
}
