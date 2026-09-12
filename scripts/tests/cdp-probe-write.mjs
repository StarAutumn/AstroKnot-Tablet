// 探针实验：写一个探针键走完整链路（set→flush→readText 验证），供 adb 侧核对真盘
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
for (let i = 0; i < 30; i++) { if (await ev2('!!window.appState')) break; await sleep(1000); }

const r = await ev2(String.raw`(async () => {
  const ssf = window.SystemStorageFs;
  const fsc = window.FSCore;
  ssf.set('astroknot_diag_probe2', 'alive-' + Date.now());
  await ssf.flush();
  await new Promise(function (r) { setTimeout(r, 500); });
  var enc = btoa('astroknot_diag_probe2');
  var readback = null, err = null;
  try { readback = await fsc.readText('system/storage/' + enc + '.json'); } catch (e) { err = e.message; }
  // 同时再用 Capacitor 原语直接写一个裸探针文件
  var bareErr = null;
  try {
    await window.Capacitor.Plugins.Filesystem.writeFile({
      path: 'AstroKnot-Data/system/storage/QnBhcmVQcm9iZQ.json',
      directory: 'DOCUMENTS', data: '{"bare":1}', encoding: 'utf8', recursive: true
    });
  } catch (e) { bareErr = e.message; }
  return {
    dir: fsc.dir(), native: fsc.isNative(), ready: fsc.isReady(),
    readback: readback, readErr: err, bareWriteErr: bareErr,
  };
})()`);
console.log('探针结果:', JSON.stringify(r, null, 2));
ws.close();
setTimeout(() => process.exit(0), 300);
