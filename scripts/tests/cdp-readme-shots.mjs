// README 截图：启动首页 / 桌面图标 / 浏览器窗口
const { execSync } = await import('node:child_process');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const shot = (name) => {
  execSync(`adb shell screencap -p /sdcard/${name}.png`);
  execSync(`adb pull /sdcard/${name}.png assets/${name}.png 2>&1`, { stdio: 'ignore', cwd: 'd:/AstroKnot-Tablet' });
  console.log('已保存 assets/' + name + '.png');
};
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page' && p.url.startsWith('https://localhost'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const ev2 = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;

await sleep(2500);
for (let i = 0; i < 20; i++) { if (await ev2('!!window.appState')) break; await sleep(1000); }
await sleep(2500); // 等启动期重渲染稳定

// 1. 启动首页（保持显示状态）
shot('readme-startpage');

// 2. 桌面图标模式（关首页 + 清引导弹窗）
await ev2(`(() => {
  const el = document.getElementById('startPage'); if (el) el.style.display = 'none';
  document.querySelectorAll('[class*="guide"], [class*="Guide"]').forEach(el => el.remove());
  return true;
})()`);
await sleep(800);
shot('readme-desktop');

// 3. 浏览器窗口（起始页 + 工具栏）
await ev2(`(async () => {
  document.querySelectorAll('[class*="guide"], [class*="Guide"]').forEach(el => el.remove());
  if (!document.querySelector('iframe.app-browser-webview')) {
    await window.AppRunner.open({ id: 'builtin-browser', type: 'browser', defaultUrl: 'https://www.bing.com' });
  }
  await new Promise(r => setTimeout(r, 2500));
  return true;
})()`);
shot('readme-browser');
process.exit(0);
