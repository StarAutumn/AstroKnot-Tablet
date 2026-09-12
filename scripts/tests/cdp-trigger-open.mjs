// 一次性：触发打开位置并留出时间检查前台
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.res(m.result); }
};
ws.onopen = async () => {
  const r = await send('Runtime.evaluate', {
    expression: `window.api.showFileInFolder('projects')`,
    returnByValue: true, awaitPromise: true,
  });
  console.log('result:', JSON.stringify(r.result?.value));
  ws.close(); setTimeout(() => process.exit(0), 200);
};
