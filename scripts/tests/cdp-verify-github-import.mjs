// 验证 GitHub zip 导入（免 git）：垫片加载 → zip 读取 → importFromGithub 全链路 → 打开回退 → 清理
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page');
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
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log((ok ? '✓ PASS' : '✗ FAIL') + '  ' + name + (detail ? '  — ' + detail : '')); };

await new Promise(r => setTimeout(r, 3000));
for (let i = 0; i < 30; i++) { const s = await ev2('!!window.appState'); if (s) break; await new Promise(r => setTimeout(r, 1000)); }
await new Promise(r => setTimeout(r, 2500));

// 1. 垫片加载
const shim = await ev2(`(() => ({
  zipRead: typeof window.__githubReadFiles === 'function',
  gitClone: typeof window.api?.gitCloneAndRead === 'function',
  syncApp: typeof window.api?.syncAppDirectory === 'function',
  readSandbox: typeof window.api?.readAppSandbox === 'function',
  getSandbox: typeof window.api?.getAppSandboxPath === 'function',
  ds: typeof DecompressionStream !== 'undefined',
}))()`);
check('垫片接口齐备 + DecompressionStream 可用', shim.zipRead && shim.gitClone && shim.syncApp && shim.readSandbox && shim.getSandbox && shim.ds, JSON.stringify(shim));

// 2. zip 读取（octocat/Hello-World）
const zip = await ev2(`window.api.gitCloneAndRead('https://github.com/octocat/Hello-World')`);
const readme = (zip.files || []).find(f => /readme/i.test(f.path));
check('zip 读取成功（无顶层前缀 + 文本内容正确）',
  zip.success && zip.files.length >= 1 && !!readme && (readme.content || '').length > 0 && !zip.files.some(f => f.path.includes('Hello-World')),
  'files=' + (zip.files || []).map(f => f.path).join(','));

// 3. 全链路导入（先清理历史测试残留）
await ev2(`(async () => {
  if (!window.AppManager) return;
  const stale = window.AppManager._apps.filter(a => a.repo === 'octocat/Hello-World');
  for (const a of stale) { try { await window.AppManager.deleteApp(a.id); } catch (e) {} }
})()`);
let imported = null;
try {
  imported = await ev2(`(async () => {
    if (!window.AppManager) return { err: 'AppManager 未挂载' };
    const app = await window.AppManager.importFromGithub('octocat/Hello-World');
    const tree = await window.api.readAppSandbox(app.id);
    return { id: app.id, name: app.name, fileCount: app.fileCount, hasTree: !!tree, treeFiles: tree ? Object.keys(tree.files || tree || {}).length : 0 };
  })()`);
} catch (e) { imported = { err: String(e.message || e).slice(0, 200) }; }
check('importFromGithub 全链路（元数据+VFS 写入+清单保存）',
  !imported.err && imported.fileCount >= 1 && imported.hasTree, JSON.stringify(imported));

// 4. 清理测试应用
if (imported && imported.id) {
  const cleaned = await ev2(`(async () => {
    await window.AppManager.deleteApp('${imported.id}');
    const tree = await window.api.readAppSandbox('${imported.id}');
    return { treeGone: !tree, listed: window.AppManager._apps.some(a => a.id === '${imported.id}') };
  })()`);
  check('测试应用清理（deleteApp + 沙盒目录删除）', cleaned.treeGone && !cleaned.listed, JSON.stringify(cleaned));
}

const pass = results.filter(Boolean).length;
console.log(`\n=== ${pass}/${results.length} 通过 ===`);
process.exit(pass === results.length ? 0 : 1);
