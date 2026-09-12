// 清 localhost origin 的 DOM Storage → 重启后写 guide 标记验证持久化
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page' && p.url.startsWith('https://localhost'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);

await send('Storage.clearDataForOrigin', { origin: 'https://localhost', storageTypes: 'local_storage' });
console.log('已清除 https://localhost 的 local_storage');
ws.close();
setTimeout(() => process.exit(0), 500);
