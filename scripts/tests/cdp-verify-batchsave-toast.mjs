// 端到端验证：重启后批量保存提示——第1次全"有更新"，第2次全"无变化"，转视角后仍"无变化"
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page' && p.url.startsWith('https://localhost'));
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
for (let i = 0; i < 30; i++) { if (await ev2('!!window.appState && window.FSCore && window.FSCore.isReady()')) break; await sleep(1000); }

const out = await ev2(`(async () => {
  const o = [];
  const grabToast = () => {
    const els = document.querySelectorAll('div');
    for (let i = els.length - 1; i >= 0; i--) {
      const t = els[i].textContent || '';
      if (t.indexOf('批量保存完成') === 0) return t;
    }
    return '(未捕获到提示)';
  };
  const runBatch = async () => {
    const m9 = await import('./modules/module9_FileIO.js');
    await m9.saveAllProjects();
    await new Promise(r => setTimeout(r, 600));
    return grabToast();
  };
  // 打开第一个项目（复现用户操作路径）
  let pid = window.appState.currentProjectId;
  if (!pid) {
    const m2 = await import('./modules/module2_TreeData.js');
    const first = (window.appState.projects || [])[0];
    const sp = await import('./modules/StartPage/index.js');
    if (sp.hideStartPage) sp.hideStartPage();
    await m2.loadProject(first.id);
    await new Promise(r => setTimeout(r, 2500));
    pid = window.appState.currentProjectId;
    o.push('已打开项目: ' + first.name);
  }
  const proj = window.appState.projects.find(p => p.id === pid);
  o.push('初始 __lastSaveHash = ' + (proj.__lastSaveHash ? '已存在' : 'undefined（重启后正常）'));
  // 第 1 次：应全部"有更新"
  o.push('第1次 → ' + await runBatch());
  // 第 2 次：内容未变，应全部"无变化"
  o.push('第2次 → ' + await runBatch());
  // 转相机视角后第 3 次：cameraView 已排除，应仍"无变化"
  try {
    const cam = window.camera;
    if (cam) { cam.position.x += 2; cam.position.y += 1; }
    const m2 = await import('./modules/module2_TreeData.js');
    await m2.saveCurrentProjectData(); // 同步实时状态（含新相机视角）
    o.push('已转动相机并同步 → 第3次 → ' + await runBatch());
  } catch (e) { o.push('相机操作异常: ' + e.message); }
  return o.join('\\n');
})()`);
console.log(out);
ws.close();
process.exit(0);
