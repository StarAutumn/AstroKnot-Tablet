// 通过 CDP 检查平板 WebView 内部状态（一次性诊断脚本）
// 用法: node scripts/cdp-diag.mjs
import process from 'node:process';

const pid = process.argv[2];
if (!pid) { console.error('用法: node cdp-diag.mjs <app pid>'); process.exit(1); }

// node 版本需 >=22（内置 WebSocket）
console.log('node:', process.version);

// 先通过 /json/list 拿 webSocketDebuggerUrl
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page');
if (!page) { console.error('未找到 page'); process.exit(1); }
console.log('页面:', page.url, '| title:', page.title);

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
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map(a => a.value ?? a.description ?? '').join(' ');
    console.log('[console.' + msg.params.type + ']', text.slice(0, 500));
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    console.log('[EXCEPTION]', d.text, d.exception?.description?.slice(0, 800) || '');
  } else if (msg.method === 'Log.entryAdded') {
    const e = msg.params.entry;
    console.log('[log.' + e.level + ']', e.url || '', e.text.slice(0, 300));
  }
};

ws.onopen = async () => {
  try {
    await send('Runtime.enable');
    await send('Log.enable');
    await new Promise(r => setTimeout(r, 1500));

    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      return r.result?.value ?? r.result?.description ?? JSON.stringify(r);
    };

    console.log('--- WebView 状态 ---');
    console.log('readyState:', await evalJs('document.readyState'));
    console.log('__TABLET__:', await evalJs('window.__TABLET__'));
    console.log('body子元素数:', await evalJs('document.body.children.length'));
    console.log('scripts总数:', await evalJs('document.scripts.length'));
    console.log('AstroKnot.js标签:', await evalJs('!!document.querySelector(\'script[src*="AstroKnot.js"]\')'));
    console.log('module错误占位:', await evalJs('document.querySelectorAll(\'script[type="module"]\').length'));

    // 关键：尝试手动 import 主模块，看抛什么错
    console.log('--- 尝试动态 import AstroKnot.js ---');
    console.log(await evalJs(
      'import("./AstroKnot.js").then(() => "import成功").catch(e => "import失败: " + (e.message || e))'
    ));
  } catch (e) {
    console.error('诊断出错:', e.message);
  } finally {
    ws.close();
    setTimeout(() => process.exit(0), 300);
  }
};
ws.onerror = (e) => { console.error('WS错误', e.message || e); process.exit(1); };
