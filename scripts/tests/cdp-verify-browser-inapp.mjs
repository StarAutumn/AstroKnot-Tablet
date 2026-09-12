// 验证应用内浏览器：AppRunner.open(browser) → 原生 BrowserActivity 启动并加载页面
const { execSync } = await import('node:child_process');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page' && p.url.startsWith('https://localhost'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const ev2 = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log((ok ? '✓ PASS' : '✗ FAIL') + '  ' + name + (detail ? '  — ' + detail : '')); };

await sleep(3000);
for (let i = 0; i < 20; i++) { if (await ev2('!!window.appState')) break; await sleep(1000); }
await sleep(1500);
await ev2(`(() => { const el = document.getElementById('startPage'); if (el) el.style.display = 'none'; return true; })()`);

// 触发内置浏览器（原生 Activity 启动，会切走但主 WebView 进程不死）
execSync('adb logcat -c');
await ev2(`window.AppRunner.open({ id: 'builtin-browser', type: 'browser', defaultUrl: 'https://example.com' })`);
await sleep(5000);

// 1. BrowserActivity 在前台（dumpsys 不打印 Intent extras，只验组件名）
let topOk = false;
try {
  const act = execSync('adb shell dumpsys activity activities 2>&1', { encoding: 'utf8' }).toString();
  topOk = act.includes('BrowserActivity');
} catch (e) { }
check('BrowserActivity 启动', topOk);

// 2. 原生 WebView 的 devtools 页出现（证明页面真正加载了，轮询最多 10s）
let webViewUrl = '';
for (let t = 0; t < 10; t++) {
  try {
    const l2 = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
    const wv = l2.find(p => p.type === 'page' && /example\.com/.test(p.url));
    if (wv) { webViewUrl = wv.url; break; }
  } catch (e) { }
  await sleep(1000);
}
check('原生 WebView 已加载 example.com（devtools 可见）', /example\.com/.test(webViewUrl), webViewUrl);

// 3. 返回键回主应用
execSync('adb shell input keyevent KEYCODE_BACK');
await sleep(4000);
let backOk = false;
try {
  const act = execSync('adb shell dumpsys activity activities 2>&1', { encoding: 'utf8' }).toString();
  // 新旧 Android 字段名不同：mResumedActivity / topResumedActivity / mFocusedActivity
  const line = (act.match(/(?:mResumedActivity|topResumedActivity|mFocusedActivity)[^\n]*/) || [''])[0];
  backOk = line.includes('MainActivity') && !act.includes('BrowserActivity') ? true : line.includes('MainActivity');
  console.log('  返回后前台:', line.trim().slice(0, 140));
} catch (e) { }
check('返回键回到主应用', backOk);

const pass = results.filter(Boolean).length;
console.log(`\n=== ${pass}/${results.length} 通过 ===`);
process.exit(pass === results.length ? 0 : 1);
