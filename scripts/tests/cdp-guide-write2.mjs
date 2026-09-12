// 对照实验：非 app key（原生直通）vs app key（SystemStorage 路径）各写一个
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

const r = await ev2(`(function () {
  // 1) 非 app key：patch 直通原生 setItem
  localStorage.setItem('__native_test__', 'N1');
  // 2) app key：走 SystemStorage.setItem（同样最终调原生，但路径不同）
  localStorage.setItem('astroknot_test_key', 'A1');
  // 3) 用 SystemStorage 原始导出再写一次（绕过 Storage.prototype patch）
  var viaSys = null;
  try { window.SystemStorage.setItem('astroknot_test_sys', 'S1'); viaSys = 'ok'; } catch (e) { viaSys = 'ERR:' + e.message; }
  return {
    native: localStorage.getItem('__native_test__'),
    appkey: localStorage.getItem('astroknot_test_key'),
    syskey: localStorage.getItem('astroknot_test_sys'),
    viaSys: viaSys,
    sysKeysLen: (window.SystemStorage.keys ? window.SystemStorage.keys() : []).filter(function (k) { return /test|guide/.test(k); }),
  };
})()`);
console.log('写入后:', JSON.stringify(r));
console.log('等待 15 秒落盘…');
await sleep(15000);
ws.close();
setTimeout(() => process.exit(0), 500);
