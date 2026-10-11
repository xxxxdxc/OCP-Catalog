import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { PRODUCTS, entryId, productOf, shopOf, SIZES, SUGARS, ICES, ADDONS } from './data';

export const selectionSchema = z.object({
  entry_id: z.string().min(1), size: z.enum(['regular','large']).default('regular'),
  sugar: z.enum(['zero','light','half','full']).default('light'),
  ice: z.enum(['regular','less','none','hot']).default('less'),
  addons: z.array(z.enum(['pearl','coconut','cream'])).max(3).default([]),
  quantity: z.number().int().min(1).max(5).default(1),
}).strict();
export const orderSchema = z.object({ quote_id: z.string().min(1), expected_total_cents: z.number().int().positive(),
  user_confirmed: z.literal(true), idempotency_key: z.string().min(8).max(128) }).strict();
export type Quote = z.infer<typeof selectionSchema> & {
  quote_id: string; title: string; shop_id: string; shop_name: string;
  breakdown: { label: string; cents: number }[]; unit_cents: number; total_cents: number;
  selection_label: string; currency: 'CNY'; expires_at: string; simulation: true;
};
export type Order = Quote & { order_id: string; created_at: string; pickup_code: string; payment_status: 'simulation_no_payment' };
export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export class TeaStore {
  db: Database;
  constructor(path: string, private now = Date.now) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS tea_stock (entry_id TEXT PRIMARY KEY, quantity INTEGER NOT NULL CHECK(quantity >= 0));
      CREATE TABLE IF NOT EXISTS tea_quotes (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tea_orders (id TEXT PRIMARY KEY, quote_id TEXT UNIQUE NOT NULL, idem TEXT UNIQUE NOT NULL, payload TEXT NOT NULL);`);
    for (const p of PRODUCTS) this.db.query('INSERT OR IGNORE INTO tea_stock VALUES (?,?)').run(entryId(p), p.stock);
  }
  stock(id: string) { return (this.db.query('SELECT quantity FROM tea_stock WHERE entry_id=?').get(id) as { quantity: number } | null)?.quantity ?? 0; }
  quote(input: unknown): Quote {
    const args = selectionSchema.parse(input), product = productOf(args.entry_id);
    if (!product) throw new AppError('not_found', '未找到这款饮品。', 404);
    if (args.quantity > this.stock(args.entry_id)) throw new AppError('sold_out', '饮品已售罄或剩余数量不足。', 409);
    if (args.ice === 'hot' && !product.hot) throw new AppError('invalid_options', '这款果茶不支持热饮。');
    if (new Set(args.addons).size !== args.addons.length || args.addons.some(addon => !product.addons.includes(addon)))
      throw new AppError('invalid_options', '加料选项无效或重复。');
    const breakdown = [{ label: '中杯基础价', cents: product.cents },
      ...(args.size === 'large' ? [{ label: '升级大杯', cents: product.large_cents }] : []),
      ...args.addons.map(addon => ({ label: ADDONS[addon].name, cents: ADDONS[addon].cents }))];
    const unit = breakdown.reduce((total, row) => total + row.cents, 0);
    const quote: Quote = { ...args, quote_id: `tq_${crypto.randomUUID()}`, title: product.title,
      shop_id: product.shop_id, shop_name: shopOf(product.shop_id)!.name, breakdown,
      unit_cents: unit, total_cents: unit * args.quantity, currency: 'CNY', simulation: true,
      selection_label: [SIZES[args.size],SUGARS[args.sugar],ICES[args.ice],...args.addons.map(a=>ADDONS[a].name)].join(' · '),
      expires_at: new Date(this.now() + 300_000).toISOString() };
    this.db.query('INSERT INTO tea_quotes VALUES (?,?)').run(quote.quote_id, JSON.stringify(quote));
    return quote;
  }
  getQuote(id: string): Quote {
    const row = this.db.query('SELECT payload FROM tea_quotes WHERE id=?').get(id) as { payload: string } | null;
    if (!row) throw new AppError('quote_not_found', '报价不存在，请先选择规格。', 404);
    return JSON.parse(row.payload);
  }
  createOrder(input: unknown) {
    const args = orderSchema.parse(input);
    return this.db.transaction(() => {
      const row = this.db.query('SELECT payload FROM tea_orders WHERE idem=? OR quote_id=?').get(args.idempotency_key,args.quote_id) as { payload: string } | null;
      if (row) {
        const order = JSON.parse(row.payload) as Order;
        if (order.quote_id !== args.quote_id || order.total_cents !== args.expected_total_cents)
          throw new AppError('idempotency_conflict','该提交标识已用于其他订单。',409);
        return { ...this.status(order), replayed: true };
      }
      const quote = this.getQuote(args.quote_id);
      if (Date.parse(quote.expires_at) <= this.now()) throw new AppError('quote_expired','报价已过期，请重新报价并确认。',409);
      if (quote.total_cents !== args.expected_total_cents) throw new AppError('price_mismatch','确认金额与报价不一致。',409);
      const changed = this.db.query('UPDATE tea_stock SET quantity=quantity-? WHERE entry_id=? AND quantity>=?')
        .run(quote.quantity,quote.entry_id,quote.quantity).changes;
      if (!changed) throw new AppError('sold_out','库存不足，请重新选择。',409);
      const order: Order = { ...quote, order_id: `tea_${crypto.randomUUID()}`, created_at: new Date(this.now()).toISOString(),
        pickup_code: `DEMO-${crypto.randomUUID().slice(0,6).toUpperCase()}`, payment_status: 'simulation_no_payment' };
      this.db.query('INSERT INTO tea_orders VALUES (?,?,?,?)').run(order.order_id, quote.quote_id,args.idempotency_key,JSON.stringify(order));
      return { ...this.status(order), replayed: false };
    }).immediate();
  }
  getOrder(id: string) {
    const row = this.db.query('SELECT payload FROM tea_orders WHERE id=?').get(id) as { payload: string } | null;
    if (!row) throw new AppError('order_not_found','未找到订单。',404);
    return this.status(JSON.parse(row.payload));
  }
  orderForQuote(id: string) {
    return this.db.query('SELECT id FROM tea_orders WHERE quote_id=?').get(id) as {id:string}|null;
  }
  listOrders() { return (this.db.query('SELECT payload FROM tea_orders ORDER BY rowid DESC LIMIT 20').all() as {payload:string}[]).map(row=>this.status(JSON.parse(row.payload))); }
  private status(order: Order) {
    const elapsed = this.now() - Date.parse(order.created_at);
    return { ...order, status: elapsed >= 30_000 ? 'ready' : elapsed >= 10_000 ? 'preparing' : 'accepted',
      status_label: elapsed >= 30_000 ? '模拟可取餐' : elapsed >= 10_000 ? '模拟制作中' : '已接单（模拟）' };
  }
  close() { this.db.close(); }
}
