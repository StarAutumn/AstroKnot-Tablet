// 离线验证：飞行模式下 TinyMCE 富文本编辑器可正常打开
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.res(m.result); }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    const desc = (d.exception?.description || '') + ' ' + d.text;
    if (desc.includes('triggerEvent') && desc.includes('<anonymous>')) return; // Capacitor 桥噪音
    console.log('[EXCEPTION]', d.text, (d.exception?.description || '').slice(0, 300));
  }
};
ws.onopen = async () => {
  await send('Runtime.enable');
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(ok); console.log((ok ? '✓ PASS' : '✗ FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
  };
  await new Promise(r => setTimeout(r, 1500));

  // 等应用就绪（含项目恢复）
  for (let i = 0; i < 30; i++) {
    const s = await ev(`(() => ({ ready: !!window.appState, n: window.appState ? window.appState.projects.length : 0 }))()`);
    if (s.ready) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  await new Promise(r => setTimeout(r, 2000));

  // 1. 找一个有富文本内容的节点（或任意节点），直接调 openRichEditor
  const open = await ev(`(async () => {
    // 找第一个真实节点
    let nodeId = null, nodeName = '';
    const walk = (n) => { if (!n || n.name === '(虚拟根)') { (n.children || []).forEach(walk); return; } if (!nodeId) { nodeId = n.id; nodeName = n.name; } (n.children || []).forEach(walk); };
    if (window.appState.methodsTree) walk(window.appState.methodsTree);
    if (!nodeId) return { ok: false, why: 'no-node' };
    const m = await import('./modules/richEditor/index.js');
    m.openRichEditor(nodeId);
    // 轮询 TinyMCE 初始化（首次初始化可能需数秒），最多 20s
    let t0 = Date.now(), editorReady = false;
    while (Date.now() - t0 < 20000) {
      await new Promise(s => setTimeout(s, 500));
      editorReady = !!(window.tinymce && window.tinymce.activeEditor && window.tinymce.activeEditor.initialized);
      if (editorReady) break;
    }
    const modal = document.getElementById('richContentModal') || document.querySelector('.rich-modal');
    return { ok: editorReady, nodeId, nodeName,
      editorReady,
      editorOpen: !!window.appState.editorOpen,
      modalVisible: !!modal && modal.style.display !== 'none' && getComputedStyle(modal).display !== 'none',
      elapsed: Date.now() - t0 };
  })()`);
  check('离线打开文本编辑器（TinyMCE 初始化成功）', open.ok, JSON.stringify(open));

  // 2. 编辑器可编辑 + 插件加载（离线时插件缺失会导致 toolbar 残缺）
  if (open.ok) {
    const detail = await ev(`(() => {
      const ed = window.tinymce.activeEditor;
      const names = Object.keys(ed.plugins || {});
      return {
        plugins: names.length,
        hasTable: !!ed.plugins.table,
        hasImage: !!ed.plugins.image,
        hasLists: !!ed.plugins.lists,
        canSetContent: typeof ed.setContent === 'function' && typeof ed.getContent === 'function',
        contentLen: (ed.getContent() || '').length,
        sample: names.slice(0, 8).join(','),
      };
    })()`);
    check('插件已加载 + 可读写内容', detail.plugins >= 15 && detail.canSetContent, JSON.stringify(detail));
  }

  const pass = results.filter(Boolean).length;
  console.log(`\n=== ${pass}/${results.length} 通过 ===`);
  process.exit(pass === results.length ? 0 : 1);
};
