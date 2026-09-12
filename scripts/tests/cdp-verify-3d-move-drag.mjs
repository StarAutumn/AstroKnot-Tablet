// 验证 3D 移动模式长按拖动移动节点（touch-gestures.js dragRelay 接力）+ 回归
// 链路：真实/合成 pointerdown 命中节点 → 桌面 capture 处理器设 drag3DNode
//       → 垫片把 touchmove 转成 rendererDom mousemove → touchend 补 window mouseup
// 注意：3D 触摸监听绑在 renderer.domElement 上，TouchEvent 必须派发到 canvas（非 document）
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

for (let i = 0; i < 20; i++) { if (await ev2('!!window.appState')) break; await sleep(1000); }
await sleep(2000);

// 预检：设备运行的 touch-gestures.js 必须含接力标记（防旧 APK 假失败）
const tgSrc = await ev2(`(async () => (await (await fetch('/js/touch-gestures.js')).text()))()`);
check('设备 touch-gestures.js 含 dragRelay/wasTap 标记', /dragRelay/.test(tgSrc) && /wasTap/.test(tgSrc), 'len=' + tgSrc.length);

// 前置：关启动首页 + 确保 3D 模式
await ev2(`(async () => {
  const sp = document.getElementById('startPage');
  if (sp && sp.style.display !== 'none' && getComputedStyle(sp).display !== 'none') {
    const m = await import('./modules/StartPage/index.js');
    if (m.hideStartPage) { m.hideStartPage(); await new Promise(r => setTimeout(r, 1000)); }
  }
  if (window.appState.is2DView) { const b = document.getElementById('modeToggleBtn'); if (b) b.click(); }
  return true;
})()`);
await sleep(1500);
check('已进入 3D 模式', await ev2('!!(window.appState && window.appState.renderer && !window.appState.is2DView)'));
console.log('尺寸:', await ev2(`JSON.stringify({ iw: innerWidth, ih: innerHeight, cv: window.appState.renderer.domElement.getBoundingClientRect().toJSON() })`));

// 选一个投影后在屏幕内的节点（注意：桌面 raycast 用 canvas clientWidth/Height 做 NDC，
// 投影必须用 canvas rect 而非 innerWidth/innerHeight，否则坐标系错位导致命中失败）
const node = await ev2(`(() => {
  const cam = window.appState.camera;
  const rect = window.appState.renderer.domElement.getBoundingClientRect();
  for (const [nid, pos] of window.appState.positions) {
    const p = pos.clone().project(cam);
    if (Math.abs(p.x) < 0.5 && Math.abs(p.y) < 0.5 && p.z < 1) {
      return { id: nid, x: Math.round(rect.left + (p.x + 1) / 2 * rect.width), y: Math.round(rect.top + (-p.y + 1) / 2 * rect.height) };
    }
  }
  return null;
})()`);
check('节点屏幕坐标可投影', !!node, JSON.stringify(node));
if (!node) { console.log('无可测节点，终止'); ws.close(); process.exit(1); }

const fire = `(type, x, y, opts) => {
  const cv = window.appState.renderer.domElement;
  const rect = cv.getBoundingClientRect();
  const cx = rect.left + x, cy = rect.top + y;
  if (type === 'pointerdown') {
    cv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0, buttons: 1, pointerId: 7, pointerType: 'touch', isPrimary: true }));
    return true;
  }
  const t = new Touch({ identifier: 7, target: cv, clientX: cx, clientY: cy });
  cv.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }));
  return true;
}`;

// ── 回归1：非移动模式长按节点 → 节点右键菜单 ──
await ev2(`(async () => {
  const fire = ${fire};
  fire('pointerdown', ${node.x}, ${node.y});
  fire('touchstart', ${node.x}, ${node.y});
  await new Promise(r => setTimeout(r, 750));
  fire('touchend', ${node.x}, ${node.y});
  await new Promise(r => setTimeout(r, 400));
  return true;
})()`);
const ctxMenu = await ev2(`(() => {
  const m = document.getElementById('nodeContextMenu');
  return { visible: m && m.style.display !== 'none', drag3DNode: null };
})()`);
check('回归：非移动模式长按节点 → 右键菜单', !!ctxMenu && ctxMenu.visible, JSON.stringify(ctxMenu));
// 点空白关闭菜单
await ev2(`(async () => {
  const fire = ${fire};
  fire('pointerdown', 60, 120); fire('touchstart', 60, 120);
  await new Promise(r => setTimeout(r, 80));
  fire('touchend', 60, 120);
  await new Promise(r => setTimeout(r, 300));
  return true;
})()`);

// ── 进入移动模式（桌面 enterMoveMode，与右键菜单「移动节点」按钮同路径）──
await ev2(`(async () => {
  const m = await import('./modules/MoveMode/move-mode/move-core.js');
  m.enterMoveMode(${JSON.stringify(node.id)});
  return true;
})()`);
await sleep(300);
const mm = await ev2(`(async () => {
  const s = await import('./modules/MoveMode/shared.js');
  return { isMoveMode: s.isMoveMode, bar: document.getElementById('moveControlBar')?.style.display };
})()`);
check('已进入移动模式', mm.isMoveMode && mm.bar === 'flex', JSON.stringify(mm));

// ── 拖拽节点 ──
const pos0 = await ev2(`(() => { const p = window.appState.positions.get(${JSON.stringify(node.id)}); return { x: p.x, y: p.y, z: p.z }; })()`);
const cam0 = await ev2(`(() => { const p = window.appState.camera.position; return { x: p.x, y: p.y, z: p.z }; })()`);
const dx = 160, dy = 110;
await ev2(`(async () => {
  const fire = ${fire};
  fire('pointerdown', ${node.x}, ${node.y});   // 桌面 capture：命中节点 → drag3DNode=true
  await new Promise(r => setTimeout(r, 60));
  fire('touchstart', ${node.x}, ${node.y});    // 垫片：读到 drag3DNode → 接力
  return true;
})()`);
for (const f of [0.3, 0.55, 0.8, 1]) {
  const fx = Math.round(node.x + dx * f), fy = Math.round(node.y + dy * f);
  await ev2(`(async () => { const fire = ${fire}; fire('touchmove', ${fx}, ${fy}); return true; })()`);
  await sleep(90);
}
await ev2(`(async () => {
  const fire = ${fire};
  fire('touchend', ${node.x + dx}, ${node.y + dy});
  await new Promise(r => setTimeout(r, 500));
  return true;
})()`);
const pos1 = await ev2(`(() => { const p = window.appState.positions.get(${JSON.stringify(node.id)}); return { x: p.x, y: p.y, z: p.z }; })()`);
const moved = Math.hypot(pos1.x - pos0.x, pos1.y - pos0.y) + Math.hypot(pos1.z - pos0.z);
check('移动模式拖拽 → 节点位移', moved > 1, `Δ=${moved.toFixed(2)}`);
const cam1 = await ev2(`(() => { const p = window.appState.camera.position; return { x: p.x, y: p.y, z: p.z }; })()`);
const camMoved = Math.hypot(cam1.x - cam0.x, cam1.y - cam0.y) + Math.hypot(cam1.z - cam0.z);
check('拖拽期间相机未旋转（OrbitControls 被挡）', camMoved < 0.01, `Δ=${camMoved.toFixed(4)}`);
const dragCleared = await ev2(`(async () => (await import('./modules/MoveMode/shared.js')).drag3DNode)()`);
check('touchend 收尾 → drag3DNode 复位', dragCleared === false, 'drag3DNode=' + dragCleared);

// ── 移动模式快速点按节点 → 选中（用桌面 raycaster 预校验命中点 + 全链路诊断）──
await ev2(`(async () => {
  // 诊断钩子：click 到达日志 / selectedNodeIds 变更日志 / 未捕获错误
  window.__diag = { clicks: [], sel: [], errs: [], probes: [] };
  window.addEventListener('error', e => window.__diag.errs.push(String(e.message)));
  const cv = window.appState.renderer.domElement;
  cv.addEventListener('click', e => window.__diag.clicks.push({ x: e.clientX, y: e.clientY }));
  const sid = window.appState.selectedNodeIds;
  const oAdd = sid.add.bind(sid), oClear = sid.clear.bind(sid), oDel = sid.delete.bind(sid);
  sid.add = a => { window.__diag.sel.push(['add', a]); return oAdd(a); };
  sid.clear = () => { window.__diag.sel.push(['clear']); return oClear(); };
  sid.delete = a => { window.__diag.sel.push(['del', a]); return oDel(a); };

  const s = await import('./modules/MoveMode/shared.js');
  const rect = cv.getBoundingClientRect();
  const p = window.appState.positions.get(s.moveTargetId).clone().project(window.appState.camera);
  const cx = rect.left + (p.x + 1) / 2 * rect.width, cy = rect.top + (-p.y + 1) / 2 * rect.height;
  const ray = s.ray, mouse = s.mouse;
  const lines = window.appState.lineItems.map(it => it.line.mesh);
  // 优先找「节点命中且不压线」的点（模拟用户点在节点球体上的真实行为）；
  // 同时记录每个探测点的节点/连线命中情况，观察桌面 click 处理器在该点的真实分支
  let hit = null;
  for (const [dx, dy] of [[0, 0], [12, 0], [0, 12], [-12, 0], [0, -12], [20, 14], [-20, -14], [8, -8]]) {
    mouse.x = ((cx + dx) / rect.width) * 2 - 1;
    mouse.y = -((cy + dy) / rect.height) * 2 + 1;
    ray.setFromCamera(mouse, window.appState.camera);
    const nodeHits = ray.intersectObjects(s.getRaycastTargets(), true);
    const lineN = ray.intersectObjects(lines).length;
    const nid = nodeHits.length ? s.getHitNodeId(nodeHits) : null;
    window.__diag.probes.push({ dx, dy, nid: nid === s.moveTargetId ? 'target' : nid, lineN });
    if (!hit && lineN === 0 && nid === s.moveTargetId) hit = { x: Math.round(cx + dx), y: Math.round(cy + dy) };
  }
  if (!hit) hit = { x: Math.round(cx), y: Math.round(cy) }; // 兜底：中心点观察桌面真实行为
  window.__diag.tapAt = hit;
  const fire = ${fire};
  fire('pointerdown', hit.x, hit.y);
  fire('touchstart', hit.x, hit.y);
  await new Promise(r => setTimeout(r, 100));
  fire('touchend', hit.x, hit.y);
  await new Promise(r => setTimeout(r, 400));
  return true;
})()`);
const sel = await ev2(`window.appState.selectedNodeIds.has(${JSON.stringify(node.id)})`);
const tapDbg = await ev2(`JSON.stringify({
  selSize: window.appState.selectedNodeIds.size,
  selIds: [...window.appState.selectedNodeIds].slice(0, 3),
  lineTip: document.getElementById('lineTooltip') ? document.getElementById('lineTooltip').style.display : 'none-el',
  diag: window.__diag
})`);
check('移动模式快速点按 → 节点选中', sel === true, 'selected=' + sel + ' dbg=' + tapDbg);

// ── 退出移动模式（不保存，恢复原位）──
await ev2(`(async () => {
  const m = await import('./modules/MoveMode/move-mode/move-core.js');
  m.exitMoveMode(false);
  return true;
})()`);
await sleep(300);
const pos2 = await ev2(`(() => { const p = window.appState.positions.get(${JSON.stringify(node.id)}); return { x: p.x, y: p.y, z: p.z }; })()`);
const restored = Math.hypot(pos2.x - pos0.x, pos2.y - pos0.y) + Math.hypot(pos2.z - pos0.z);
const barGone = await ev2(`document.getElementById('moveControlBar').style.display`);
check('退出移动模式 → 位置恢复 + 控制条隐藏', restored < 0.01 && barGone === 'none', `Δ=${restored.toFixed(3)} bar=${barGone}`);

// ── 回归2：非移动模式长按空白 → 空白菜单（raycaster 预校验该点确实无命中）──
const blankPt = await ev2(`(async () => {
  const s = await import('./modules/MoveMode/shared.js');
  const cv = window.appState.renderer.domElement, rect = cv.getBoundingClientRect();
  const lines = window.appState.lineItems.map(it => it.line.mesh);
  for (let gy = 0.15; gy <= 0.85; gy += 0.1) {
    for (let gx = 0.08; gx <= 0.9; gx += 0.08) {
      const x = rect.left + gx * rect.width, y = rect.top + gy * rect.height;
      s.mouse.x = (x / rect.width) * 2 - 1;
      s.mouse.y = -(y / rect.height) * 2 + 1;
      s.ray.setFromCamera(s.mouse, window.appState.camera);
      if (s.ray.intersectObjects(s.getRaycastTargets(), true).length) continue;
      if (s.ray.intersectObjects(lines).length) continue;
      return { x: Math.round(x), y: Math.round(y) };
    }
  }
  return null;
})()`);
check('找到 raycast 确认的空白点', !!blankPt, JSON.stringify(blankPt));
if (blankPt) {
  await ev2(`(async () => {
    const fire = ${fire};
    fire('pointerdown', ${blankPt.x}, ${blankPt.y}); fire('touchstart', ${blankPt.x}, ${blankPt.y});
    await new Promise(r => setTimeout(r, 750));
    fire('touchend', ${blankPt.x}, ${blankPt.y});
    await new Promise(r => setTimeout(r, 400));
    return true;
  })()`);
  const blankMenu = await ev2(`(() => {
    const b = document.getElementById('blankContextMenu');
    return { visible: b && b.style.display === 'flex' };
  })()`);
  check('回归：长按空白 → 空白菜单', !!blankMenu && blankMenu.visible, JSON.stringify(blankMenu));
}

const pass = results.filter(Boolean).length;
console.log(`\\n=== ${pass}/${results.length} 通过 ===`);
ws.close();
setTimeout(() => process.exit(pass === results.length ? 0 : 1), 300);
