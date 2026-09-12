// 启动时序陷阱：注入 pre-script → reload 复现启动 → 抓 guide 键删除调用栈
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page' && p.url.startsWith('https://localhost'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') {
    const txt = (m.params.args || []).map(a => a.value != null ? a.value : a.description).join(' ');
    if (/TRAP|guide|Guide|ss-fs|fs-boot/.test(txt)) console.log('[console]', txt.slice(0, 300));
  }
};
await new Promise(r => ws.onopen = r);
await send('Runtime.enable');
await send('Page.enable');

const TRAP = `(function(){
  window.__trapLog = [];
  function log(o){ window.__trapLog.push(o); try{console.warn('TRAP ' + JSON.stringify(o));}catch(e){} }
  var proto = Storage.prototype;
  var oGet = proto.getItem, oSet = proto.setItem, oRem = proto.removeItem;
  proto.getItem = function(k){ var r = oGet.call(this,k); if (/guide/i.test(String(k))) log({t:Date.now(), ev:'getItem', k:String(k), r:String(r).slice(0,12)}); return r; };
  proto.setItem = function(k,v){ if (/guide/i.test(String(k))) log({t:Date.now(), ev:'setItem', k:String(k), v:String(v).slice(0,12), stack:String(new Error().stack).split('\\n').slice(1,5).join(' | ')}); return oSet.call(this,k,v); };
  proto.removeItem = function(k){ if (/guide/i.test(String(k))) log({t:Date.now(), ev:'proto.removeItem', k:String(k), stack:String(new Error().stack).split('\\n').slice(1,6).join(' | ')}); return oRem.call(this,k); };
  var iv = setInterval(function(){
    try {
      if (window.api && window.api.systemStorageRemoveSync && !window.api.__trapped) {
        window.api.__trapped = true;
        var orig = window.api.systemStorageRemoveSync;
        window.api.systemStorageRemoveSync = function(k){
          if (/guide/i.test(String(k))) log({t:Date.now(), ev:'api.removeSync', k:String(k), stack:String(new Error().stack).split('\\n').slice(1,7).join(' | ')});
          return orig.call(this, k);
        };
      }
      if (window.FSCore && window.FSCore.remove && !window.FSCore.__trapped) {
        window.FSCore.__trapped = true;
        var orem = window.FSCore.remove;
        window.FSCore.remove = function(p){
          if (/d1aWRl/.test(String(p))) log({t:Date.now(), ev:'fsc.remove', p:String(p), stack:String(new Error().stack).split('\\n').slice(1,7).join(' | ')});
          return orem.apply(this, arguments);
        };
      }
      if (window.api && window.api.__trapped && window.FSCore && window.FSCore.__trapped) clearInterval(iv);
    } catch(e){}
  }, 5);
})();`;

const { scriptId } = await send('Page.addScriptToEvaluateOnNewDocument', { source: TRAP });
console.log('陷阱已注入, scriptId =', scriptId);

await send('Page.reload');
await sleep(15000); // 覆盖整个启动+教程判定时序

const r = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    trap: (window.__trapLog || []),
    mapGuide: window.SystemStorageFs ? Array.from(window.SystemStorageFs.getMap().keys()).filter(function(k){return /guide/i.test(k);}) : null,
    mapCount: window.SystemStorageFs ? window.SystemStorageFs.getMap().size : -1,
    overlay: (function(){ var o = document.getElementById('guideOverlay'); return o ? getComputedStyle(o).display !== 'none' : false; })(),
    latchReleased: !!window.__latchReleased,
  })`,
  returnByValue: true,
});
console.log('RELOAD后状态:', JSON.stringify(JSON.parse(r.result.value), null, 2));
ws.close();
setTimeout(() => process.exit(0), 300);
