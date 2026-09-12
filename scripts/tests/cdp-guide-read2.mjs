// 读阶段2：对照实验读回
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
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
for (let i = 0; i < 20; i++) { if (await ev2('!!window.appState')) break; await sleep(1000); }
await sleep(3000);

const r = await ev2(`({
  native: localStorage.getItem('__native_test__'),
  appkey: localStorage.getItem('astroknot_test_key'),
  syskey: localStorage.getItem('astroknot_test_sys'),
  guide: localStorage.getItem('astroknot_guide_completed_v1.0.0'),
  sysKeys: (window.SystemStorage.keys ? window.SystemStorage.keys() : []).filter(function (k) { return /test|guide/.test(k); }),
})`);
console.log('重启后:', JSON.stringify(r));
ws.close();
setTimeout(() => process.exit(0), 500);
