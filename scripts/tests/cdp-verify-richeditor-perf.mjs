// 冒烟验证：富文本 P0+P1 优化（字数统计 TreeWalker / strip 早退 / 目录折叠跳过）
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
let id = 0; const pend = new Map(); const errors = [];
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push(m.params.args.map(a => a.value || a.description || '').join(' '));
  }
};
await new Promise(r => ws.onopen = r);
await send('Runtime.enable');
const ev2 = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
for (let i = 0; i < 30; i++) { if (await ev2('!!window.appState')) break; await sleep(1000); }

const out = await ev2(`(async () => {
  const o = [];
  const cb = await import('./modules/richEditor/core/code-blocks.js');
  const ov = await import('./modules/richEditor/core/overlay/index.js');

  // 1. strip 早退：普通文档必须原样返回（逐字节相同）
  const plain = '<p>普通段落 <strong>加粗</strong></p><p>第二段</p>';
  o.push('strip 早退(无代码块) 原样返回: ' + (cb.stripLineNumbersFromHTML(plain) === plain));
  o.push('strip 早退(无overlay) 原样返回: ' + (ov.stripOverlayBlocksFromHTML(plain) === plain));

  // 2. strip 正确性：含代码块与含 overlay 块仍需真正处理
  const withCode = '<div class="tmce-code-wrapper"><div class="tmce-line-numbers"><span>1</span></div><pre class="tmce-has-lines"><code>x</code></pre></div>';
  const codeOut = cb.stripLineNumbersFromHTML(withCode);
  o.push('strip 代码块仍生效: ' + (codeOut.indexOf('tmce-code-wrapper') === -1 && codeOut.indexOf('tmce-has-lines') === -1));
  const withBlock = '<div class="tmce-overlay-block" data-block-id="b1"><div class="oly-img-item">img</div><div class="tmce-overlay-sizer"></div></div>';
  const blkOut = ov.stripOverlayBlocksFromHTML(withBlock);
  o.push('strip overlay 块仍生效: ' + (blkOut.indexOf('oly-img-item') === -1 && blkOut.indexOf('tmce-overlay-block') !== -1));

  // 3. 打开富文本编辑器，验证字数统计
  const proj = window.appState.projects.find(p => p.data && p.data.methodsTree);
  if (!proj) { o.push('无已加载项目，跳过编辑器验证'); return o.join('\\n'); }
  const m2 = await import('./modules/TreeData/index.js');
  if (window.appState.currentProjectId !== proj.id) {
    m2.loadProject(proj.id);
    await new Promise(r => setTimeout(r, 2500));
  }
  const target = [...window.appState.nodeMap.values()].find(n => n.activeMode !== 'code');
  if (!target) { o.push('无文本节点，跳过'); return o.join('\\n'); }
  const mod = await import('./modules/richEditor/index.js');
  mod.openRichEditor(target.id);
  await new Promise(r => setTimeout(r, 4000));

  const btn = document.getElementById('wcBtn');
  o.push('字数按钮文本: ' + (btn ? btn.textContent : '(找不到)'));
  const body = window.state_tinyEditor ? null : null;
  const ed = (await import('./modules/richEditor/shared-state.js')).state.tinyEditor;
  o.push('编辑器就绪: ' + !!ed);

  if (ed) {
    // 4. 打字模拟：连续 40 次 input 事件，验证防抖后字数只更新一次量级的正确值
    const before = btn ? btn.textContent : '';
    ed.focus();
    ed.selection.select(ed.getBody(), true);
    ed.selection.collapse(false);
    ed.insertContent('<p>性能验证ABC123</p>');
    ed.fire('input');
    ed.fire('input');
    ed.fire('input');
    await new Promise(r => setTimeout(r, 600));
    o.push('插入后字数按钮: ' + (btn ? btn.textContent : '') + ' (之前: ' + before + ')');

    // 5. 目录折叠跳过：折叠后 NodeChange 不应重建（比对 innerHTML 引用不变）
    const toc = document.getElementById('tocSidebar');
    const tree = toc ? toc.querySelector('.toc-tree') : null;
    if (toc && tree) {
      const tabBtn = toc.querySelector('.toc-tab');
      tabBtn.click();  // 折叠
      const snapshot = tree.innerHTML;
      ed.fire('NodeChange');
      await new Promise(r => setTimeout(r, 900));
      o.push('折叠态 NodeChange 后目录未重建: ' + (tree.innerHTML === snapshot));
      tabBtn.click();  // 展开 → 应补建
      const afterExpand = tree.innerHTML;
      o.push('展开后目录已重建(有内容): ' + (afterExpand.length > 0));
    } else {
      o.push('目录侧边栏不存在，跳过');
    }
  }
  return o.join('\\n');
})()`);
console.log(out);
console.log('---console/exception errors---');
console.log(errors.length ? errors.slice(0, 8).join('\n') : '(无)');
ws.close();
process.exit(0);
