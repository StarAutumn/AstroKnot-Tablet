// 测量 WebView 启动资源加载耗时 top（CDP Performance API）
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
};
ws.onopen = async () => {
  try {
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      return r.result?.value;
    };
    const res = await evalJs(`
      (function(){
        const rs = performance.getEntriesByType('resource');
        const total = rs.reduce((s,e)=>s+(e.responseEnd||0),0);
        const last = rs.length ? Math.max(...rs.map(e=>e.responseEnd)) : 0;
        const top = [...rs].sort((a,b)=>(b.responseEnd-b.responseStart)-(a.responseEnd-a.responseStart)).slice(0,15)
          .map(e=>({f: e.name.replace('https://localhost/',''), dl: Math.round(e.responseEnd-e.responseStart), size: e.transferSize||e.encodedBodySize}));
        const slowByStart = [...rs].sort((a,b)=>b.responseStart-a.responseStart).slice(0,8)
          .map(e=>({f: e.name.replace('https://localhost/',''), wait: Math.round(e.responseStart)}));
        return JSON.stringify({
          count: rs.length,
          lastResourceAt: Math.round(last)+'ms',
          sumDurations: Math.round(total)+'ms',
          longestDownloads: top,
          latestStarts: slowByStart
        }, null, 1);
      })()
    `);
    console.log(res);
    console.log('--- 导航耗时 ---');
    console.log(await evalJs(`
      JSON.stringify(performance.getEntriesByType('navigation').map(e=>({
        domContentLoaded: Math.round(e.domContentLoadedEventEnd), load: Math.round(e.loadEventEnd||0)
      })))
    `));
  } catch (e) {
    console.error('诊断出错:', e.message);
  } finally {
    ws.close();
    setTimeout(() => process.exit(0), 300);
  }
};
ws.onerror = (e) => { console.error('WS错误', e.message || e); process.exit(1); };
