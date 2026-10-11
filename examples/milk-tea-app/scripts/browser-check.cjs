// Run against an already-started local app. Playwright is a QA-only dependency.
const { chromium } = require('playwright');
const { mkdirSync, writeFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const output = resolve(__dirname, '../evidence'); mkdirSync(output, { recursive: true });
  const systemChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const executablePath = process.env.TEA_CHROME_PATH || (existsSync(systemChrome) ? systemChrome : undefined);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(process.env.TEA_URL || 'http://127.0.0.1:5174');
    await page.locator('.product-card').first().waitFor();
    assert.equal(await page.locator('.product-card').count(), 8);
    await page.screenshot({ path: resolve(output, '01-menu.png'), fullPage: true });
    await page.getByRole('button', { name: '选择经典珍珠奶茶 · 青屿茶坊', exact: true }).click();
    await page.getByLabel('杯型', { exact: true }).selectOption('large');
    await page.getByLabel('甜度', { exact: true }).selectOption('light');
    await page.getByLabel('冰量', { exact: true }).selectOption('less');
    await page.getByLabel('珍珠 +¥2', { exact: true }).check();
    await page.locator('.quote-total strong').waitFor();
    await page.getByText('¥20.00', { exact: true }).waitFor();
    assert.equal(await page.locator('.quote-total strong').textContent(), '¥20.00');
    assert.equal(await page.locator('#quote-button').count(), 0);
    await page.getByRole('checkbox', { name: '我已确认门店、规格、数量与金额，创建模拟订单。', exact: true }).check();
    await page.getByLabel('数量', { exact: true }).fill('2');
    await page.getByText('¥40.00', { exact: true }).waitFor();
    assert.equal(await page.getByRole('checkbox', { name: '我已确认门店、规格、数量与金额，创建模拟订单。', exact: true }).isChecked(), false);
    await page.getByLabel('数量', { exact: true }).fill('1');
    await page.getByText('¥20.00', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '确认模拟下单', exact: true }).isEnabled(), false);
    await page.screenshot({ path: resolve(output, '02-quote.png'), fullPage: true });
    await page.getByRole('checkbox', { name: '我已确认门店、规格、数量与金额，创建模拟订单。', exact: true }).check();
    await page.getByRole('button', { name: '确认模拟下单', exact: true }).click();
    await page.locator('.order-success').waitFor();
    assert.match(await page.locator('.pickup').textContent(), /^DEMO-/);
    await page.screenshot({ path: resolve(output, '03-order.png'), fullPage: true });
    await page.getByRole('button', { name: '查询订单状态', exact: true }).click();
    await page.getByRole('button', { name: /^我的订单/ }).click();
    await page.locator('.order-record').first().waitFor();
    assert.match(await page.locator('.order-record').first().textContent(), /大杯 · 三分糖 · 少冰 · 珍珠/);
    await page.screenshot({ path: resolve(output, '04-orders.png'), fullPage: true });
    await page.getByRole('button', { name: '协议演示 ↗', exact: true }).click();
    await page.locator('.trace-row').first().waitFor();
    const trace = await page.locator('#trace-list').textContent();
    assert.match(trace, /query/); assert.match(trace, /resolve/); assert.match(trace, /business · order/);
    await page.screenshot({ path: resolve(output, '05-protocol.png'), fullPage: true });
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
    const small = await mobile.newPage();
    await small.goto(process.env.TEA_URL || 'http://127.0.0.1:5174');
    await small.locator('.product-card').first().waitFor();
    assert.ok(await small.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile page overflows horizontally');
    await small.screenshot({ path: resolve(output, '06-mobile.png'), fullPage: true });
    await mobile.close();
    assert.deepEqual(errors, []);
    const report = { browser: 'Chrome headless, fresh profile', menu_cards: 8, quoted_cents: 2000,
      selection: '大杯 / 三分糖 / 少冰 / 加珍珠 / 1 杯', confirmed_simulated_order: true,
      order_history: true, protocol_trace: true, mobile_overflow: false, page_errors: errors,
      screenshots: ['01-menu.png','02-quote.png','03-order.png','04-orders.png','05-protocol.png','06-mobile.png'] };
    writeFileSync(resolve(output, 'browser-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error('Browser page errors:', errors);
    console.error('Selection DOM:', await page.locator('#selection').innerHTML());
    await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true });
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
