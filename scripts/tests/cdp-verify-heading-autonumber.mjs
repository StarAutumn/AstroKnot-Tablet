// 验证：多级标题插入后是否自动重新编号（无需手动「重新编号所有标题」）
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const list = await fetch('http://127.0.0.1:9333/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page' && /index\.html/.test(p.url));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map(); const errors = [];
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
await new Promise(r => ws.onopen = r);
await send('Runtime.enable');
const ev2 = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'ERR: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};

const out = await ev2(`(async () => {
  const o = [];
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const st = (await import('./modules/richEditor/shared-state.js')).state;
  const lists = await import('./modules/richEditor/lists.js');

  const ed = st.tinyEditor;
  o.push('编辑器就绪: ' + !!ed);
  if (!ed) return o.join('\\n');
  const saved = ed.getContent();

  const nums = () => [...ed.getBody().querySelectorAll('h1,h2,h3,h4,h5,h6')]
    .map(h => h.tagName + ':' + ((h.querySelector('.toc-num') || {}).textContent || '-'));

  // 1) 模拟右键「插入目录」结果：带 .toc-num 的标题（文档从此刻起启用编号）
  ed.setContent('<h1 id="a"><span class="toc-num" contenteditable="false">1</span> 第一章</h1>' +
                '<h2 id="b"><span class="toc-num" contenteditable="false">1.1</span> 小节一</h2>' +
                '<h2 id="c"><span class="toc-num" contenteditable="false">1.2</span> 小节二</h2>');
  ed.fire('SetContent');
  await sleep(300);
  o.push('初始(已带编号): ' + nums().join(' | '));

  // 2) 在“小节一”之前插入一个同级标题（模拟中途插入），只带内容不带正确序号
  const body = ed.getBody();
  const h2b = body.querySelector('#b');
  const ins = document.createElement('h2');
  ins.id = 'x';
  ins.innerHTML = '<span class="toc-num" contenteditable="false">9.9</span> 插进来的小节';
  h2b.parentNode.insertBefore(ins, h2b);
  ed.fire('input');
  ed.nodeChanged();
  await sleep(400);
  o.push('中途插入后自动重编号: ' + nums().join(' | '));

  // 3) 删除一个标题（模拟删除章节），检查后续序号回填
  body.querySelector('#c').remove();
  ed.fire('input');
  ed.nodeChanged();
  await sleep(400);
  o.push('删除标题后自动重编号: ' + nums().join(' | '));

  // 4) 新增一个从未编号的标题（模拟工具栏/回车产生），文档已启用编号 → 应自动补号
  const plain = document.createElement('h3');
  plain.id = 'p';
  plain.textContent = '未带序号的标题';
  body.appendChild(plain);
  ed.fire('input');
  ed.nodeChanged();
  await sleep(400);
  o.push('新标题自动补号: ' + nums().join(' | '));

  // 5) 撤销一次，检查序号是否回滚正确
  ed.undoManager.undo();
  await sleep(300);
  o.push('撤销后序号: ' + nums().join(' | '));
  ed.undoManager.redo();
  await sleep(300);
  o.push('重做后序号: ' + nums().join(' | '));

  // 6) 未启用编号的文档（无任何 .toc-num）→ 自动流程不应注入序号
  ed.setContent('<h1>普通标题一</h1><h2>普通标题二</h2>');
  ed.fire('SetContent');
  await sleep(300);
  o.push('未启用编号文档(自动流程): ' + nums().join(' | '));
  // 手动「重新编号所有标题」→ 应注入
  lists.renumberAllHeadings(ed, true);
  await sleep(150);
  o.push('手动强制重编号后: ' + nums().join(' | '));

  ed.setContent(saved);
  return o.join('\\n');
})()`);
console.log(out);
console.log('---errors---');
console.log(errors.length ? errors.slice(0, 5).join('\n') : '(无)');
ws.close();
process.exit(0);
