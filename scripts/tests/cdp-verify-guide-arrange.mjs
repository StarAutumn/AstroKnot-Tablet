// 验证教程「2D 自动排列」步骤（UI 14/26）可完成：
// 布局已是树状时排列不改位置 → 点击「自动排列」菜单项本身应推进步骤
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log((ok ? '✓ PASS' : '✗ FAIL') + '  ' + name + (detail ? '  — ' + detail : '')); };

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

// 等应用启动
for (let i = 0; i < 30; i++) { if (await ev2('!!window.appState')) break; await sleep(1000); }
await sleep(2500);

// 1) 补丁已加载
const patched = await ev2(`fetch('./modules/Guide/GuideCore.js').then(r => r.text()).then(t => t.includes('_arrangeClicked') && t.includes('__TABLET__'))`);
check('GuideCore 产物含排列点击兜底补丁', !!patched);

// 2) 进 2D 视图（等 550ms 过渡锁 + 余量）
await ev2(`(() => { if (!window.appState.is2DView) { const b = document.getElementById('modeToggleBtn'); if (b) b.click(); } return true; })()`);
await sleep(1500);
check('已进入 2D 模式', await ev2('!!window.appState.is2DView'));

// 3) 跳到「2D 自动排列」步骤（调试接口）
await ev2(`(() => { window.__guideJumpToStep(13); return true; })()`);
await sleep(600);
const st0 = await ev2(`(() => ({
  bubble: (document.querySelector('.guide-bubble')?.textContent || '').replace(/\\s+/g, ' ').slice(0, 60),
  hasPos2D: !!window.appState.positions2D && window.appState.positions2D.size > 0,
}))()`);
check('教程跳至「2D 自动排列」（14/26）', st0.bubble.includes('自动排列') && st0.bubble.includes('14 / 26'), JSON.stringify(st0));

// 4) 真实按钮路径：关 popup → 点 Auto → 点「自动排列」
await ev2(`(() => { const p = document.getElementById('arrangePopup'); if (p) p.classList.remove('show'); return true; })()`);
await sleep(200);
await ev2(`(() => { document.getElementById('arrangeBtn').click(); return true; })()`);
await sleep(400);
const popupShown = await ev2(`(() => document.getElementById('arrangePopup')?.classList.contains('show') || false)`);
check('Auto 菜单可弹出（触控 click）', !!popupShown);
await ev2(`(() => { const b = document.getElementById('arrangeTreeBtn'); if (b) b.click(); return true; })()`);
console.log('已点击「自动排列」，等待检测器…');
await sleep(2000);

// 5) 步骤应推进到「2D 多选节点」（15/26）
const st1 = await ev2(`(() => ({
  bubble: (document.querySelector('.guide-bubble')?.textContent || '').replace(/\\s+/g, ' ').slice(0, 60),
}))()`);
check('步骤推进到「2D 多选节点」（15/26）', st1.bubble.includes('多选') && st1.bubble.includes('15 / 26'), JSON.stringify(st1));

const pass = results.filter(Boolean).length;
console.log(`\n=== ${pass}/${results.length} 通过 ===`);
ws.close();
process.exit(pass === results.length ? 0 : 1);
