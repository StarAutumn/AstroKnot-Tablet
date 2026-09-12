// 验证启动首页：飘带已删 + 底层动态渐变保留
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

  // 等应用就绪
  for (let i = 0; i < 30; i++) {
    const s = await ev(`(() => ({ ready: !!window.appState, sp: !!document.getElementById('startPage') }))()`);
    if (s.ready && s.sp) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  await new Promise(r => setTimeout(r, 2000));

  // 1. 飘带 DOM 已删除
  const dom = await ev(`(() => ({
    ribbonsContainer: !!document.querySelector('.start-page-ribbons'),
    ribbonItems: document.querySelectorAll('.ribbon').length,
    customBg: !!document.getElementById('startPageCustomBg'),
    container: !!document.querySelector('.start-page-container'),
  }))()`);
  check('飘带 DOM 已删除（容器+8条全无）', !dom.ribbonsContainer && dom.ribbonItems === 0, JSON.stringify(dom));

  // 2. 显示首页，检查底层渐变动画仍在
  const anim = await ev(`(async () => {
    const m = await import('./modules/StartPage/index.js');
    m.showStartPage();
    await new Promise(s => setTimeout(s, 400));
    const sp = document.getElementById('startPage');
    const before = getComputedStyle(sp, '::before');
    const after = getComputedStyle(sp, '::after');
    const visible = sp.style.display === 'flex';
    const recent = [...document.querySelectorAll('#recentProjectsList .recent-project-name')].map(n => n.textContent);
    return {
      visible, recent,
      beforeAnim: before.animationName + ' ' + before.animationDuration,
      afterAnim: after.animationName + ' ' + after.animationDuration,
      beforeBg: (before.backgroundImage || '').slice(0, 40),
    };
  })()`);
  check('首页显示 + 最近项目正常', anim.visible && anim.recent.length > 0, JSON.stringify(anim));
  check('底层渐变动画保留（::before 横向流动）', anim.beforeAnim.startsWith('startPageRainbowFlow') && !anim.beforeAnim.startsWith('none'), anim.beforeAnim);
  check('底层渐变动画保留（::after 垂直流动）', anim.beforeAnim !== '' && anim.afterAnim.startsWith('startPageRainbowFlowVertical'), anim.afterAnim);

  const pass = results.filter(Boolean).length;
  console.log(`\n=== ${pass}/${results.length} 通过 ===`);
  process.exit(pass === results.length ? 0 : 1);
};
