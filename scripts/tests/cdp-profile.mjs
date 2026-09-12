// 重载页面并抓取完整启动期 CPU profile，输出热点函数排行
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
};
const wait = (ms) => new Promise(r => setTimeout(r, ms));

ws.onopen = async () => {
  try {
    await send('Profiler.enable');
    await send('Page.enable');
    console.log('启动 CPU 采样…');
    await send('Profiler.start');
    await send('Page.reload', { ignoreCache: true });

    // 轮询等加载完成（DCL 或超时）
    let ready = false;
    for (let i = 0; i < 110; i++) {
      await wait(1000);
      try {
        const r = await send('Runtime.evaluate', {
          expression: 'document.readyState === "complete" && performance.now() > 30000 ? "done" : document.readyState',
          returnByValue: true
        });
        if (r.result?.value === 'done') { ready = true; break; }
      } catch { /* reload 瞬间 evaluate 可能失败，继续等 */ }
    }
    console.log(ready ? '加载完成，停止采样…' : '超时 110s，停止采样…');
    const { profile } = await send('Profiler.stop');

    // 聚合自采样时间（self time）按函数
    const nodes = new Map(profile.nodes.map(n => [n.id, n]));
    const self = new Map(); // key: "fn (file:line)"
    const dt = (profile.timeDeltas || []).map(d => Math.max(0, d)); // 微秒
    profile.samples?.forEach((nodeId, i) => {
      const n = nodes.get(nodeId);
      if (!n) return;
      const f = n.callFrame;
      if (!f.functionName && f.url === '') return; // 跳过匿名 idle
      const url = f.url ? f.url.replace('https://localhost/', '') : '';
      const key = (f.functionName || '(anonymous)') + ' @ ' + url + ':' + f.lineNumber;
      self.set(key, (self.get(key) || 0) + (dt[i] || 0));
    });
    const totalUs = dt.reduce((a, b) => a + b, 0);
    console.log('总采样: ' + (totalUs / 1e6).toFixed(1) + 's，热点函数 Top 30（self time）:');
    [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, v], idx) => {
      console.log(String(idx + 1).padStart(2) + '. ' + (v / 1e6).toFixed(2) + 's  ' + k);
    });
  } catch (e) {
    console.error('诊断出错:', e.message);
  } finally {
    try { ws.close(); } catch { }
    setTimeout(() => process.exit(0), 500);
  }
};
ws.onerror = (e) => { console.error('WS错误', e.message || e); process.exit(1); };
