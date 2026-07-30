const puppeteer = require('puppeteer');
const URL = 'https://draw-and-guess-production-2897.up.railway.app';

async function test() {
  console.log('=== Railway 真浏览器测试 ===\n');
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  try {
    console.log('1. 打开页面...');
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
    console.log('   标题:', await page.title());

    console.log('2. 检查 io...');
    const hasIO = await page.evaluate(() => typeof io !== 'undefined');
    console.log('   io:', hasIO ? '✅' : '❌');

    console.log('3. 创建房间...');
    await page.type('#nickname-input', '测试');
    await page.click('#create-room-btn');

    console.log('4. 等待房间号...');
    await page.waitForFunction(
      () => { const el = document.querySelector('#room-code-big'); return el && el.textContent.length === 4; },
      { timeout: 20000 }
    );
    const code = await page.$eval('#room-code-big', el => el.textContent);
    console.log('   房间:', code);

    const canvas = await page.$('#draw-canvas');
    console.log('   画布:', canvas ? '✅' : '❌');

    const waiting = await page.$eval('#waiting-bar', el => !el.classList.contains('hidden'));
    console.log('   等待栏:', waiting ? '✅' : '❌');

    if (errors.length) { console.log('\n⚠️ 错误:', errors.join(', ')); }
    else console.log('\n✅ 零错误');

    console.log('\n🎉 Railway 版测试通过！');
    process.exit(0);
  } catch (e) {
    console.error('❌', e.message);
    if (errors.length) console.log('错误:', errors);
    process.exit(1);
  } finally {
    await browser.close();
  }
}
setTimeout(() => { process.exit(1); }, 60000);
test();
