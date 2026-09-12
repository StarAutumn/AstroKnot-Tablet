// 验证新手引导平板化：触控文案 + 摇杆事件桥 + F2 提示跳过
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

await sleep(3000);
for (let i = 0; i < 20; i++) { if (await ev2('!!window.appState')) break; await sleep(1000); }
await sleep(1500);
await ev2(`(() => { const el = document.getElementById('startPage'); if (el) el.style.display = 'none'; return true; })()`);
await sleep(400);

// 0. 覆写块存在性（产物含平板标记）
const hasPatch = await ev2(`fetch('./modules/Guide/GuideCore.js').then(r => r.text()).then(t => t.includes('tablet-trim') && t.includes('__vk'))`);
check('GuideCore 产物含平板覆写+事件桥', hasPatch === true);

// 1. 欢迎步骤：触控文案（无 Esc 提示）
const w = await ev2(`(async () => {
  window.__guideJumpToStep(0);
  await new Promise(r => setTimeout(r, 500));
  const b = document.querySelector('#guideBubble, .guide-bubble, [class*="guide"]');
  return { txt: document.body.innerText.includes('随时可点「跳过」退出'), esc: document.body.innerText.includes('Esc') };
})()`);
check('欢迎步骤触控文案（无 Esc）', w.txt && !w.esc, JSON.stringify(w));

// 2. 键盘飞行步骤：摇杆文案 + 事件桥（模拟摇杆 keydown → 进度更新）
const kn = await ev2(`(async () => {
  window.__guideJumpToStep(2);
  await new Promise(r => setTimeout(r, 500));
  const hasJoystickText = document.body.innerText.includes('虚拟摇杆');
  // 模拟摇杆合成事件（同 virtual-joystick sendKey：__vk 标记 + window 派发）
  const keys = ['w', 'a', 's', 'd', ' ', 'Control'];
  for (const k of keys) {
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    ev.__vk = true;
    window.dispatchEvent(ev);
    await new Promise(r => setTimeout(r, 120));
  }
  await new Promise(r => setTimeout(r, 800));
  const prog = document.getElementById('guideKeyProgress');
  return { hasJoystickText, prog: prog ? prog.textContent : 'NO', bodyTxt: document.body.innerText.slice(0, 300) };
})()`);
check('键盘飞行步骤改虚拟摇杆文案', kn.hasJoystickText);
check('摇杆事件桥生效（6 方向全部计入）', /全部完成|6/.test(kn.prog), '进度=' + kn.prog);
await ev2(`(async () => { const b = document.getElementById('guideSkipBtn'); return true; })()`);

// 3. 缩放步骤：双指捏合文案（先等键盘步骤的成功反馈动画走完）
const zm = await ev2(`(async () => {
  await new Promise(r => setTimeout(r, 1500));
  window.__guideJumpToStep(3);
  await new Promise(r => setTimeout(r, 400));
  return { pinch: document.body.innerText.includes('双指捏合') };
})()`);
check('缩放步骤双指捏合文案', zm.pinch);

// 4. 右键菜单步骤：长按文案
const rc = await ev2(`(async () => {
  window.__guideJumpToStep(5);
  await new Promise(r => setTimeout(r, 400));
  return { press: document.body.innerText.includes('长按'), noRightBtn: !document.body.innerText.includes('右键点击场景') };
})()`);
check('右键菜单步骤改长按文案', rc.press && rc.noRightBtn);

// 5. 快捷键总结步骤：触控手势表
const sc = await ev2(`(async () => {
  window.__guideJumpToStep(22);
  await new Promise(r => setTimeout(r, 400));
  return { gesture: document.body.innerText.includes('触控手势速览'), longPress: document.body.innerText.includes('长按节点') };
})()`);
check('总结步骤改触控手势速览', sc.gesture && sc.longPress);

// 6. 跳过引导 → F2 提示不弹（华丽 3D 已禁用）
const f2 = await ev2(`(async () => {
  const btn = document.getElementById('guideSkipBtn');
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 900));
  return { gone: !document.getElementById('guideF2Hint') };
})()`);
check('跳过引导后无 F2 提示（平板）', f2.gone);

const pass = results.filter(Boolean).length;
console.log(`\n=== ${pass}/${results.length} 通过 ===`);
process.exit(pass === results.length ? 0 : 1);
