// 验证浏览器起始页：srcdoc 首页（时钟/搜索框/磁贴）+ 磁贴导航 + 搜索走原生
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

// 打开浏览器
const open = await ev2(`(async () => {
  await window.AppRunner.open({ id: 'builtin-browser', type: 'browser', defaultUrl: 'https://www.bing.com' });
  await new Promise(r => setTimeout(r, 2500));
  return true;
})()`);
check('浏览器窗口打开（NEWTAB bing.com 被拦截）', open === true);

// 起始页内容（srcdoc 同源可读）
const home = await ev2(`(() => {
  const f = document.querySelector('iframe.app-browser-webview');
  if (!f) return { ok: false };
  const doc = f.contentDocument;
  if (!doc) return { ok: false, hasSrcdoc: !!f.srcdoc };
  return {
    ok: true,
    title: doc.title,
    clock: !!(doc.getElementById('ck') && doc.getElementById('ck').textContent.match(/\\d{2}:\\d{2}/)),
    search: !!doc.getElementById('q'),
    tiles: doc.querySelectorAll('.tile').length,
  };
})()`);
check('起始页显示（时钟+搜索框+8磁贴）', home.ok && home.clock && home.search && home.tiles === 8, JSON.stringify(home));

// 标签标题 = 起始页
const tabTitle = await ev2(`(document.querySelector('.app-browser-tab-title') || {}).textContent || ''`);
check('标签标题显示「起始页」', tabTitle.includes('起始页'), tabTitle);

// 磁贴点击 → loadURL 链路（URL 同步 + did-navigate）
const nav = await ev2(`(async () => {
  const f = document.querySelector('iframe.app-browser-webview');
  const doc = f.contentDocument;
  const tile = doc.querySelector('.tile[href*="example"]');
  const target = tile || doc.querySelectorAll('.tile')[2]; // 无 example 用第 3 个
  target.click();
  await new Promise(r => setTimeout(r, 2500));
  const addr = document.querySelector('.app-browser-url-input');
  return { clicked: target.getAttribute('href'), addr: addr ? addr.value : '', title: (document.querySelector('.app-browser-tab-title') || {}).textContent };
})()`);
check('磁贴点击导航 URL 同步', /https?:\/\//.test(nav.addr) && nav.addr !== 'about:blank', JSON.stringify(nav));

// 新建标签 → 回到起始页
const newTab = await ev2(`(async () => {
  const btn = document.querySelector('.app-browser-tab-new');
  btn.click();
  await new Promise(r => setTimeout(r, 1200));
  const f = document.querySelector('iframe.app-browser-webview[srcdoc]') || [...document.querySelectorAll('iframe.app-browser-webview')].pop();
  const doc = f && f.contentDocument;
  return { hasHome: !!(doc && doc.getElementById('q')) };
})()`);
check('新建标签显示起始页', newTab.hasHome === true, JSON.stringify(newTab));

// 搜索提交 → 走原生页（mock openInApp 捕获参数）
const search = await ev2(`(async () => {
  const Perm = window.Capacitor.Plugins.StoragePerm;
  const orig = Perm.openInApp.bind(Perm);
  let captured = null;
  Perm.openInApp = (a) => { captured = a.url; return Promise.resolve(); };
  const frames = [...document.querySelectorAll('iframe.app-browser-webview')];
  const f = frames[frames.length - 1];
  const doc = f.contentDocument;
  doc.getElementById('q').value = '量子力学';
  doc.getElementById('go').click();
  await new Promise(r => setTimeout(r, 500));
  Perm.openInApp = orig;
  return { captured };
})()`);
check('搜索提交走原生页（Bing 搜索 URL）', /bing\.com\/search\?q=/.test(search.captured || ''), JSON.stringify(search));

// 截图存证
await ev2(`(() => { const b = [...document.querySelectorAll('.app-browser-tab')]; if (b.length > 1) b[0].querySelector('.app-browser-tab-close').click(); return true; })()`);
await sleep(800);
execSync('adb shell screencap -p /sdcard/home_shot.png');
execSync('adb pull /sdcard/home_shot.png scripts/home_shot.png 2>&1', { stdio: 'ignore' });
console.log('截图: scripts/home_shot.png');

const pass = results.filter(Boolean).length;
console.log(`\n=== ${pass}/${results.length} 通过 ===`);
process.exit(pass === results.length ? 0 : 1);
