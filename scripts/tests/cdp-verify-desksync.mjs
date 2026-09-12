// 验证平板「从电脑同步」（配对码模式）全链路
// 前提：PC 桌面版运行中（服务常驻），配对码已知，平板与 PC 同一局域网
// 用法：DESKSYNC_HOST=192.168.1.4:8899 DESKSYNC_CODE=abc888 node scripts/tests/cdp-verify-desksync.mjs
// 流程：垫片加载 → WebView 连桌面服务(200/401) → GitHub 弹窗📱入口 →
//       填 conn 拉列表 → 导入临时项目 → 文件层/清单/会话三断言 → 重开预填 → 清理
import fs from 'node:fs';
import path from 'node:path';

const HOST = process.env.DESKSYNC_HOST || '192.168.1.4:8899';
const CODE = process.env.DESKSYNC_CODE || 'abc888';
const TMP_DIR = 'tmp-desksync-test';
const DESKTOP_PROJECTS = 'd:/AstroKnot/AstroKnot-Data/projects';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log((ok ? '✓ PASS' : '✗ FAIL') + '  ' + name + (detail ? '  — ' + detail : '')); };

// ── 桌面端造临时同步项目（真实走桌面打包管线） ──
const tmpAbs = path.join(DESKTOP_PROJECTS, TMP_DIR);
fs.rmSync(tmpAbs, { recursive: true, force: true });
fs.mkdirSync(path.join(tmpAbs, 'nodes', '测试节点_N12345678'), { recursive: true });
fs.writeFileSync(path.join(tmpAbs, 'project.json'), JSON.stringify({
  projectName: TMP_DIR,
  methodsTree: { id: 'root', name: '根', children: [{ id: 'N12345678', name: '测试节点', children: [] }] },
  nodeRichContents: { N12345678: '<p>hello desksync</p>' },
  overlayImages: {}, nodeFileSystems: {},
  positions2D: { N12345678: { x: 0, y: 0 } },
}, null, 2));
fs.writeFileSync(path.join(tmpAbs, 'nodes', '测试节点_N12345678', 'content.html'), '<p>hello desksync</p>');
const cleanupDesktop = () => { try { fs.rmSync(tmpAbs, { recursive: true, force: true }); } catch (_) {} };

const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page' && p.url.startsWith('https://localhost'));
if (!page) { console.log('✗ 未找到平板页面，先重启 app 并转发 CDP'); cleanupDesktop(); process.exit(1); }
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

try {
  // 1. 垫片加载
  check(' desksync-shim 已加载（window.__DeskSync）', await ev2('!!(window.__DeskSync && window.__DeskSync.openDialog)'));

  // 2. WebView → 桌面服务连通 + 认证
  const net = await ev2(`(async () => {
    const out = {};
    try { const r = await fetch('http://${HOST}/'); out.landing = r.status; } catch (e) { out.landingErr = e.message; }
    try { const r = await fetch('http://${HOST}/api/info?t=badcode'); out.bad = r.status; } catch (e) { out.badErr = e.message; }
    try { const r = await fetch('http://${HOST}/api/info?t=${CODE}'); out.ok = r.status; out.n = (await r.json()).projects.length; } catch (e) { out.okErr = e.message; }
    return out;
  })()`);
  check('WebView 可达桌面服务（落地页 200）', net.landing === 200, JSON.stringify(net));
  check('错误配对码 → 401', net.bad === 401, JSON.stringify(net));
  check('正确配对码 → 200 + 项目列表（含临时项目）', net.ok === 200 && net.n >= 1, JSON.stringify(net));
  if (net.landingErr) { console.log('⚠ 网络不通（平板与 PC 需同一局域网），终止'); ws.close(); cleanupDesktop(); process.exit(1); }

  // 3. 入口链路：GitHub 弹窗 → 📱 → __DeskSync.openDialog
  await ev2(`(() => {
    window.__openDialogCalls = 0;
    const orig = window.__DeskSync.openDialog.bind(window.__DeskSync);
    window.__DeskSync.openDialog = function (o) { window.__openDialogCalls++; return orig(o); };
    document.getElementById('githubLoginBtn').click();
    return true;
  })()`);
  await sleep(1200);
  const ghOpen = await ev2(`(() => {
    const btn = document.getElementById('ghMobileSyncBtn');
    if (!btn) return { found: false };
    btn.click();
    return { found: true };
  })()`);
  await sleep(600);
  const dlg = await ev2(`(() => {
    const ov = document.getElementById('deskSyncOverlay');
    return { calls: window.__openDialogCalls, visible: ov ? getComputedStyle(ov).display : 'missing' };
  })()`);
  check('GitHub 弹窗📱按钮 → 平板同步弹窗打开', ghOpen.found && dlg.calls === 1 && dlg.visible === 'flex', JSON.stringify({ ghOpen, dlg }));

  // 4. 填 conn → 拉列表
  await ev2(`(() => {
    document.getElementById('ds-host').value = '${HOST}';
    document.getElementById('ds-token').value = '${CODE}';
    document.getElementById('ds-fetch').click();
    return true;
  })()`);
  await sleep(2500);
  const listState = await ev2(`(() => {
    const items = [...document.querySelectorAll('#deskSyncOverlay .ds-item .ds-item-name')].map(x => x.textContent);
    return { items, status: document.getElementById('ds-status').textContent, conn: localStorage.getItem('astroknot_desksync_conn') };
  })()`);
  check('连接 → 项目列表渲染（含临时项目）', listState.items.includes(TMP_DIR), JSON.stringify(listState));
  check('连接成功 → conn 持久化（localStorage）', !!listState.conn && listState.conn.includes(CODE), listState.conn);

  // 5. 导入临时项目
  await ev2(`(() => {
    const rows = [...document.querySelectorAll('#deskSyncOverlay .ds-item')];
    const row = rows.find(r => r.querySelector('.ds-item-name').textContent === '${TMP_DIR}');
    row.querySelector('.ds-item-btn').click();
    return true;
  })()`);
  let imported = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    imported = await ev2(`(async () => {
      const fsc = window.FSCore;
      try {
        const raw = await fsc.readText('projects/${TMP_DIR}/project.json');
        const pj = JSON.parse(raw);
        const inList = window.ProjectFsShim.getProjects().some(x => x.folderPath === 'projects/${TMP_DIR}');
        const inApp = !!(window.appState.projects && window.appState.projects.find(x => x.folderPath === 'projects/${TMP_DIR}'));
        return { ok: true, hasTree: !!pj.methodsTree, inList, inApp, status: document.getElementById('ds-status').textContent };
      } catch (e) { return { ok: false, err: e.message, status: document.getElementById('ds-status').textContent }; }
    })()`);
    if (imported.ok && imported.inList && imported.inApp) break;
  }
  check('导入 → 文件层 project.json 可读（含 methodsTree）', !!imported.ok && imported.hasTree, JSON.stringify(imported));
  check('导入 → ProjectFsShim 清单注册', !!imported.inList, JSON.stringify(imported));
  check('导入 → appState.projects 当前会话可见', !!imported.inApp, JSON.stringify(imported));

  // 6. 重开弹窗预填（持续配对）
  await ev2(`(() => { document.getElementById('ds-close').click(); window.__DeskSync.openDialog(); return true; })()`);
  await sleep(500);
  const refill = await ev2(`(() => ({
    host: document.getElementById('ds-host').value,
    token: document.getElementById('ds-token').value,
    status: document.getElementById('ds-status').textContent,
  }))()`);
  check('重开弹窗 → conn 预填并自动拉列表', refill.host === HOST && refill.token === CODE, JSON.stringify(refill));
  await ev2(`(() => { document.getElementById('ds-close').click(); return true; })()`);

  // 7. 清理（平板文件层临时项目目录；内存清单残留重启 app 后自动消失）
  const cleaned = await ev2(`(async () => { await window.FSCore.rmrf('projects/${TMP_DIR}'); return true; })()`);
  check('清理平板临时项目目录', cleaned === true);
} catch (e) {
  console.log('✗ 异常中断:', e.message);
  results.push(false);
} finally {
  ws.close();
  cleanupDesktop();
}

const pass = results.filter(Boolean).length;
console.log(`\\n=== ${pass}/${results.length} 通过 ===`);
process.exit(pass === results.length ? 0 : 1);
