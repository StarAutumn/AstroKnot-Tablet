// 抓启动期 [tablet-version] 日志：重启 app 并监听 console
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const { execSync } = await import('node:child_process');
execSync('adb shell am force-stop com.astroknot.tablet');
await sleep(1500);
execSync('adb shell am start -n com.astroknot.tablet/.MainActivity');

// 轮询等 WebView 起来并连上（PID 变化 → 每次重取并重新 forward）
let ws = null, page = null;
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  try {
    let pid = '';
    try { pid = execSync('adb shell pidof com.astroknot.tablet').toString().trim().split(/\s+/)[0]; } catch (_) {}
    if (pid) { try { execSync(`adb forward tcp:9222 localabstract:webview_devtools_remote_${pid}`); } catch (_) {} }
    const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
    page = list.find(p => p.type === 'page' && p.url.startsWith('https://localhost'));
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
  } catch (_) { /* 端口未就绪 */ }
}
if (!ws) { console.log('✗ 连不上 WebView'); process.exit(1); }
let id = 0; const pend = new Map(); const logs = [];
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = (m.params.args || []).map(a => a.value != null ? String(a.value) : (a.description || '')).join(' ');
    logs.push('[' + m.params.type + '] ' + text);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    logs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  }
};
await new Promise(r => ws.onopen = r);
await send('Runtime.enable');
// 等应用完全启动（迁移在启动早期执行）
await sleep(12000);
const verLogs = logs.filter(l => l.includes('tablet-version') || l.includes('tablet]') || l.includes('version'));
console.log('=== 启动期相关日志 ===');
verLogs.length ? verLogs.forEach(l => console.log(l)) : console.log('（无 tablet-version 日志）');
console.log('=== 异常 ===');
logs.filter(l => l.startsWith('[exception]')).slice(0, 5).forEach(l => console.log(l));
ws.close();
process.exit(0);
