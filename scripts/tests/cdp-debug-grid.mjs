// 一次性：诊断网格吸附未生效
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pend.set(i, { res });
  ws.send(JSON.stringify({ id: i, method, params }));
});
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.res(m.result); }
};
ws.onopen = async () => {
  await send('Runtime.enable');
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  const out = await ev(`(() => {
    const icons = [...document.querySelectorAll('#desktopIconsLayer .desktop-icon')].map(i => ({
      id: i.dataset.appId, src: i.dataset.source, left: i.style.left, top: i.style.top
    }));
    return {
      gridMode: window.appState.dockGridMode,
      positions: JSON.parse(localStorage.getItem('astroknot-desktop-icon-positions') || '{}'),
      icons,
      patchApplied: String(window.AppPanel._onGridModeChange).includes('_snapToGridWithCollision')
    };
  })()`);
  console.log(JSON.stringify(out, null, 1));
  // 手动触发一次 _onGridModeChange 看变化
  const after = await ev(`(() => {
    window.AppPanel._onGridModeChange();
    return [...document.querySelectorAll('#desktopIconsLayer .desktop-icon')].map(i => i.dataset.appId + '@' + i.style.left + ',' + i.style.top);
  })()`);
  console.log('手动 _onGridModeChange 后:', JSON.stringify(after, null, 1));
  process.exit(0);
};
