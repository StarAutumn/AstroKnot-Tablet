// 验证虚拟摇杆：位置上移(110px) + 模态打开隐藏/关闭恢复
const { execSync } = await import('node:child_process');
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

// 1. 位置与层级
const pos = await ev2(`(() => {
  const s = document.getElementById('vk-stick');
  const root = document.getElementById('vk-root');
  const r = s.getBoundingClientRect();
  return { bottomGap: Math.round(innerHeight - r.bottom), z: getComputedStyle(root).zIndex, w: Math.round(r.width) };
})()`);
check('摇杆位置上移（底距 ≈110px）', Math.abs(pos.bottomGap - 110) <= 3, JSON.stringify(pos));
check('层级低于模态层（z=1400）', pos.z === '1400', 'z=' + pos.z);

// 2. 设置面板 → 隐藏摇杆
const set = await ev2(`(async () => {
  const sp = document.getElementById('settingsPopup');
  const prev = sp.style.display;
  sp.style.display = 'flex';
  await new Promise(r => setTimeout(r, 500));
  const hidden = document.getElementById('vk-root').style.display === 'none';
  sp.style.display = prev;
  await new Promise(r => setTimeout(r, 500));
  const restored = document.getElementById('vk-root').style.display !== 'none';
  return { hidden, restored };
})()`);
check('设置面板打开 → 摇杆隐藏，关闭 → 恢复', set.hidden && set.restored, JSON.stringify(set));

// 3. 确认弹窗 → 隐藏
const confirm = await ev2(`(async () => {
  const d = document.createElement('div');
  d.id = 'customConfirmModal';
  document.body.appendChild(d);
  await new Promise(r => setTimeout(r, 500));
  const hidden = document.getElementById('vk-root').style.display === 'none';
  d.remove();
  await new Promise(r => setTimeout(r, 500));
  const restored = document.getElementById('vk-root').style.display !== 'none';
  return { hidden, restored };
})()`);
check('确认弹窗打开 → 摇杆隐藏，关闭 → 恢复', confirm.hidden && confirm.restored, JSON.stringify(confirm));

// 4. AppRunner 应用窗口（文件管理器）真实打开 → 隐藏 → 关闭恢复
const app = await ev2(`(async () => {
  const apps = await window.api.readAppList();
  const fm = apps.apps.find(a => a.id === 'builtin-file-manager');
  await window.AppRunner.open(fm);
  await new Promise(r => setTimeout(r, 2000));
  const hidden = document.getElementById('vk-root').style.display === 'none';
  // 模拟关闭（display 置 none 与桌面关闭路径一致）
  [...document.querySelectorAll('.rich-modal')].forEach(m => { if (m.style.display !== 'none') m.style.display = 'none'; });
  await new Promise(r => setTimeout(r, 600));
  const restored = document.getElementById('vk-root').style.display !== 'none';
  return { hidden, restored };
})()`);
check('应用窗口打开 → 摇杆隐藏，关闭 → 恢复', app.hidden && app.restored, JSON.stringify(app));

// 5. 截图存证（新位置）
execSync('adb shell screencap -p /sdcard/vk_pos.png');
execSync('adb pull /sdcard/vk_pos.png scripts/vk_pos.png 2>&1', { stdio: 'ignore' });
console.log('截图: scripts/vk_pos.png');

const pass = results.filter(Boolean).length;
console.log(`\n=== ${pass}/${results.length} 通过 ===`);
process.exit(pass === results.length ? 0 : 1);
