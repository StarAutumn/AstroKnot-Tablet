// 截图验证窗口化浏览器 iframe 真实渲染（跨域 iframe 无法经 CDP 读内容）
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

await sleep(2000);
// 先关启动首页（盖在最上层）
await ev2(`(() => { const el = document.getElementById('startPage'); if (el) el.style.display = 'none'; return true; })()`);
await sleep(500);
// 打开浏览器窗口（若未开）
const opened = await ev2(`(async () => {
  if (document.querySelector('iframe.app-browser-webview')) return 'already';
  await window.AppRunner.open({ id: 'builtin-browser', type: 'browser', defaultUrl: 'https://example.com' });
  await new Promise(r => setTimeout(r, 3500));
  return 'opened';
})()`);
console.log('浏览器窗口:', opened);
await sleep(2000);
execSync('adb shell screencap -p /sdcard/browser_win.png');
execSync('adb pull /sdcard/browser_win.png scripts/browser_win.png 2>&1', { stdio: 'ignore' });
console.log('截图已保存 scripts/browser_win.png');
process.exit(0);
