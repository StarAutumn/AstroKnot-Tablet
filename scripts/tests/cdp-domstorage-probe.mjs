// DOMStorage 权威视图：绕过页面 JS patch，直接读 WebView 存储层
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page' && p.url.startsWith('https://localhost'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const events = [];
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  else if (m.method && m.method.startsWith('DOMStorage')) events.push(m);
};
await new Promise(r => ws.onopen = r);
await send('DOM.enable');
await send('DOMStorage.enable');

const items = await send('DOMStorage.getDOMStorageItems', {
  storageId: { securityOrigin: 'https://localhost', isLocalStorage: true },
});
const rows = (items.entries || []).map(e => e[0]);
console.log('WebView 存储层键列表 (' + rows.length + '):');
rows.forEach(k => console.log('  ' + k));

// 交互：写入标记 → 60 秒后强杀前的观察窗口
const ev2 = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
for (let i = 0; i < 25; i++) { if (await ev2('!!window.appState')) break; await sleep(1000); }
await ev2(`localStorage.setItem('astroknot_guide_done_v1.0.0', 'true')`);
console.log('已写入 guide_done 标记（页面层）');
console.log('等待 65 秒观察 DOMStorage 事件流…');
await sleep(65000);
console.log('期间 DOMStorage 事件数:', events.length);
events.slice(0, 20).forEach(m => console.log('  ' + m.method + ' ' + JSON.stringify(m.params).slice(0, 120)));
ws.close();
setTimeout(() => process.exit(0), 500);
