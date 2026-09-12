// 时序取证 v2：注入 pre-script → reload → 记录预载完成时刻 vs guide 键首次读取时刻
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page' && p.url.startsWith('https://localhost'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
await send('Page.enable');

const TRAP = `(function(){
  window.__trapLog = [];
  var t0 = performance.now();
  function log(ev, extra){ window.__trapLog.push(Object.assign({ t: Math.round(performance.now() - t0), ev: ev }, extra || {})); }
  log('inject');
  var olog = console.log.bind(console);
  console.log = function(){ try { var s = String(arguments[0]); if (/预载完成|存储根就绪|文件化存储就绪|垫片已加载|启动编排|迁移/.test(s)) log('console', { msg: s }); } catch(e){} return olog.apply(null, arguments); };
  var proto = Storage.prototype;
  var oSet = proto.setItem, oRem = proto.removeItem;
  proto.setItem = function(k, v){ if (/guide/i.test(String(k))) log('proto.setItem', { k: String(k), v: String(v).slice(0, 10), stack: String(new Error().stack).split('\\n').slice(1, 4).join(' | ') }); return oSet.call(this, k, v); };
  proto.removeItem = function(k){ if (/guide/i.test(String(k))) log('proto.removeItem', { k: String(k), stack: String(new Error().stack).split('\\n').slice(1, 4).join(' | ') }); return oRem.call(this, k); };
  var iv = setInterval(function(){
    try {
      if (window.api && !window.api.__trapped2 && window.api.systemStorageReadSync) {
        window.api.__trapped2 = true;
        ['systemStorageReadSync', 'systemStorageWriteSync', 'systemStorageRemoveSync'].forEach(function (name) {
          var orig = window.api[name];
          window.api[name] = function (k) {
            if (/guide/i.test(String(k))) {
              log('api.' + name, { k: String(k), stack: String(new Error().stack).split('\\n').slice(1, 5).join(' | ') });
            }
            return orig.apply(this, arguments);
          };
        });
        clearInterval(iv);
      }
    } catch (e) {}
  }, 3);
})();`;

await send('Page.addScriptToEvaluateOnNewDocument', { source: TRAP });
console.log('陷阱v2已注入');
await send('Page.reload');
await sleep(15000);

const r = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    trap: (window.__trapLog || []).slice(0, 40),
    mapGuide: window.SystemStorageFs ? Array.from(window.SystemStorageFs.getMap().keys()).filter(function(k){return /guide/i.test(k);}) : null,
    mapVals: (window.SystemStorageFs && window.SystemStorageFs.getMap().get('astroknot_guide_done_v1.0.0')) || null,
    overlay: (function(){ var o = document.getElementById('guideOverlay'); return o ? getComputedStyle(o).display !== 'none' : false; })(),
  })`,
  returnByValue: true,
});
console.log('时序记录:', JSON.stringify(JSON.parse(r.result.value), null, 2));
ws.close();
setTimeout(() => process.exit(0), 300);
