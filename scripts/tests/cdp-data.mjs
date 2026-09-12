// 检查平板上项目数据链路现状
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
ws.onopen = async () => {
  try {
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      return r.result?.value;
    };
    console.log('appState.projects.length:', await evalJs('window.appState ? appState.projects.length : "appState不可达"'));
    console.log('currentProjectId:', await evalJs('appState.currentProjectId'));
    console.log('当前项目节点数:', await evalJs('appState.methodsTree ? JSON.stringify({root: !!appState.methodsTree, children: appState.methodsTree.children ? appState.methodsTree.children.length : 0}) : "无methodsTree"'));
    console.log('localStorage web_projects:', await evalJs('(localStorage.getItem("astroknot_web_projects")||"").slice(0,200)'));
    console.log('项目列表DOM:', await evalJs(`
      (function(){
        const el = document.getElementById('projectList') || document.querySelector('.project-list, #projectsList');
        return el ? '存在,子元素=' + el.children.length + ',可见=' + (el.offsetParent !== null) : '未找到容器';
      })()
    `));
    console.log('is2DView:', await evalJs('appState.is2DView'));
    console.log('systemStorage keys:', await evalJs('Object.keys(localStorage).filter(k=>k.indexOf("astroknot")===0).join(", ")'));
  } catch (e) {
    console.error('诊断出错:', e.message);
  } finally { ws.close(); setTimeout(() => process.exit(0), 300); }
};
ws.onerror = (e) => { console.error('WS错误', e.message || e); process.exit(1); };
