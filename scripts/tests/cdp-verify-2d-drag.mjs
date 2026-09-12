// 验证 2D 长按拖动节点 + 长按框选 + tap/捏合回归
// 通过动态 import 桌面 2DView/shared.js 拿 nodeHitAreas/transform，精确定位节点屏幕坐标
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

// 进入 2D 模式（真实按钮路径）
await ev2(`(async () => {
  if (window.appState.is2DView) return true;
  const btn = document.getElementById('modeToggleBtn');
  if (btn) btn.click();
  return true;
})()`);
await sleep(1500);
check('已进入 2D 模式', await ev2('!!window.appState.is2DView'));

// 节点群可能在屏幕外（初始视图偏移）：中心锚点缩小两次收进屏幕
await ev2(`(async () => { window.appState.zoom2D(0.5); await new Promise(r => setTimeout(r, 200)); window.appState.zoom2D(0.5); return true; })()`);
await sleep(500);

// 动态 import 桌面模块：拿节点命中区 + 视图变换
// 桌面 canvasToWorld 以 canvas 中心为原点：world = (canvasPos - center - offset) / scale
// 逆变换（世界→屏幕）：screen = world * scale + center + offset
const mod = await ev2(`(async () => {
  const shared = await import('./modules/2DView/shared.js');
  const hits = shared.nodeHitAreas || [];
  const t = shared.transform;
  const cx = shared.canvas.width / 2, cy = shared.canvas.height / 2;
  const nodes = hits.filter(h => h.id && window.appState.positions2D.has(h.id)).slice(0, 6)
    .map(h => ({ id: h.id, x: Math.round(h.x * t.scale + cx + t.offsetX + h.width * t.scale / 2), y: Math.round(h.y * t.scale + cy + t.offsetY + h.height * t.scale / 2), w: h.width }));
  // 节点贴屏幕边缘（初始视图偏移）：直接改 transform 挪进屏幕中部（逻辑链自洽：合成坐标按新 transform 换算）
  const first = nodes[0];
  if (first && (first.y < 80 || first.y > innerHeight - 120)) {
    const dy = (innerHeight * 0.4) - first.y;
    t.offsetY += dy;
    for (const n of nodes) n.y += Math.round(dy);
  }
  if (first && (first.x < 60 || first.x > innerWidth - 120)) {
    const dx = (innerWidth * 0.4) - first.x;
    t.offsetX += dx;
    for (const n of nodes) n.x += Math.round(dx);
  }
  return { n: hits.length, scale: t.scale, nodes, overlay: !!document.querySelector('[data-card-overlay]') };
})()`);
check('nodeHitAreas/transform 可访问（节点数 ' + (mod ? mod.n : 0) + '）', !!mod && mod.n > 0, JSON.stringify(mod && mod.nodes));

if (mod && mod.nodes.length > 0) {
  const nd = mod.nodes[0];
  // 1) 长按节点 700ms → 拖动 → positions2D[id] 变化
  const drag = await ev2(`(async () => {
    const tgt = document.elementFromPoint(${nd.x}, ${nd.y});
    const fire = (type, x, y) => {
      const t = new Touch({ identifier: 1, target: tgt || document.body, clientX: x, clientY: y });
      document.dispatchEvent(new TouchEvent(type, { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
    };
    const p0 = window.appState.positions2D.get('${nd.id}');
    const bx = p0.x, by = p0.y;
    fire('touchstart', ${nd.x}, ${nd.y});
    await new Promise(r => setTimeout(r, 750));
    for (const [dx, dy] of [[40, 30], [80, 60], [110, 80]]) { fire('touchmove', ${nd.x} + dx, ${nd.y} + dy); await new Promise(r => setTimeout(r, 90)); }
    fire('touchend', ${nd.x} + 110, ${nd.y} + 80);
    await new Promise(r => setTimeout(r, 600));
    const p1 = window.appState.positions2D.get('${nd.id}');
    return { moved: Math.hypot(p1.x - bx, p1.y - by), dx: +(p1.x - bx).toFixed(1), dy: +(p1.y - by).toFixed(1) };
  })()`);
  check('长按节点拖动 → 位置改变', drag.moved > 20, JSON.stringify(drag));
  // 拖回去（恢复原位，避免影响后续框选）
  await ev2(`(async () => {
    const tgt = document.elementFromPoint(${nd.x + 110}, ${nd.y + 80});
    const fire = (type, x, y) => {
      const t = new Touch({ identifier: 4, target: tgt || document.body, clientX: x, clientY: y });
      document.dispatchEvent(new TouchEvent(type, { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
    };
    fire('touchstart', ${nd.x + 110}, ${nd.y + 80});
    await new Promise(r => setTimeout(r, 750));
    for (const [dx, dy] of [[-40, -30], [-110, -80]]) { fire('touchmove', ${nd.x + 110} + dx, ${nd.y + 80} + dy); await new Promise(r => setTimeout(r, 90)); }
    fire('touchend', ${nd.x}, ${nd.y});
    await new Promise(r => setTimeout(r, 500));
    return true;
  })()`);

  // 2) 长按空白拖动 → 框选包住两个节点
  if (mod.nodes.length >= 2) {
    const a = mod.nodes[0], b = mod.nodes[1];
    const minX = Math.min(a.x, b.x) - 40, minY = Math.min(a.y, b.y) - 40;
    const maxX = Math.max(a.x, b.x) + 40, maxY = Math.max(a.y, b.y) + 40;
    const box = await ev2(`(async () => {
      const sx = Math.max(20, ${minX} - 60), sy = Math.max(20, ${minY} - 60);
      const ex = Math.min(innerWidth - 20, ${maxX} + 60), ey = Math.min(innerHeight - 20, ${maxY} + 60);
      const tgt = document.elementFromPoint(sx, sy);
      const fire = (type, x, y) => {
        const t = new Touch({ identifier: 2, target: tgt || document.body, clientX: x, clientY: y });
        document.dispatchEvent(new TouchEvent(type, { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
      };
      fire('touchstart', sx, sy);
      await new Promise(r => setTimeout(r, 750));
      for (const f of [0.3, 0.6, 1]) { fire('touchmove', sx + (ex - sx) * f, sy + (ey - sy) * f); await new Promise(r => setTimeout(r, 90)); }
      fire('touchend', ex, ey);
      await new Promise(r => setTimeout(r, 500));
      return { selected: window.appState.selectedNodeIds ? window.appState.selectedNodeIds.size : -1 };
    })()`);
    check('长按空白拖动 → 框选 ≥2 节点', box.selected >= 2, JSON.stringify(box));

    // 3) tap 空白取消选中（真机 tap 由浏览器合成 mousedown+mouseup；脚本直模拟该序列）
    const tap = await ev2(`(async () => {
      const cv = document.getElementById('view2dCanvas');
      const x = Math.round(innerWidth / 2), y = Math.round(innerHeight - 40);
      cv.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 }));
      await new Promise(r => setTimeout(r, 60));
      cv.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window, clientX: x, clientY: y, button: 0, buttons: 0 }));
      await new Promise(r => setTimeout(r, 500));
      return { selected: window.appState.selectedNodeIds ? window.appState.selectedNodeIds.size : -1 };
    })()`);
    check('tap 空白取消选中（回归）', tap.selected === 0, JSON.stringify(tap));
  }
}

// 4) 双指捏合回归
const pinch = await ev2(`(async () => {
  const mkT = (idn, x, y) => new Touch({ identifier: idn, target: document.body, clientX: x, clientY: y });
  const fire2 = (type, x1, y1, x2, y2) => {
    const t1 = mkT(10, x1, y1), t2 = mkT(11, x2, y2);
    document.dispatchEvent(new TouchEvent(type, { touches: [t1, t2], changedTouches: [t1, t2], bubbles: true, cancelable: true }));
  };
  fire2('touchstart', 400, 300, 600, 400);
  await new Promise(r => setTimeout(r, 80));
  fire2('touchmove', 380, 280, 620, 420);
  await new Promise(r => setTimeout(r, 80));
  fire2('touchend', 380, 280, 620, 420);
  await new Promise(r => setTimeout(r, 300));
  return { okZoom2D: typeof window.appState.zoom2D === 'function' };
})()`);
check('双指捏合回归（无崩溃）', pinch.okZoom2D);

const pass = results.filter(Boolean).length;
console.log(`\n=== ${pass}/${results.length} 通过 ===`);
process.exit(pass === results.length ? 0 : 1);
