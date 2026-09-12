// 验证 2D 空白直接拖动框选（touch-gestures.js：裸 canvas 单指无需长按立即框选）+ 回归
// 链路：touchstart(裸空白) → 垫片立即合成 view2dCanvas mousedown（桌面 onMouseDown 启动框选）
//       → touchmove 合成 window mousemove（updateBoxSelectedNodes）→ touchend 合成 window
//       mouseup（finishBoxSelection 选中）；快速点按由 mouseup 链路去选中 + 补 click
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

// 预检：设备运行的 touch-gestures.js 必须含直接框选标记（防旧 APK 假失败）
const tgSrc = await ev2(`(async () => (await (await fetch('/js/touch-gestures.js')).text()))()`);
check('设备 touch-gestures.js 含空白直接框选标记', /hit0/.test(tgSrc) && /quickTap/.test(tgSrc), 'len=' + tgSrc.length);

// 前置：关启动首页 + 进入 2D
await ev2(`(async () => {
  const sp = document.getElementById('startPage');
  if (sp && sp.style.display !== 'none' && getComputedStyle(sp).display !== 'none') {
    const m = await import('./modules/StartPage/index.js');
    if (m.hideStartPage) { m.hideStartPage(); await new Promise(r => setTimeout(r, 1000)); }
  }
  if (!window.appState.is2DView) { const b = document.getElementById('modeToggleBtn'); if (b) b.click(); }
  return true;
})()`);
await sleep(1500);
check('已进入 2D 模式', await ev2('!!(window.appState && window.appState.is2DView && typeof window.appState.zoom2D === "function")'));

// 计算测试点位：2 个屏内节点 + 空白起点/终点（包容矩形）+ 独立空白点 + 框选区内空白点
// 坐标映射（与桌面/hit2DPoint 一致）：client = rect.left + wx*scale + cv.width/2 + offsetX
const pts = await ev2(`(async () => {
  const s = await import('./modules/2DView/shared.js');
  const cv = document.getElementById('view2dCanvas');
  const rect = cv.getBoundingClientRect();
  const toClient = (wx, wy) => ({
    x: Math.round(rect.left + wx * s.transform.scale + cv.width / 2 + s.transform.offsetX),
    y: Math.round(rect.top + wy * s.transform.scale + cv.height / 2 + s.transform.offsetY)
  });
  const hitAt = (x, y) => {
    const px = x - rect.left, py = y - rect.top;
    const wx = (px - cv.width / 2 - s.transform.offsetX) / s.transform.scale;
    const wy = (py - cv.height / 2 - s.transform.offsetY) / s.transform.scale;
    const onNode = s.nodeHitAreas.some(a => a.id && wx >= a.x && wx <= a.x + a.width && wy >= a.y && wy <= a.y + a.height);
    let onGroup = false;
    for (let i = s.groupRects.length - 1; i >= 0; i--) {
      const g = s.groupRects[i];
      if (g.layerId && g.layerId !== window.appState.currentLayerId) continue;
      if (wx >= g.x && wx <= g.x + g.width && wy >= g.y && wy <= g.y + g.height) { onGroup = true; break; }
    }
    let inMarquee = false;
    if (s.boxSelectNodeIds.size > 0) {
      const st = s.boxSelectCanvasStart, en = s.boxSelectCanvasEnd;
      inMarquee = px >= Math.min(st.x, en.x) - 5 && px <= Math.max(st.x, en.x) + 5 &&
                  py >= Math.min(st.y, en.y) - 5 && py <= Math.max(st.y, en.y) + 5;
    }
    return { onNode, onGroup, inMarquee };
  };
  // 选 2 个屏内（留边距）且相互分开的节点
  const W = innerWidth, H = innerHeight, ids = [];
  for (const [nid, p] of window.appState.positions2D) {
    const c = toClient(p.x, p.y);
    if (c.x > 150 && c.x < W - 150 && c.y > 150 && c.y < H - 200) ids.push({ id: nid, x: c.x, y: c.y });
  }
  ids.sort((a, b) => (b.x - a.x) + (b.y - a.y) - ((a.x - b.x) + (a.y - b.y)));
  const n1 = ids[0], n2 = ids.find(n => n.id !== ids[0].id && Math.abs(n.x - ids[0].x) + Math.abs(n.y - ids[0].y) > 200);
  if (!n1 || !n2) return { err: '屏内节点不足', count: ids.length };
  // 空白起点/终点：两节点外围各留 100px（全包含框选），钳在画布内
  const pStart = { x: Math.max(40, Math.min(n1.x, n2.x) - 100), y: Math.max(60, Math.min(n1.y, n2.y) - 100) };
  const pEnd = { x: Math.min(W - 40, Math.max(n1.x, n2.x) + 100), y: Math.min(H - 80, Math.max(n1.y, n2.y) + 100) };
  if (hitAt(pStart.x, pStart.y).onNode || hitAt(pEnd.x, pEnd.y).onNode) return { err: '起点/终点压节点' };
  // 独立空白点：左上角扫描（远离节点；必须落在裸 canvas 上——左上角有菜单等 UI 元素）
  let pFar = null;
  for (let gy = 80; gy < H - 120 && !pFar; gy += 40) {
    for (let gx = 40; gx < 260; gx += 40) {
      if (document.elementFromPoint(gx, gy) !== cv) continue;
      const h = hitAt(gx, gy);
      if (!h.onNode && !h.onGroup && !h.inMarquee) { pFar = { x: gx, y: gy }; break; }
    }
  }
  if (!pFar) return { err: '找不到独立空白点' };
  return { n1, n2, pStart, pEnd, pFar, hitStart: hitAt(pStart.x, pStart.y) };
})()`);
check('测试点位计算', !!pts && !pts.err, JSON.stringify(pts));
if (!pts || pts.err) { console.log('终止'); ws.close(); process.exit(1); }

const fire = `(type, x, y) => {
  const tgt = document.elementFromPoint(x, y) || document.body;
  const t = new Touch({ identifier: 7, target: tgt, clientX: x, clientY: y });
  document.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }));
  return true;
}`;

const clearSel = `window.appState.selectedNodeIds.clear(); true`;

// ── 1. 空白直接拖动 → 框选 ≥2 节点（手势总时长 <550ms，证明未走长按路径）──
await ev2(`(async () => {
  const fire = ${fire};
  ${clearSel};
  const t0 = Date.now();
  fire('touchstart', ${pts.pStart.x}, ${pts.pStart.y});
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    fire('touchmove', Math.round(${pts.pStart.x} + (${pts.pEnd.x} - ${pts.pStart.x}) * i / steps), Math.round(${pts.pStart.y} + (${pts.pEnd.y} - ${pts.pStart.y}) * i / steps));
    await new Promise(r => setTimeout(r, 30));
  }
  fire('touchend', ${pts.pEnd.x}, ${pts.pEnd.y});
  await new Promise(r => setTimeout(r, 400));
  window.__dragMs = Date.now() - t0;
  return true;
})()`);
const sel1 = await ev2(`(() => {
  const s = window.appState.selectedNodeIds;
  return { size: s.size, has1: s.has(${JSON.stringify(pts.n1.id)}), has2: s.has(${JSON.stringify(pts.n2.id)}) };
})()`);
check('空白直接拖动 → 框选 ≥2 节点', sel1.size >= 2 && sel1.has1 && sel1.has2, JSON.stringify(sel1) + ' 耗时=' + (await ev2('window.__dragMs')) + 'ms');

// ── 2. 空白快速点按 → 取消选中 ──
await ev2(`(async () => {
  const fire = ${fire};
  fire('touchstart', ${pts.pFar.x}, ${pts.pFar.y});
  await new Promise(r => setTimeout(r, 100));
  fire('touchend', ${pts.pFar.x}, ${pts.pFar.y});
  await new Promise(r => setTimeout(r, 300));
  return true;
})()`);
const sel2 = await ev2('window.appState.selectedNodeIds.size');
check('空白快速点按 → 取消选中', sel2 === 0, 'size=' + sel2);

// ── 3. 空白长按原地松手 → 空白菜单（回归）──
await ev2(`(async () => {
  const fire = ${fire};
  fire('touchstart', ${pts.pFar.x}, ${pts.pFar.y});
  await new Promise(r => setTimeout(r, 750));
  fire('touchend', ${pts.pFar.x}, ${pts.pFar.y});
  await new Promise(r => setTimeout(r, 400));
  return true;
})()`);
const menu3 = await ev2(`(() => { const m = document.getElementById('blankContextMenu'); return m ? m.style.display : 'none-el'; })()`);
check('空白长按 → 空白菜单', menu3 === 'flex', 'display=' + menu3);
await ev2(`(() => { const m = document.getElementById('blankContextMenu'); if (m) m.style.display = 'none'; return true; })()`);

// ── 4. 再框选 → 长按框选区内空白 → 多选菜单（回归 menuOnly 路径）──
await ev2(`(async () => {
  const fire = ${fire};
  fire('touchstart', ${pts.pStart.x}, ${pts.pStart.y});
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    fire('touchmove', Math.round(${pts.pStart.x} + (${pts.pEnd.x} - ${pts.pStart.x}) * i / steps), Math.round(${pts.pStart.y} + (${pts.pEnd.y} - ${pts.pStart.y}) * i / steps));
    await new Promise(r => setTimeout(r, 30));
  }
  fire('touchend', ${pts.pEnd.x}, ${pts.pEnd.y});
  await new Promise(r => setTimeout(r, 300));
  // 框选区内找非节点空白点（两节点几何中点附近扫描）
  const s = await import('./modules/2DView/shared.js');
  const cv = document.getElementById('view2dCanvas');
  const rect = cv.getBoundingClientRect();
  const hitAt = (x, y) => {
    const px = x - rect.left, py = y - rect.top;
    const wx = (px - cv.width / 2 - s.transform.offsetX) / s.transform.scale;
    const wy = (py - cv.height / 2 - s.transform.offsetY) / s.transform.scale;
    return s.nodeHitAreas.some(a => a.id && wx >= a.x && wx <= a.x + a.width && wy >= a.y && wy <= a.y + a.height);
  };
  let mid = null;
  for (const [fx, fy] of [[0.5, 0.5], [0.35, 0.5], [0.65, 0.5], [0.5, 0.35], [0.5, 0.65]]) {
    const x = Math.round(${pts.pStart.x} + (${pts.pEnd.x} - ${pts.pStart.x}) * fx);
    const y = Math.round(${pts.pStart.y} + (${pts.pEnd.y} - ${pts.pStart.y}) * fy);
    if (!hitAt(x, y)) { mid = { x, y }; break; }
  }
  if (!mid) throw new Error('框选区内无空白点');
  window.__mid = mid;
  fire('touchstart', mid.x, mid.y);
  await new Promise(r => setTimeout(r, 750));
  fire('touchend', mid.x, mid.y);
  await new Promise(r => setTimeout(r, 400));
  return true;
})()`);
const menu4 = await ev2(`(() => {
  const m = document.getElementById('nodeContextMenu');
  return m ? { display: m.style.display, groupRow: document.getElementById('groupRow')?.style.display } : 'none-el';
})()`);
check('长按框选区内空白 → 多选菜单', !!menu4 && menu4.display === 'flex' && menu4.groupRow === 'flex', JSON.stringify(menu4));
await ev2(`(() => { const m = document.getElementById('nodeContextMenu'); if (m) m.style.display = 'none'; return true; })()`);

// ── 5. 节点卡片快速点按 → 选中（回归：armed 路径不吞原生点击；真机浏览器会合成
//     mousedown→mouseup→click，其中卡片 overlay 的 mousedown 处理器转发到 canvas 走选中链）──
await ev2(`(async () => {
  const fire = ${fire};
  ${clearSel};
  fire('touchstart', ${pts.n1.x}, ${pts.n1.y});
  await new Promise(r => setTimeout(r, 100));
  fire('touchend', ${pts.n1.x}, ${pts.n1.y});
  // 真机上浏览器会在 touchend 后于落点元素上合成 mousedown/mouseup/click，这里等效模拟
  const tgt = document.elementFromPoint(${pts.n1.x}, ${pts.n1.y});
  const opts = (btns) => ({ bubbles: true, cancelable: true, view: window, clientX: ${pts.n1.x}, clientY: ${pts.n1.y}, button: 0, buttons: btns });
  if (tgt) {
    tgt.dispatchEvent(new MouseEvent('mousedown', opts(1)));
    tgt.dispatchEvent(new MouseEvent('mouseup', opts(0)));
    tgt.dispatchEvent(new MouseEvent('click', opts(0)));
  }
  await new Promise(r => setTimeout(r, 300));
  return true;
})()`);
const sel5 = await ev2(`window.appState.selectedNodeIds.has(${JSON.stringify(pts.n1.id)})`);
check('节点卡片快速点按 → 选中', sel5 === true, 'selected=' + sel5 + ' el=' + (await ev2(`(document.elementFromPoint(${pts.n1.x}, ${pts.n1.y}) || {}).className`)));

const pass = results.filter(Boolean).length;
console.log(`\n=== ${pass}/${results.length} 通过 ===`);
ws.close();
setTimeout(() => process.exit(pass === results.length ? 0 : 1), 300);
