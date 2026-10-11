export const SHOPS = [
  { id: 'qingyu', name: '青屿茶坊', subtitle: '清香茶底 · 鲜奶现调', color: '#316b56', address: '校园东门 · 模拟门店' },
  { id: 'mushan', name: '暮山茶社', subtitle: '慢焙乌龙 · 当季果茶', color: '#ad633e', address: '校园西门 · 模拟门店' },
] as const;
export type ShopId = typeof SHOPS[number]['id'];
export const SIZES = { regular: '中杯', large: '大杯' };
export const SUGARS = { zero: '无糖', light: '三分糖', half: '五分糖', full: '全糖' };
export const ICES = { regular: '正常冰', less: '少冰', none: '去冰', hot: '热饮' };
export const ADDONS = { pearl: { name: '珍珠', cents: 200 }, coconut: { name: '椰果', cents: 200 }, cream: { name: '奶盖', cents: 300 } };
export type Product = {
  id: string; shop_id: ShopId; title: string; summary: string; category: '奶茶' | '果茶';
  cents: number; large_cents: number; stock: number; hot: boolean;
  addons: (keyof typeof ADDONS)[]; colors: [string, string]; icon: string;
};
export const PRODUCTS: Product[] = [
  { id: 'pearl', shop_id: 'qingyu', title: '经典珍珠奶茶', summary: '红茶的醇香，碰上软糯珍珠。每一口都是熟悉的安心。', category: '奶茶', cents: 1600, large_cents: 200, stock: 20, hot: true, addons: ['pearl','coconut','cream'], colors: ['#e5bb87','#a56d46'], icon: '●' },
  { id: 'jasmine', shop_id: 'qingyu', title: '茉莉鲜奶茶', summary: '轻盈茉莉花香与鲜奶相遇，留一份清爽给午后。', category: '奶茶', cents: 1800, large_cents: 200, stock: 16, hot: true, addons: ['pearl','coconut'], colors: ['#d9dba2','#9bab75'], icon: '✿' },
  { id: 'mango', shop_id: 'qingyu', title: '杨枝甘露', summary: '芒果、西柚与椰香交织，明亮得像一小杯夏天。', category: '果茶', cents: 2200, large_cents: 300, stock: 12, hot: false, addons: ['coconut'], colors: ['#f8cf77','#ee9a45'], icon: '✦' },
  { id: 'lemon', shop_id: 'qingyu', title: '手打柠檬绿茶', summary: '手打柠檬的清新酸香，唤醒一杯绿茶。', category: '果茶', cents: 1400, large_cents: 200, stock: 25, hot: false, addons: ['coconut','pearl'], colors: ['#e6e49b','#aabc77'], icon: '◒' },
  { id: 'pearl', shop_id: 'mushan', title: '黑糖珍珠奶茶', summary: '慢煮黑糖与红茶奶香，给今天一点温柔甜意。', category: '奶茶', cents: 1500, large_cents: 300, stock: 18, hot: true, addons: ['pearl','cream'], colors: ['#d3ab84','#805642'], icon: '●' },
  { id: 'oolong', shop_id: 'mushan', title: '岩韵乌龙鲜奶茶', summary: '焙火乌龙的茶韵，搭配柔和鲜奶，回味悠长。', category: '奶茶', cents: 1700, large_cents: 200, stock: 15, hot: true, addons: ['pearl','cream','coconut'], colors: ['#ccb98a','#968257'], icon: '❋' },
  { id: 'peach', shop_id: 'mushan', title: '白桃乌龙果茶', summary: '白桃香气轻轻展开，清透乌龙接住每一口。', category: '果茶', cents: 1800, large_cents: 300, stock: 10, hot: false, addons: ['coconut'], colors: ['#f1bdac','#d58d89'], icon: '♡' },
  { id: 'grape', shop_id: 'mushan', title: '多肉葡萄', summary: '葡萄果肉与清香茶底，紫色的清凉灵感。', category: '果茶', cents: 2000, large_cents: 300, stock: 0, hot: false, addons: ['coconut','cream'], colors: ['#c6b3db','#9479b2'], icon: '✧' },
];
export const entryId = (p: Product) => `${p.shop_id}:${p.id}`;
export const shopOf = (id: string) => SHOPS.find(shop => shop.id === id);
export function productOf(id: string) { return PRODUCTS.find(product => entryId(product) === id); }
