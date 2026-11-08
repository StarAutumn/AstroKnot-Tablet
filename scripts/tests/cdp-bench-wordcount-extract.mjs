// 最终验证：word-count 快路径（无 overlay 免克隆）正确性与性能
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let page = null;
for (let i = 0; i < 30; i++) {
  try {
    const list = await fetch('http://127.0.0.1:9333/json/list').then(r => r.json());
    page = list.find(p => p.type === 'page' && /index\.html/.test(p.url));
    if (page) break;
  } catch (_) { /* 未就绪 */ }
  await sleep(1000);
}
if (!page) { console.log('CDP 页面未就绪'); process.exit(1); }
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

const out = await ev2(`(async () => {
  const o = [];
  // 旧实现
  const OLD = (el) => { if (!el) return ''; const c = el.cloneNode(true); const ov = c.querySelector('#overlayImageContainer'); if (ov) ov.remove(); return c.textContent || ''; };
  // 新实现（与 word-count.js 当前代码一致）
  const NEW = (el) => {
    if (!el) return '';
    if (!el.querySelector('#overlayImageContainer')) return el.textContent || '';
    const clone = el.cloneNode(true);
    const ov = clone.querySelector('#overlayImageContainer');
    if (ov) ov.remove();
    return clone.textContent || '';
  };

  // ── 等价性 ──
  const cases = {
    '简单段落': '<p>你好 world 123</p><p>第二段</p>',
    '嵌套样式': '<p><span style="color:red">红字</span><strong>加粗<em>斜体</em></strong></p>',
    '列表标题': '<h1>标题一</h1><ul><li>项A</li><li>项B<ul><li>子项</li></ul></li></ul>',
    '含overlay': '<p>正文一</p><div id="overlayImageContainer"><div>图注文字</div></div><p>正文二</p>',
    '歧义用例(ab+a)': '<p>ab</p><div id="overlayImageContainer">a</div>',
    'overlay中间': '<p>前</p><div id="overlayImageContainer">中</div><p>后</p>',
    '表格代码': '<table><tr><td>单元格甲</td><td>乙</td></tr></table><pre><code>const a=1;</code></pre>',
    '空容器': '',
    '仅overlay': '<div id="overlayImageContainer">只应排除</div>'
  };
  let allEq = true;
  for (const [name, html] of Object.entries(cases)) {
    const d = document.createElement('div'); d.innerHTML = html;
    const a = OLD(d), b = NEW(d);
    if (a !== b) { allEq = false; o.push('  ★差异[' + name + '] 旧="' + a + '" 新="' + b + '"'); }
  }
  o.push('新实现对全部用例与旧实现一致: ' + allEq);

  // ── 性能 1：无 overlay（最常见情况）──
  const big = document.createElement('div');
  let html = '';
  for (let i = 0; i < 1200; i++) html += '<p><span style="color:#f00">段落' + i + '</span> <strong>加粗</strong> <em>斜体</em> 文本内容</p>';
  big.innerHTML = html;
  document.body.appendChild(big);
  const bench = (fn) => { const t = performance.now(); for (let i = 0; i < 20; i++) fn(big); return performance.now() - t; };
  bench(OLD); bench(NEW);
  const tOld = bench(OLD), tNew = bench(NEW);
  o.push('无 overlay（1200段×20次）: 旧=' + tOld.toFixed(1) + 'ms 新=' + tNew.toFixed(1) + 'ms 提速 ' + (tOld / Math.max(tNew, 0.01)).toFixed(1) + 'x');
  document.body.removeChild(big);

  // ── 性能 2：有 overlay ──
  const big2 = document.createElement('div');
  let h2 = '';
  for (let i = 0; i < 1200; i++) h2 += '<p>段落' + i + ' 文本内容</p>';
  h2 += '<div id="overlayImageContainer"><div>overlay 图注</div></div>';
  big2.innerHTML = h2;
  document.body.appendChild(big2);
  bench(OLD); bench(NEW);
  const tOld2 = bench(OLD), tNew2 = bench(NEW);
  o.push('有 overlay（1200段×20次）: 旧=' + tOld2.toFixed(1) + 'ms 新=' + tNew2.toFixed(1) + 'ms');
  document.body.removeChild(big2);

  // ── 端到端：真实编辑器 body 上的耗时 ──
  const ed = (await import('./modules/richEditor/shared-state.js')).state.tinyEditor;
  if (ed && ed.getBody()) {
    const body = ed.getBody();
    o.push('真实编辑器 body: ' + (body.querySelector('#overlayImageContainer') ? '含overlay容器' : '无overlay容器') + ', 元素数 ' + body.querySelectorAll('*').length);
    const t1 = performance.now(); for (let i = 0; i < 10; i++) OLD(body); const e1 = performance.now() - t1;
    const t2 = performance.now(); for (let i = 0; i < 10; i++) NEW(body); const e2 = performance.now() - t2;
    o.push('真实 body 对比(10次): 旧=' + e1.toFixed(2) + 'ms 新=' + e2.toFixed(2) + 'ms');
  } else {
    o.push('(编辑器未启动，跳过真实 body 对比)');
  }
  return o.join('\\n');
})()`);
console.log(out);
ws.close();
process.exit(0);
