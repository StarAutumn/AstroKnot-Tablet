// 验证虚拟摇杆：DOM 存在、2D/3D 显隐、合成键盘事件驱动移动状态
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let msgId = 0; const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
};
const wait = (ms) => new Promise(r => setTimeout(r, ms));
ws.onopen = async () => {
  try {
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      return r.result?.value;
    };
    console.log('--- 摇杆 DOM ---');
    console.log(await evalJs(`
      JSON.stringify({
        root: !!document.getElementById('vk-root'),
        stick: !!document.getElementById('vk-stick'),
        nub: !!document.getElementById('vk-nub'),
        btnUp: !!document.getElementById('vk-up'),
        btnDown: !!document.getElementById('vk-down'),
        btnsDisplay: getComputedStyle(document.getElementById('vk-btns')||document.body).display,
        is2DView: appState.is2DView
      })
    `));
    console.log('--- 2D 平移联动测试（合成 w 按下 300ms 后观察 canvas 偏移）---');
    const before = await evalJs('appState.offset2D ? JSON.stringify(appState.offset2D) : (appState.view2D ? JSON.stringify(appState.view2D) : "无offset字段")');
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'w',bubbles:true,cancelable:true}))`);
    await wait(400);
    const after = await evalJs(`
      (function(){
        window.dispatchEvent(new KeyboardEvent('keyup',{key:'w',bubbles:true,cancelable:true}));
        return appState.offset2D ? JSON.stringify(appState.offset2D) : (appState.view2D ? JSON.stringify(appState.view2D) : "无offset字段");
      })()
    `);
    console.log('2D 偏移 前:', before, '→ 后:', after);
    console.log('--- 3D 键位状态测试（切 3D 后合成事件）---');
    console.log('3D 相机前:', await evalJs('JSON.stringify([appState.camera.position.x.toFixed(2), appState.camera.position.y.toFixed(2), appState.camera.position.z.toFixed(2)])'));
    // 模拟按 w 500ms（3D 每帧 0.08 速度 @50fps ≈ 2 单位）
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'w',bubbles:true,cancelable:true}))`);
    await wait(500);
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keyup',{key:'w',bubbles:true,cancelable:true}))`);
    console.log('3D 相机后:', await evalJs('JSON.stringify([appState.camera.position.x.toFixed(2), appState.camera.position.y.toFixed(2), appState.camera.position.z.toFixed(2)])'));
    // 升降按钮
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}))`);
    await wait(400);
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keyup',{key:' ',bubbles:true,cancelable:true}))`);
    console.log('空格升降后 Y:', await evalJs('appState.camera.position.y.toFixed(2)'));
  } catch (e) {
    console.error('验证出错:', e.message);
  } finally { ws.close(); setTimeout(() => process.exit(0), 300); }
};
ws.onerror = (e) => { console.error('WS错误', e.message || e); process.exit(1); };
