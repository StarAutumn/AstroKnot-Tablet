// 一次性：验证「此 AstroKnot」+ 回收站应用与应用内定位
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
    if (desc.includes('triggerEvent') && desc.includes('<anonymous>')) return;
    console.log('[EXCEPTION]', d.text, (d.exception?.description || '').slice(0, 250));
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

  // 1. fm API 面
  const face = await ev(`(() => ({ tree: typeof window.api.fmReadDirTree, dir: typeof window.api.fmReadDir, file: typeof window.api.fmReadFile, create: typeof window.api.fmCreateItem, del: typeof window.api.fmDeleteItem, ren: typeof window.api.fmRenameItem, copy: typeof window.api.fmCopyItem, findApp: typeof window.api.fmFindAppByPath }))()`);
  check('fm* API 面', Object.values(face).every(t => t === 'function'), JSON.stringify(face));

  // 2. fmReadDir/fmReadFile 格式
  const dirItems = await ev(`window.api.fmReadDir('projects')`);
  check('fmReadDir(projects) 列出项目', Array.isArray(dirItems) && dirItems.length >= 1 && 'name' in dirItems[0] && 'type' in dirItems[0], JSON.stringify(dirItems && dirItems.map(i => i.name)));
  const fileRead = await ev(`window.api.fmReadFile('projects/新知识网络/project.json')`);
  check('fmReadFile(project.json) 文本', fileRead && fileRead.type === 'text' && typeof fileRead.content === 'string' && fileRead.content.includes('methodsTree'), 'size=' + (fileRead && fileRead.size));
  const tree = await ev(`window.api.fmReadDirTree()`);
  check('fmReadDirTree 目录树', tree && tree.children && tree.children.projects && tree.children['system'], Object.keys((tree && tree.children) || {}).join(','));

  // 3. 打开「此 AstroKnot」
  const openFm = await ev(`(async () => {
    const r = window.api.readAppList(); const list = (r && r.then) ? await r : r;
    const app = (list.apps || []).find(a => a.id === 'builtin-file-manager');
    if (!app) return { ok: false };
    await window.AppRunner.open(app);
    await new Promise(s => setTimeout(s, 2500));
    return { ok: true, instance: !!window.__fmInstance, win: !!document.querySelector('.rich-modal.app-runner-modal') };
  })()`);
  check('打开「此 AstroKnot」', openFm.ok && openFm.instance && openFm.win, JSON.stringify(openFm));

  // 4. 应用内定位（showFileInFolder → inApp:true + 窗口导航）
  const loc = await ev(`(async () => {
    const r = await window.api.showFileInFolder('projects/新知识网络');
    await new Promise(s => setTimeout(s, 1200));
    const addr = document.querySelector('.fm-address, [class*="fm-address"]');
    return { r: r, addrText: addr ? addr.textContent : null, startPathConsumed: window.__fmStartPath === null };
  })()`);
  check('应用内定位 projects/新知识网络', loc.r && loc.r.inApp === true && loc.r.success === true, JSON.stringify({ r: loc.r, addr: loc.addrText }));

  // 5. 打开回收站
  const openTrash = await ev(`(async () => {
    const r = window.api.readAppList(); const list = (r && r.then) ? await r : r;
    const app = (list.apps || []).find(a => a.id === 'builtin-trash');
    if (!app) return { ok: false };
    await window.AppRunner.open(app);
    await new Promise(s => setTimeout(s, 2500));
    const win = !!document.querySelector('.rich-modal.app-runner-modal');
    const empty = document.querySelector('.trash-empty') || document.querySelector('.trash-list');
    return { ok: true, win: win, listEl: !!empty, text: empty ? empty.textContent.slice(0, 40) : null };
  })()`);
  check('打开「回收站」', openTrash.ok && openTrash.win, JSON.stringify(openTrash));

  console.log('结果: ' + results.filter(Boolean).length + '/' + results.length);
  ws.close(); setTimeout(() => process.exit(results.every(Boolean) ? 0 : 1), 300);
};
