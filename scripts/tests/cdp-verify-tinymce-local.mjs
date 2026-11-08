// 验证 TinyMCE 本地化后是否正常加载与初始化
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let page = null;
for (let i = 0; i < 40; i++) {
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
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
await new Promise(r => ws.onopen = r);
await send('Runtime.enable');
const ev2 = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
for (let i = 0; i < 40; i++) { if (await ev2('!!window.appState')) break; await sleep(1000); }
for (let i = 0; i < 30; i++) { if (await ev2('!!(window.appState && window.appState.projects)')) break; await sleep(1000); }

const out = await ev2(`(async () => {
  const o = [];
  o.push('document.URL: ' + location.href.slice(-60));
  o.push('window.tinymce: ' + typeof window.tinymce);
  o.push('tinymce.majorVersion: ' + (window.tinymce ? window.tinymce.majorVersion : 'N/A'));

  // 关键资源加载情况
  const res = performance.getEntriesByType('resource').filter(r => /tinymce|lunar|skins|plugins/i.test(r.name));
  const failed = res.filter(r => r.transferSize === 0 && r.duration > 0);
  o.push('tinymce 相关资源请求数: ' + res.length + ', 疑似失败(0字节): ' + failed.length);
  res.slice(0, 6).forEach(r => o.push('  ' + Math.round(r.duration) + 'ms ' + r.name.replace(location.origin, '').slice(0, 90)));

  // 打开项目与编辑器
  const proj = (window.appState.projects || []).find(p => p.folderPath) || (window.appState.projects || [])[0];
  if (!proj) { o.push('无项目，跳过编辑器验证'); return o.join('\\n'); }
  const m2 = await import('./modules/TreeData/index.js');
  if (window.appState.currentProjectId !== proj.id) { m2.loadProject(proj.id); await new Promise(r => setTimeout(r, 2500)); }
  const target = [...(window.appState.nodeMap || new Map()).values()].find(n => n.activeMode !== 'code');
  if (!target) { o.push('无文本节点'); return o.join('\\n'); }
  const mod = await import('./modules/richEditor/index.js');
  mod.openRichEditor(target.id);
  const st = (await import('./modules/richEditor/shared-state.js')).state;
  for (let i = 0; i < 30 && !st.tinyEditor; i++) await new Promise(r => setTimeout(r, 1000));
  o.push('编辑器实例就绪: ' + !!st.tinyEditor);
  if (st.tinyEditor) {
    const ed = st.tinyEditor;
    o.push('编辑器 body 存在: ' + !!ed.getBody());
    o.push('当前内容长度: ' + ed.getContent().length);
    // 检查 skin / icons / plugins / language 是否真正生效
    o.push('ui skin 加载: ' + (document.querySelector('.tox .tox-tinymce') ? 'DOM 已生成' : '未生成'));
    o.push('工具栏按钮数: ' + document.querySelectorAll('#toolbarDock .tox-tbtn, #toolbarDock .tox-mbtn').length);
    o.push('语言包生效(中文按钮): ' + ((document.querySelector('#toolbarDock') || {}).textContent || '').slice(0, 40));
    // 字数统计（P0-1 改动的运行时验证）
    const btn = document.getElementById('wcBtn');
    o.push('字数按钮: ' + (btn ? btn.textContent : '(缺失)'));
    ed.setContent('<p>本地化验证 hello world</p>');
    ed.fire('input');
    await new Promise(r => setTimeout(r, 700));
    o.push('setContent 后字数: ' + (btn ? btn.textContent : ''));
  } else {
    o.push('tinymce 全局: ' + typeof window.tinymce);
    o.push('工具栏容器: ' + !!document.getElementById('toolbarDock'));
  }
  return o.join('\\n');
})()`);
console.log(out);
console.log('---exceptions---');
console.log(errors.length ? errors.slice(0, 6).join('\n') : '(无)');
ws.close();
process.exit(0);
