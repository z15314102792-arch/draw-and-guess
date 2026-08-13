/**
 * 你画我猜 · 验收脚本
 * 用法: node verify.js
 * 输出: verify-results.json
 */
const fs = require('fs');

const PROJECT = { name: '你画我猜', version: null };
const results = { project: PROJECT.name, version: PROJECT.version, timestamp: new Date().toISOString(), checks: [], summary: { total: 0, passed: 0, failed: 0 } };
function addCheck(name, pass, data = {}) { results.checks.push({ name, pass, data }); results.summary.total++; if (pass) results.summary.passed++; else results.summary.failed++; }
function fail(msg) { console.error('[verify] ' + msg); fs.writeFileSync('verify-results.json', JSON.stringify(results, null, 2)); process.exit(1); }

// ====== 1. 核心文件存在 ======
console.log('[verify] 检查核心文件...');
const files = ['server.js', 'solo-v3.js', 'package.json'];
let allExist = true;
const fileInfo = {};
for (const f of files) {
  const exists = fs.existsSync(f);
  if (!exists) allExist = false;
  try { fileInfo[f] = exists ? fs.statSync(f).size : 0; } catch (e) { fileInfo[f] = 0; }
}
addCheck('核心文件存在', allExist, fileInfo);

// 提取版本
try {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
  PROJECT.version = pkg.version || 'unknown';
} catch (e) { PROJECT.version = 'unknown'; }
results.version = PROJECT.version;

// ====== 2. server.js 语法检查 ======
console.log('[verify] server.js 语法检查...');
try {
  const serverCode = fs.readFileSync('server.js', 'utf-8');
  new Function(serverCode);
  addCheck('server.js 语法正确', true, { size: serverCode.length, lines: serverCode.split('\n').length });
} catch (e) {
  addCheck('server.js 语法正确', false, { line: e.lineNumber, message: e.message });
}

// ====== 3. solo-v3.js 语法检查 ======
console.log('[verify] solo-v3.js 语法检查...');
try {
  const soloCode = fs.readFileSync('solo-v3.js', 'utf-8');
  new Function(soloCode);
  addCheck('solo-v3.js 语法正确', true, { size: soloCode.length, lines: soloCode.split('\n').length });
} catch (e) {
  addCheck('solo-v3.js 语法正确', false, { line: e.lineNumber, message: e.message });
}

// ====== 4. package.json 有效性 ======
console.log('[verify] package.json 有效性...');
try {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
  const hasName = !!pkg.name;
  const hasScripts = !!pkg.scripts;
  const hasDeps = !!(pkg.dependencies || pkg.devDependencies);
  addCheck('package.json 有效', hasName && hasScripts, {
    name: pkg.name, version: pkg.version,
    has_scripts: hasScripts, has_dependencies: hasDeps,
    scripts: Object.keys(pkg.scripts || {})
  });
} catch (e) {
  addCheck('package.json 有效', false, { error: e.message });
}

// ====== 5. 服务端关键路由检查 ======
console.log('[verify] 检查服务端路由...');
try {
  const serverCode = fs.readFileSync('server.js', 'utf-8');
  const routes = [];
  if (serverCode.includes('express') || serverCode.includes('createServer')) routes.push('HTTP服务');
  if (serverCode.includes('socket') || serverCode.includes('ws') || serverCode.includes('WebSocket')) routes.push('WebSocket');
  if (serverCode.includes('/draw') || serverCode.includes('draw')) routes.push('绘画路由');
  if (serverCode.includes('/guess') || serverCode.includes('guess')) routes.push('猜词路由');
  if (serverCode.includes('room') || serverCode.includes('Room')) routes.push('房间管理');
  addCheck('服务端路由结构', routes.length >= 2, { found_routes: routes });
} catch (e) {
  addCheck('服务端路由结构', false, { error: e.message });
}

// ====== 写入结果 ======
fs.writeFileSync('verify-results.json', JSON.stringify(results, null, 2));
console.log('[verify] ' + results.summary.passed + '/' + results.summary.total + ' 通过');
process.exit(results.summary.failed > 0 ? 1 : 0);
