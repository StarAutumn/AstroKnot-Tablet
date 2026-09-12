// 端到端验证：日记 + 快速笔记 文件层垫片（磁盘同步）
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
for (let i = 0; i < 25; i++) { if (await ev2('!!window.appState')) break; await sleep(1000); }
await sleep(2000);

const out = await ev2(`(async () => {
  const o = [];
  // ── 日记 API 存在性 ──
  o.push('日记API = ' + ['listDiaries','readDiary','saveDiary','deleteDiary'].map(k => k + ':' + (typeof window.api[k])).join(' '));
  // ── 日记增删改查 roundtrip（测试日期，结束删除不留痕） ──
  const D = '2099-01-01';
  await window.api.saveDiary(D, '<p>tablet parity test</p>');
  const rd = await window.api.readDiary(D);
  o.push('日记读回 = ' + (rd.success && rd.content === '<p>tablet parity test</p>' ? '通过' : '失败:' + JSON.stringify(rd)));
  const ls = await window.api.listDiaries();
  const idx = ls.diaries.find(e => e.date === D);
  o.push('日记索引 = ' + (idx && idx.title === 'tablet parity test' ? '通过' : '失败:' + JSON.stringify(ls.diaries)));
  await window.api.deleteDiary(D);
  const rd2 = await window.api.readDiary(D);
  o.push('日记删除 = ' + (!rd2.exists ? '通过' : '失败'));
  // ── 快速笔记：加载（应触发 localStorage 迁移）+ 保存 ──
  o.push('loadQuickNotes = ' + (typeof window.api.loadQuickNotes));
  const loaded = await window.api.loadQuickNotes({});
  o.push('笔记加载数 = ' + (loaded.success ? loaded.notes.length : '失败:' + loaded.error));
  const legacyGone = !localStorage.getItem('knowledge_graph_quick_notes');
  o.push('localStorage 旧键清除 = ' + (legacyGone ? '通过' : '仍存在'));
  const saveR = await window.api.saveQuickNotes({ savePath: null, notes: (window.appState.quickNotes || []).filter(n => !n._isDiary) });
  o.push('保存落盘 = ' + (saveR.success ? saveR.path : '失败:' + saveR.error));
  const manifest = await window.FSCore.readText('quicknotes/quicknotes.json').catch(() => null);
  o.push('磁盘清单 = ' + (manifest ? JSON.parse(manifest).length + ' 条' : '缺失'));
  return o.join('\\n');
})()`);
console.log(out);
ws.close();
process.exit(0);
