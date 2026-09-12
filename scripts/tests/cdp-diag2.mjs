// 检查 WebView 屏幕中心最上层元素 + 启动遮罩类元素状态
import process from 'node:process';

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
      return r.result?.value ?? r.result?.description ?? JSON.stringify(r);
    };
    console.log('--- 屏幕中心最上层元素链 ---');
    console.log(await evalJs(`
      document.elementsFromPoint(innerWidth/2, innerHeight/2).map(e =>
        e.tagName + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').join('.') : '')
      ).join('  <-  ')
    `));
    console.log('--- 常见启动遮罩元素 ---');
    console.log(await evalJs(`
      JSON.stringify(['startPage','StartPage','app-loading','loading','boot','splash','welcome']
        .map(sel => ({ sel, hits: document.querySelectorAll('[id*="'+sel+'"], [class*="'+sel+'"]').length }))
    `));
    console.log('--- 可见且覆盖全屏的元素 ---');
    console.log(await evalJs(`
      JSON.stringify([...document.body.children].map(e => {
        const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
        return { el: e.tagName + (e.id ? '#'+e.id : '') + (typeof e.className==='string' && e.className ? '.'+e.className.split(' ')[0] : ''),
          w: r.width|0, h: r.height|0, display: s.display, zIndex: s.zIndex, opacity: s.opacity };
      }).filter(x => x.display !== 'none' && x.w > 1500)
    `));
    console.log('--- appVersion 接口类型 ---');
    console.log(await evalJs('typeof window.api.appVersion'));
    console.log('--- StartPage / 引导层隐藏函数状态 ---');
    console.log(await evalJs(`
      (function(){
        const cands = [...document.querySelectorAll('div,section,main')].filter(e => {
          const s = getComputedStyle(e);
          if (s.display==='none' || s.visibility==='hidden' || +s.opacity===0) return false;
          const r = e.getBoundingClientRect();
          return r.width >= innerWidth*0.9 && r.height >= innerHeight*0.9 && s.zIndex !== 'auto' && +s.zIndex > 0;
        }).map(e => e.tagName + (e.id?('#'+e.id):'') + (typeof e.className==='string'&&e.className?('.'+e.className.split(' ').slice(0,2).join('.')):'') + ' z=' + getComputedStyle(e).zIndex);
        return JSON.stringify(cands.slice(0, 12));
      })()
    `));
  } catch (e) {
    console.error('诊断出错:', e.message);
  } finally {
    ws.close();
    setTimeout(() => process.exit(0), 300);
  }
};
ws.onerror = (e) => { console.error('WS错误', e.message || e); process.exit(1); };
