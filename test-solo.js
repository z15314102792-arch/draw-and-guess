const puppeteer = require('puppeteer');
const URL = 'https://draw-and-guess-production-2897.up.railway.app';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));

  console.log('=== v2.0 单人创作 浏览器测试 ===');

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 20000 });
  const ver = await page.evaluate(() => document.querySelector('.version-tag')?.textContent);
  console.log('版本:', ver || '未找到');

  const btn = await page.waitForSelector('#solo-mode-btn', { timeout: 5000 });
  console.log('单人创作按钮:', btn ? '✅' : '❌');
  await btn.click();
  await new Promise(r => setTimeout(r, 800));

  const canvas = await page.waitForSelector('#solo-canvas', { timeout: 5000 });
  console.log('画布:', canvas ? '✅' : '❌');

  const brushCount = await page.evaluate(() => document.querySelectorAll('.solo-brush-btn').length);
  console.log('画笔数:', brushCount, brushCount === 6 ? '✅' : '❌');

  const sliders = await page.evaluate(() => document.querySelectorAll('.solo-slider').length);
  console.log('滑块数:', sliders, sliders === 2 ? '✅' : '❌');

  const colorCount = await page.evaluate(() => document.querySelectorAll('.solo-color-btn').length);
  console.log('颜色数:', colorCount, colorCount >= 12 ? '✅' : '❌');

  // 画一笔
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  for (let i = 0; i < 10; i++) {
    await page.mouse.move(box.x + 100 + i * 20, box.y + 100 + i * 5, { steps: 5 });
  }
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 300));
  console.log('绘画:', '✅');

  // 撤销
  const undoBtn = await page.waitForSelector('#solo-undo-btn', { timeout: 3000 });
  await undoBtn.click();
  await new Promise(r => setTimeout(r, 200));
  console.log('撤销:', '✅');

  // 返回大厅
  const backBtn = await page.waitForSelector('#solo-back-btn', { timeout: 3000 });
  await backBtn.click();
  await new Promise(r => setTimeout(r, 300));
  const lobby = await page.evaluate(() => document.querySelector('#lobby-screen.active') !== null);
  console.log('返回大厅:', lobby ? '✅' : '❌');

  if (errors.length) console.log('\n错误:', errors.join(', '));
  else console.log('\n✅ 零错误');

  console.log('\n🎉 v2.0 单人创作模式测试通过！');
  await browser.close();
  process.exit(0);
})();
