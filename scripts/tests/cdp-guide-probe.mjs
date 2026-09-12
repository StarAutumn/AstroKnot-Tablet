// browser 级注入探针（force-stop 后新 WebView 会话也生效）记录 guide/first_run 键操作
const list = await fetch('http://127.0.0.1:9222/json/version').then(r => r.json());
const ws = new WebSocket(list.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);

const src = `
(function () {
  window.__guideLog = [];
  var OP = Storage.prototype;
  var si = OP.setItem, ri = OP.removeItem, gi = OP.getItem;
  function rec(op, k, v) {
    if (/guide_done|guide_step2|guide_completed|guide_current_step|first_run/i.test(String(k))) {
      var st = new Error().stack.split('\\n').slice(2, 8).join(' | ');
      window.__guideLog.push(op + ' ' + k + ' = ' + String(v) + ' @' + Date.now() + ' ' + st);
    }
  }
  OP.setItem = function (k, v) { rec('SET', k, v); return si.call(this, k, v); };
  OP.removeItem = function (k) { rec('DEL', k, undefined); return ri.call(this, k); };
  OP.getItem = function (k) { var r = gi.call(this, k); if (/guide_done|guide_completed|first_run/i.test(String(k))) rec('GET', k, JSON.stringify(r)); return r; };
})();
`;
const r = await send('Target.addScriptToEvaluateOnNewDocument', { source: src });
console.log('browser 级探针已注入:', JSON.stringify(r));
ws.close();
setTimeout(() => process.exit(0), 500);
