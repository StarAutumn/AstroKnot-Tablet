// 一次性：查 dock items 存储脏数据
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pend.set(i, { res });
  ws.send(JSON.stringify({ id: i, method, params }));
});
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.res(m.result); }
};
ws.onopen = async () => {
  await send('Runtime.enable');
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  console.log(JSON.stringify({
    dockItems: await ev(`JSON.parse(localStorage.getItem('astroknot_dock_items') || '[]')`),
    positions: await ev(`JSON.parse(localStorage.getItem('astroknot-desktop-icon-positions') || '{}')`)
  }, null, 1));
  process.exit(0);
};
