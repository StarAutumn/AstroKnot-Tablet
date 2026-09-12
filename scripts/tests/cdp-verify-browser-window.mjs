// 验证窗口化浏览器：BrowserApp 窗口出现（桌面布局）+ iframe 加载 + 标签 + 原生打开按钮
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

// 垫片就绪
const shim = await ev2(`typeof window.__createWebViewShim === 'function'`);
check('webview→iframe 适配器已加载', shim === true);

// 打开浏览器应用（走桌面 AppRunner._openBrowserApp 窗口化路径）
const win = await ev2(`(async () => {
  await window.AppRunner.open({ id: 'builtin-browser', type: 'browser', defaultUrl: 'https://example.com' });
  await new Promise(r => setTimeout(r, 2500));
  const w = document.querySelector('.app-browser-window') || document.querySelector('.app-runner-window .app-browser-content')?.closest('.app-runner-window');
  const content = document.querySelector('.app-browser-content');
  const iframe = document.querySelector('iframe.app-browser-webview');
  const tabs = document.querySelectorAll('.app-browser-tab').length;
  const addr = document.querySelector('.app-browser-url-input');
  const nativeBtn = [...document.querySelectorAll('button')].find(b => b.textContent === '原生' && b.title.includes('原生'));
  return {
    hasWindow: !!content,
    iframeOk: !!iframe,
    tabs,
    addrVal: addr ? addr.value : '',
    nativeBtn: !!nativeBtn,
    winCls: w ? w.className.slice(0, 60) : '',
  };
})()`);
check('浏览器窗口出现（桌面窗口化布局）', win.hasWindow === true, JSON.stringify(win).slice(0, 160));
check('webview 已被 iframe 适配器顶替', win.iframeOk === true);
check('标签栏存在', win.tabs >= 1, 'tabs=' + win.tabs);
check('地址栏同步 URL', /example\.com/.test(win.addrVal), win.addrVal);
check('「原生打开」兜底按钮已注入', win.nativeBtn === true);

// iframe 真实加载（同源页面直接读 contentDocument.title；WebView 内嵌 iframe 不是独立 devtools target）
const docTitle = await ev2(`(() => {
  const f = document.querySelector('iframe.app-browser-webview');
  try { return { ok: !!(f && f.contentDocument && f.contentDocument.body && f.contentDocument.body.textContent.length > 0), title: f.contentDocument.title, text: (f.contentDocument.body.textContent || '').slice(0, 60) }; }
  catch (e) { return { ok: false, err: String(e).slice(0, 60) }; }
})()`);
check('iframe 实际加载 example.com（contentDocument 可读）', docTitle.ok === true && /example/i.test(docTitle.title || ''), JSON.stringify(docTitle));

// 标签标题同步（跨域 → 域名兜底）
const title = await ev2(`(document.querySelector('.app-browser-tab-title') || {}).textContent || ''`);
check('标签标题同步（域名兜底）', /example/i.test(title), title);

// 新建标签 + 导航
const tab2 = await ev2(`(async () => {
  const btn = document.querySelector('.app-browser-tab-new');
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 800));
  const tabs = document.querySelectorAll('.app-browser-tab').length;
  return { tabs };
})()`);
check('新建标签按钮工作', tab2.tabs >= 2, 'tabs=' + tab2.tabs);

// 收尾：关闭浏览器窗口（回归桌面无影响——关闭窗口）
await ev2(`(() => {
  const w = document.querySelector('.app-browser-window') || document.querySelector('.app-runner-window');
  const closeBtn = w && (w.querySelector('.window-close, .app-window-close, [class*="close"]'));
  if (closeBtn) closeBtn.click();
  return true;
})()`);

const pass = results.filter(Boolean).length;
console.log(`\n=== ${pass}/${results.length} 通过 ===`);
process.exit(pass === results.length ? 0 : 1);
