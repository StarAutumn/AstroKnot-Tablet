// 验证原生浏览器增强：多标签 / 书签 / 历史 / onNewIntent 复用
const { execSync } = await import('node:child_process');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ADB = (cmd) => execSync(`adb shell ${cmd}`, { encoding: 'utf8' }).toString();

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log((ok ? '✓ PASS' : '✗ FAIL') + '  ' + name + (detail ? '  — ' + detail : '')); };

// ── CDP 连主应用 WebView ──
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page' && p.url.startsWith('https://localhost'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const ev2 = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;

await sleep(3000);
for (let i = 0; i < 20; i++) { if (await ev2('!!window.appState')) break; await sleep(1000); }
await sleep(1500);
await ev2(`(() => { const el = document.getElementById('startPage'); if (el) el.style.display = 'none'; return true; })()`);

execSync('adb logcat -c');

// uiautomator 抓原生控件
async function dumpUi() {
  try {
    ADB('uiautomator dump /sdcard/uidump.xml');
    return ADB('cat /sdcard/uidump.xml');
  } catch (e) { return ''; }
}
async function tapText(xml, text) {
  const esc = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`text="${esc}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
  const m = xml.match(re);
  if (!m) return false;
  const cx = Math.round((+m[1] + +m[3]) / 2), cy = Math.round((+m[2] + +m[4]) / 2);
  ADB(`input tap ${cx} ${cy}`);
  return true;
}

// 1. 打开第一个标签
await ev2(`window.Capacitor.Plugins.StoragePerm.openInApp({ url: 'https://example.com' })`);
await sleep(4500);
let xml = await dumpUi();
const hasTopBar = xml.includes('text="☆"') && xml.includes('text="⏱"') && xml.includes('text="✕"');
check('增强顶栏渲染（✕/☆/⏱/导航）', hasTopBar);
const tabTitles1 = (xml.match(/text="Example Domain"/g) || []).length;
check('第一标签加载（标题 Example Domain）', tabTitles1 >= 1, 'count=' + tabTitles1);

// 2. 再次触发 → onNewIntent 新标签（singleTask 复用实例）
await ev2(`window.Capacitor.Plugins.StoragePerm.openInApp({ url: 'https://example.org' })`);
await sleep(4000);
xml = await dumpUi();
const tabsNow = (xml.match(/Example Domain|Example Domain 2|example\.org|Example Org/g) || []).length;
const twoChips = (xml.match(/text=" ✕"/g) || []).length;
check('onNewIntent 复用实例新开标签（2 个 ✕ chip）', twoChips >= 2, 'chips=' + twoChips);

// 3. 点 ☆ 收藏
await tapText(xml, '☆');
await sleep(1200);
let lc = execSync('adb logcat -d -s AstroBrowser:I 2>&1', { encoding: 'utf8' }).toString();
check('书签添加（logcat）', lc.includes('bookmark added'), lc.split('\n').filter(l => l.includes('bookmark')).slice(-1)[0]?.slice(-60) || '');

// 4. 历史记录已写入
check('历史记录写入（logcat）', lc.includes('history saved'), '');

// 5. ⏱ 打开历史面板
xml = await dumpUi();
await tapText(xml, '⏱');
await sleep(1500);
xml = await dumpUi();
check('历史面板打开', xml.includes('历史记录'), '');
ADB('input keyevent KEYCODE_BACK'); // 关对话框
await sleep(1200);

// 6. 返回键回主应用
ADB('input keyevent KEYCODE_BACK');
await sleep(3500);
let backOk = false;
try {
  const act = execSync('adb shell dumpsys activity activities 2>&1', { encoding: 'utf8' }).toString();
  const line = (act.match(/(?:topResumedActivity|mResumedActivity)[^\n]*/) || [''])[0];
  backOk = line.includes('MainActivity');
} catch (e) { }
check('返回键回主应用', backOk);

const pass = results.filter(Boolean).length;
console.log(`\n=== ${pass}/${results.length} 通过 ===`);
process.exit(pass === results.length ? 0 : 1);
