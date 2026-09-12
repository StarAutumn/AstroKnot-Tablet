// 验证 2D 框选 → 多选菜单（新建群组）→ 群组菜单（改名/删除）全链路 + 长按拖动回归
// 手势约定：长按框选区内空白=多选菜单；长按后原地松手=右键菜单（节点/群组/空白）；长按后拖动=拖拽
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

// 进 2D 模式
await ev2(`(() => { if (!window.appState.is2DView) { const b = document.getElementById('modeToggleBtn'); if (b) b.click(); } return true; })()`);
await sleep(1500);
check('已进入 2D 模式', await ev2('!!window.appState.is2DView'));

// 关闭启动首页（若开着会盖住画布，touch-gestures 判定 in2DContainer=false 不接管手势）
const spClosed = await ev2(`(async () => {
  const sp = document.getElementById('startPage');
  if (sp && sp.style.display !== 'none' && getComputedStyle(sp).display !== 'none') {
    const m = await import('./modules/StartPage/index.js');
    if (m.hideStartPage) { m.hideStartPage(); await new Promise(r => setTimeout(r, 1000)); }
  }
  const el = document.elementFromPoint(innerWidth * 0.5, innerHeight * 0.5);
  return { gone: !el || !el.closest('.start-page-container'), elAt: el ? (el.id || el.tagName) : 'null' };
})()`);
check('启动首页已关闭（画布可触达）', spClosed.gone, 'elAt=' + spClosed.elAt);

await ev2(`(() => { window.appState.zoom2D(0.6); return true; })()`);
await sleep(400);

// 节点屏幕坐标（同 cdp-verify-2d-drag 的换算）
const mod = await ev2(`(async () => {
  const shared = await import('./modules/2DView/shared.js');
  const hits = shared.nodeHitAreas || [];
  const t = shared.transform;
  const cx = shared.canvas.width / 2, cy = shared.canvas.height / 2;
  const nodes = hits.filter(h => h.id && window.appState.positions2D.has(h.id)).slice(0, 4)
    .map(h => ({ id: h.id, x: Math.round(h.x * t.scale + cx + t.offsetX + h.width * t.scale / 2), y: Math.round(h.y * t.scale + cy + t.offsetY + h.height * t.scale / 2) }));
  const first = nodes[0];
  if (first) {
    if (first.y < 150 || first.y > innerHeight - 250) { const dy = (innerHeight * 0.4) - first.y; t.offsetY += dy; for (const n of nodes) n.y += Math.round(dy); }
    if (first.x < 150 || first.x > innerWidth - 250) { const dx = (innerWidth * 0.4) - first.x; t.offsetX += dx; for (const n of nodes) n.x += Math.round(dx); }
  }
  return { nodes, touchPatch: !!document.body };
})()`);
check('节点坐标可访问（' + (mod?.nodes?.length || 0) + ' 个）', !!mod && mod.nodes.length >= 2);

if (mod && mod.nodes.length >= 2) {
  const [a, b] = mod.nodes;
  const fire = `(type, x, y) => {
    const tgt = document.elementFromPoint(x, y) || document.body;
    const t = new Touch({ identifier: 7, target: tgt, clientX: x, clientY: y });
    document.dispatchEvent(new TouchEvent(type, { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
  }`;

  // 1) 长按空白拖动 → 框选 2 节点
  const minX = Math.min(a.x, b.x) - 70, minY = Math.min(a.y, b.y) - 70;
  const maxX = Math.max(a.x, b.x) + 70, maxY = Math.max(a.y, b.y) + 70;
  await ev2(`(async () => {
    const fire = ${fire};
    fire('touchstart', ${minX - 50}, ${minY - 50});
    await new Promise(r => setTimeout(r, 750));
    for (const f of [0.4, 0.7, 1]) { fire('touchmove', ${minX - 50} + (${maxX + 50} - ${minX - 50}) * f, ${minY - 50} + (${maxY + 50} - ${minY - 50}) * f); await new Promise(r => setTimeout(r, 90)); }
    fire('touchend', ${maxX + 50}, ${maxY + 50});
    await new Promise(r => setTimeout(r, 500));
    return true;
  })()`);
  const sel = await ev2('window.appState.selectedNodeIds ? window.appState.selectedNodeIds.size : -1');
  check('长按空白拖动 → 框选 ≥2 节点', sel >= 2, 'selected=' + sel);

  // 2) 长按框选区内空白（两节点中点）→ 多选菜单（含新建群组）
  const midX = Math.round((a.x + b.x) / 2), midY = Math.round((a.y + b.y) / 2);
  await ev2(`(async () => {
    const fire = ${fire};
    fire('touchstart', ${midX}, ${midY});
    await new Promise(r => setTimeout(r, 750));
    fire('touchend', ${midX}, ${midY});
    await new Promise(r => setTimeout(r, 500));
    return true;
  })()`);
  const menu1 = await ev2(`(() => {
    const m = document.getElementById('nodeContextMenu');
    return { visible: m && m.style.display !== 'none', groupRow: document.getElementById('groupRow')?.style.display, name: document.getElementById('contextNodeName')?.textContent };
  })()`);
  check('长按框选区空白 → 多选菜单（含新建群组行）', !!menu1 && menu1.visible && menu1.groupRow === 'flex', JSON.stringify(menu1));

  // 3) 点击「新建群组」→ groupRects 生成
  await ev2(`(() => { const btn = document.getElementById('groupNodesBtn'); if (btn) btn.click(); return true; })()`);
  await sleep(500);
  const gr1 = await ev2(`(async () => {
    const shared = await import('./modules/2DView/shared.js');
    return { count: shared.groupRects.length, ids: shared.groupRects.map(g => g.nodeIds.length) };
  })()`);
  check('新建群组 → groupRects 生成（含节点）', gr1.count >= 1 && gr1.ids[0] >= 2, JSON.stringify(gr1));

  // 4) 长按群组矩形内空白原地松手 → 群组菜单
  await ev2(`(async () => {
    const fire = ${fire};
    fire('touchstart', ${midX}, ${midY});
    await new Promise(r => setTimeout(r, 750));
    fire('touchend', ${midX}, ${midY});
    await new Promise(r => setTimeout(r, 500));
    return true;
  })()`);
  const gmenu = await ev2(`(() => {
    const m = document.getElementById('groupContextMenu');
    return { visible: m && m.style.display !== 'none' };
  })()`);
  check('长按群组矩形 → 群组菜单弹出', !!gmenu && gmenu.visible, JSON.stringify(gmenu));

  // 5) 群组改名（input 事件链）
  await ev2(`(() => {
    const inp = document.getElementById('groupNameInput');
    inp.value = '测试群组';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(300);
  const gr2 = await ev2(`(async () => (await import('./modules/2DView/shared.js')).groupRects.map(g => g.name))()`);
  check('群组改名同步到 groupRects', gr2.includes('测试群组'), JSON.stringify(gr2));

  // 6) 删除群组
  await ev2(`(() => { const btn = document.getElementById('deleteGroupRectBtn'); if (btn) btn.click(); return true; })()`);
  await sleep(400);
  const gr3 = await ev2(`(async () => (await import('./modules/2DView/shared.js')).groupRects.length)()`);
  check('删除群组 → groupRects 清空', gr3 === 0, 'count=' + gr3);

  // 7) 回归：长按节点原地松手 → 节点菜单
  await ev2(`(async () => {
    const fire = ${fire};
    fire('touchstart', ${a.x}, ${a.y});
    await new Promise(r => setTimeout(r, 750));
    fire('touchend', ${a.x}, ${a.y});
    await new Promise(r => setTimeout(r, 500));
    return true;
  })()`);
  const nmenu = await ev2(`(() => {
    const m = document.getElementById('nodeContextMenu');
    return { visible: m && m.style.display !== 'none', sel: window.appState.selectedNodeIds.size };
  })()`);
  check('长按节点原地松手 → 节点菜单', !!nmenu && nmenu.visible, JSON.stringify(nmenu));
  await ev2(`(() => { const m = document.getElementById('nodeContextMenu'); if (m) m.style.display = 'none'; return true; })()`);

  // 8) 回归：长按节点拖动 → 位置变化
  const drag = await ev2(`(async () => {
    const fire = ${fire};
    const p0 = window.appState.positions2D.get('${a.id}');
    fire('touchstart', ${a.x}, ${a.y});
    await new Promise(r => setTimeout(r, 750));
    for (const [dx, dy] of [[40, 30], [90, 60]]) { fire('touchmove', ${a.x} + dx, ${a.y} + dy); await new Promise(r => setTimeout(r, 90)); }
    fire('touchend', ${a.x} + 90, ${a.y} + 60);
    await new Promise(r => setTimeout(r, 600));
    const p1 = window.appState.positions2D.get('${a.id}');
    return { moved: Math.round(Math.hypot(p1.x - p0.x, p1.y - p0.y)) };
  })()`);
  check('回归：长按节点拖动仍工作', drag.moved > 20, JSON.stringify(drag));
}

const pass = results.filter(Boolean).length;
console.log(`\n=== ${pass}/${results.length} 通过 ===`);
ws.close();
process.exit(pass === results.length ? 0 : 1);
