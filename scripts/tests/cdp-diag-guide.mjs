// 深度诊断：教程标记 写入→落盘→读取 全链路（绕过 localStorage 接管层的盲区）
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

// ── 1) 环境与当前标记状态（Map 为准 + localStorage 双通道对照） ──
const env = await ev2(String.raw`(async () => {
  const g = await import('./modules/Guide/GuideCore.js');
  const ssf = window.SystemStorageFs;
  const fsc = window.FSCore;
  const mapKeys = ssf ? Array.from(ssf.getMap().keys()).filter(function (k) { return /guide/i.test(k); }) : null;
  const mapVals = {};
  (mapKeys || []).forEach(function (k) { mapVals[k] = ssf.getMap().get(k); });
  return {
    appVersion: (window.api && window.api.appVersion) || null,
    dir: fsc ? fsc.dir() : null,
    native: fsc ? fsc.isNative() : null,
    available: fsc ? fsc.available() : null,
    ssfReady: ssf ? ssf.isReady() : null,
    ssfFailed: ssf ? ssf.isFailed() : null,
    ssfKeyCount: ssf ? ssf.getMap().size : null,
    guideKeysInMap: mapKeys,
    guideValsInMap: mapVals,
    lsLength: localStorage.length,
    lsKeyCount: Object.keys(localStorage).length,
    lsGuideKeys: Object.keys(localStorage).filter(function (k) { return /guide/i.test(k); }),
    isGuideCompleted: g.isGuideCompleted(),
  };
})()`);
console.log('环境与当前状态:', JSON.stringify(env, null, 2));

// ── 2) 若教程在弹，点跳过 → 检查写入 + 显式 flush + 直接读磁盘文件 ──
const skip = await ev2(String.raw`(async () => {
  const btn = document.getElementById('guideSkipBtn');
  const overlayVisible = (function () { var o = document.getElementById('guideOverlay'); return o ? getComputedStyle(o).display !== 'none' : false; })();
  if (overlayVisible && btn) { btn.click(); await new Promise(function (r) { setTimeout(r, 1000); }); }
  const g = await import('./modules/Guide/GuideCore.js');
  const ssf = window.SystemStorageFs;
  const mapKeys = Array.from(ssf.getMap().keys()).filter(function (k) { return /guide/i.test(k); });
  await ssf.flush(); // 显式冲刷脏键
  await new Promise(function (r) { setTimeout(r, 500); });
  const out = { overlayWasVisible: overlayVisible, clicked: !!(overlayVisible && btn), completedAfter: g.isGuideCompleted(), mapKeys: mapKeys };
  for (var i = 0; i < mapKeys.length; i++) {
    var k = mapKeys[i];
    var enc = btoa(encodeURIComponent(k)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    try {
      var raw = await window.FSCore.readText('system/storage/' + enc + '.json');
      out['disk:' + k] = raw ? raw.slice(0, 140) : '(empty)';
    } catch (e) { out['disk:' + k] = 'ERR:' + e.message; }
  }
  return out;
})()`);
console.log('跳过后写入/落盘:', JSON.stringify(skip, null, 2));
ws.close();
setTimeout(() => process.exit(0), 300);
