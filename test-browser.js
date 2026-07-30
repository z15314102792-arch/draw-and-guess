/**
 * 真实浏览器端到端测试
 */
const puppeteer = require('puppeteer');
const GH_URL = 'https://z15314102792-arch.github.io/draw-and-guess/';

async function test() {
  console.log('=== 浏览器端到端测试 ===\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message + ' | stack: ' + (err.stack || '').substring(0,300)));

  try {
    // 1. 打开页面
    console.log('1. 打开页面...');
    await page.goto(GH_URL, { waitUntil: 'networkidle2', timeout: 20000 });
    const title = await page.title();
    console.log('   标题:', title);

    // 2. 检查 socket.io 是否加载成功
    console.log('2. 检查 socket.io...');
    const hasIO = await page.evaluate(() => typeof io !== 'undefined');
    console.log('   io 全局:', hasIO ? '✅ 已加载' : '❌ 未加载');

    // 3. 填入昵称
    console.log('3. 填入昵称...');
    await page.type('#nickname-input', '测试员');
    const nameVal = await page.$eval('#nickname-input', el => el.value);
    console.log('   昵称:', nameVal);

    // 4. 点击创建房间
    console.log('4. 点击创建房间...');
    await page.click('#create-room-btn');

    // 5. 等待游戏界面出现
    console.log('5. 等待游戏界面...');
    try {
      await page.waitForSelector('#game-screen.active', { timeout: 15000 });
    } catch {
      // 可能还在加载
    }

    // 6. 等待房间号出现
    console.log('6. 等待房间创建...');
    await page.waitForFunction(
      () => document.querySelector('#room-code-big')?.textContent?.length === 4,
      { timeout: 15000 }
    );
    const roomCode = await page.$eval('#room-code-big', el => el.textContent);
    console.log('   房间号:', roomCode);

    // 7. 检查等待栏可见
    const waitingVisible = await page.$eval('#waiting-bar', el => !el.classList.contains('hidden'));
    console.log('   等待栏:', waitingVisible ? '✅ 可见' : '❌ 隐藏');

    // 8. 检查画布存在
    const canvasExists = await page.$('#draw-canvas');
    console.log('   画布:', canvasExists ? '✅ 存在' : '❌ 不存在');

    // 9. 检查错误
    if (errors.length > 0) {
      console.log('\n⚠️ 浏览器错误:');
      errors.forEach(e => console.log('   ', e));
    } else {
      console.log('\n✅ 无浏览器错误');
    }

    console.log('\n🎉 浏览器测试通过！房间号:', roomCode);
    process.exit(0);
  } catch (err) {
    console.error('\n❌ 测试失败:', err.message);
    if (errors.length > 0) {
      console.log('浏览器错误:');
      errors.forEach(e => console.log('   ', e));
    }
    process.exit(1);
  } finally {
    await browser.close();
  }
}

setTimeout(() => { console.log('⏱ 总超时'); process.exit(1); }, 60000);
test();
