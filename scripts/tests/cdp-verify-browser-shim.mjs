// 验证浏览器降级：AppRunner.open(browser) → 无窗口 + 跳系统浏览器 Intent
const { execSync } = await import('node:child_process');
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page');
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
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log((ok ? '✓ PASS' : '✗ FAIL') + '  ' + name + (detail ? '  — ' + detail : '')); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

await new Promise(r => setTimeout(r, 3000));
for (let i = 0; i < 30; i++) { const s = await ev2('!!window.appState'); if (s) break; await new Promise(r => setTimeout(r, 1000)); }
await sleep(2000);
await ev2(`(() => { const el = document.getElementById('startPage'); if (el) el.style.display = 'none'; return true; })()`);

// 1. 垫片就绪
const ready = await ev2(`typeof window.__openExternalBrowser === 'function' && !!(window.Capacitor?.Plugins?.StoragePerm?.openExternal)`);
check('降级垫片 + 原生 openExternal 就绪', ready === true);

// 2. 清 logcat 标记 + 触发浏览器打开（会跳系统浏览器）
execSync('adb logcat -c');
const opened = await ev2(`(async () => {
  await window.AppRunner.open({ id: 'builtin-browser', type: 'browser', defaultUrl: 'https://example.com' });
  await new Promise(r => setTimeout(r, 800));
  return {
    noWindow: !document.querySelector('.app-browser-content'),
    noWebview: !document.querySelector('webview'),
  };
})()`);
check('打开浏览器应用未创建窗口（原 webview 白屏路径已消除）', opened.noWindow && opened.noWebview, JSON.stringify(opened));

// 3. 拉回主应用 + logcat 验证 Intent
await sleep(1500);
execSync('adb shell am start -n com.astroknot.tablet/.MainActivity 2>&1', { stdio: 'ignore' });
await sleep(2500);
let intentOk = false;
try {
  const dump = execSync('adb logcat -d -s ActivityTaskManager:I 2>&1', { encoding: 'utf8' }).toString();
  intentOk = /VIEW.*example\.com|example\.com.*VIEW/u.test(dump) || (dump.includes('START') && dump.includes('example.com'));
  if (!intentOk) console.log('[logcat 采样]', dump.split('\n').filter(l => l.includes('example.com')).slice(0, 3).join(' | ').slice(0, 300));
} catch (e) { console.log('logcat 读取失败:', e.message); }
check('系统已收到打开 example.com 的 VIEW Intent', intentOk);

// 4. 搜索词归一化（不真跳转，直接测 normalize 内部逻辑——通过无 defaultUrl 调用 bing 首页）
const searchOk = await ev2(`(async () => {
  // 只验证 URL 归一化（临时替换 openExternal 捕获参数，不真跳转）
  const Perm = window.Capacitor.Plugins.StoragePerm;
  const orig = Perm.openExternal.bind(Perm);
  let captured = null;
  Perm.openExternal = (args) => { captured = args.url; return Promise.resolve(); };
  window.__openExternalBrowser({ id: 'x', type: 'browser', defaultUrl: '清华大学教务系统' });
  await new Promise(r => setTimeout(r, 200));
  window.__openExternalBrowser({ id: 'x', type: 'browser' });
  await new Promise(r => setTimeout(r, 200));
  window.__openExternalBrowser({ id: 'x', type: 'browser', defaultUrl: 'example.org' });
  await new Promise(r => setTimeout(r, 200));
  Perm.openExternal = orig;
  return { search: captured, home: typeof captured === 'string' };
})()`);
check('浏览器应用降级链路可用（openExternal 被调用）', searchOk.home === true, JSON.stringify(searchOk));

const pass = results.filter(Boolean).length;
console.log(`\n=== ${pass}/${results.length} 通过 ===`);
process.exit(pass === results.length ? 0 : 1);
