// 验证浏览器右键菜单：起始页 contextmenu 捕获 → 桌面菜单 + 原生长按链接桥
const { execSync } = await import('node:child_process');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log((ok ? '✓ PASS' : '✗ FAIL') + '  ' + name + (detail ? '  — ' + detail : '')); };

const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page' && p.url.startsWith('https://localhost'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const ev2 = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};

await sleep(3000);
for (let i = 0; i < 20; i++) { if (await ev2('!!window.appState')) break; await sleep(1000); }
await sleep(1500);
await ev2(`(() => { const el = document.getElementById('startPage'); if (el) el.style.display = 'none'; return true; })()`);

await ev2(`(async () => {
  await window.AppRunner.open({ id: 'builtin-browser', type: 'browser', defaultUrl: 'https://www.bing.com' });
  await new Promise(r => setTimeout(r, 2500));
  return true;
})()`);

// 1. 起始页内派发 contextmenu（真实链路：捕获层 collect → _emitContextMenu → 桌面菜单）
const menu1 = await ev2(`(async () => {
  const f = document.querySelector('iframe.app-browser-webview');
  const doc = f.contentDocument;
  const tile = doc.querySelectorAll('.tile')[2]; // GitHub 磁贴（链接）
  const r = tile.getBoundingClientRect();
  tile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 10 }));
  await new Promise(r2 => setTimeout(r2, 1500));
  const menu = document.querySelector('.app-browser-context-menu');
  const labels = menu ? [...menu.querySelectorAll('.dock-context-item')].map(b => b.textContent) : [];
  return { hasMenu: !!menu, hasNewTab: labels.some(l => l.includes('在新标签打开')), hasCopyLink: labels.some(l => l.includes('复制链接')), hasClip: labels.some(l => l.includes('Web 项目')), items: labels.length };
})()`);
check('起始页右键 → 桌面菜单弹出', menu1.hasMenu === true, JSON.stringify(menu1));
check('链接磁贴菜单含「在新标签打开/复制链接/转节点」', menu1.hasNewTab && menu1.hasCopyLink && menu1.hasClip, '');

// 2. 点「在新标签打开」→ 新标签创建 + URL 同步
const openNew = await ev2(`(async () => {
  const before = document.querySelectorAll('.app-browser-tab').length;
  const btn = [...document.querySelectorAll('.app-browser-context-menu .dock-context-item')].find(b => b.textContent.includes('在新标签打开'));
  btn.click();
  await new Promise(r => setTimeout(r, 2000));
  const tabs = document.querySelectorAll('.app-browser-tab').length;
  const addr = document.querySelector('.app-browser-url-input');
  return { before, tabs, addr: addr ? addr.value : '' };
})()`);
check('「在新标签打开」创建新标签并加载', openNew.tabs === openNew.before + 1 && /github\.com/.test(openNew.addr), JSON.stringify(openNew));

// 3. 原生长按链接桥（模拟 MainActivity 回调）
const menu3 = await ev2(`(async () => {
  // 关掉可能存在的旧菜单
  document.querySelectorAll('.app-browser-context-menu, .app-browser-ctx-overlay').forEach(el => el.remove());
  await new Promise(r => setTimeout(r, 300));
  window.__tabletLongPressLink('https://example.com/page-x');
  await new Promise(r => setTimeout(r, 1500));
  const menu = document.querySelector('.app-browser-context-menu');
  const labels = menu ? [...menu.querySelectorAll('.dock-context-item')].map(b => b.textContent) : [];
  return { hasMenu: !!menu, hasNewTab: labels.some(l => l.includes('在新标签打开')) };
})()`);
check('原生长按桥 → 菜单弹出（跨域链接入口）', menu3.hasMenu && menu3.hasNewTab, JSON.stringify(menu3));

// 4. 点菜单空白外关闭
const closed = await ev2(`(async () => {
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await new Promise(r => setTimeout(r, 500));
  return !document.querySelector('.app-browser-context-menu');
})()`);
check('点外部关闭菜单', closed === true);

// 5. 截图：重新弹一次菜单存证
await ev2(`(() => {
  const f = document.querySelector('iframe.app-browser-webview');
  const doc = f.contentDocument;
  const tile = doc.querySelectorAll('.tile')[2];
  const r = tile.getBoundingClientRect();
  tile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 10 }));
  return true;
})()`);
await sleep(1200);
execSync('adb shell screencap -p /sdcard/ctx_menu.png');
execSync('adb pull /sdcard/ctx_menu.png scripts/ctx_menu.png 2>&1', { stdio: 'ignore' });
console.log('截图: scripts/ctx_menu.png');

const pass = results.filter(Boolean).length;
console.log(`\n=== ${pass}/${results.length} 通过 ===`);
process.exit(pass === results.length ? 0 : 1);
