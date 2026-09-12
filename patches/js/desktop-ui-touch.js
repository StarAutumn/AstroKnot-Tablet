// ============================================================
// AstroKnot Tablet - 桌面图标 + 应用库侧边栏 触控适配（平板专属）
//
// 根因: 平板强制桌面图标模式（dockLayoutMode='desktop'，见 sync-web 裁剪补丁）后，
//   1. desktopIconsLayer 图标交互全靠鼠标事件（AppPanel.js _bindDesktopLayerEvents）：
//      click=选中/慢双击重命名, dblclick=运行, contextmenu=菜单, mousedown+mousemove/mouseup=拖动换位
//   2. dockPanel 应用库侧边栏靠 mouseenter 左缘 6px 热区呼出（Dock.js initDock），
//      触屏无 hover，侧边栏永远打不开；面板 mouseleave 隐藏在触屏上也不会发生
//   Android WebView 触摸不合成 dblclick/contextmenu，长按还会被系统吞掉 click
// 方案: 触摸上合成 MouseEvent 交给桌面现有 handler 消费（桌面 handler 不检查 isTrusted），
//   桌面源码零改动：
//   - 桌面图标: 单击=选中 / 双击=打开 / 长按550ms=右键菜单 / 拖动=换位（走桌面 mousedown→mousemove→mouseup 链）
//   - 侧边栏应用项: 单击=选中 / 双击=打开(打开后自动收起面板) / 长按=右键菜单
//   - 左缘 28px 点按 = 呼出/收起应用库侧边栏；面板打开时点面板外任意处 = 收起
//   注意: 本脚本必须加载于 desktopIconsLayer/dockPanel 已存在之后也无需等待——
//     用 waitAttach 轮询挂载；对图标/应用项的 touchstart 一律 preventDefault，
//     完全接管该手势（抑制浏览器原生鼠标事件合成与 long-press 吞 click）
// ============================================================
(function () {
  'use strict';

  var LONG_PRESS_MS = 550;   // 长按判定（与 touch-gestures.js 一致）
  var MOVE_PX = 12;          // 判定位移（超过=拖动）
  var DOUBLE_MS = 300;       // 双击间隔
  var DOUBLE_PX = 30;        // 双击落点距离
  var EDGE_PX = 28;          // 左缘呼出热区宽度

  // ---- 通用 MouseEvent 合成 ----
  function mouse(type, target, x, y, button) {
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y,
      button: button || 0, buttons: button === 2 ? 2 : (type === 'mouseup' || type === 'mouseleave' ? 0 : 1)
    }));
  }
  function docMouse(type, x, y, button) {
    document.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y, button: button || 0, buttons: 0
    }));
  }

  // ---- 触摸→鼠标合成器 ----
  // container: 事件挂载容器; pick: target => 接管目标元素（非空才接管并 preventDefault）
  // opts.onOpen: 双击（打开语义）后回调（用于自动收起侧边栏）
  function attachTouchMouse(container, pick, opts) {
    var st = null; // { target, x0, y0, t0, moved, lpf, timer, lastX, lastY }

    function clearTimer() { if (st && st.timer) { clearTimeout(st.timer); st.timer = null; } }

    container.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { // 多指：作废当前手势（2D 捏合缩放由 touch-gestures 处理）
        if (st) { clearTimer(); st.moved = true; }
        return;
      }
      var t = e.touches[0];
      var hit = pick(e.target);
      if (!hit) { st = null; return; } // 非接管目标：原生行为（按钮点击/滚动等）
      e.preventDefault(); // 完全接管：抑制原生 click/dblclick 合成与系统 long-press
      clearTimer();
      st = {
        target: hit, x0: t.clientX, y0: t.clientY, t0: Date.now(),
        moved: false, lpf: false, timer: null,
        lastX: t.clientX, lastY: t.clientY
      };
      // 与桌面按下等价：桌面图标拖拽依赖 mousedown 置 dragState
      mouse('mousedown', hit, t.clientX, t.clientY, 0);
      var my = st;
      st.timer = setTimeout(function () {
        if (!st || st !== my || st.moved) return;
        st.lpf = true;
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (_) {} }
        mouse('contextmenu', st.target, st.x0, st.y0, 2);
      }, LONG_PRESS_MS);
    }, { passive: false });

    container.addEventListener('touchmove', function (e) {
      if (!st) return;
      var t = e.touches[0];
      if (!t) return;
      e.preventDefault();
      st.lastX = t.clientX; st.lastY = t.clientY;
      if (!st.moved && Math.hypot(t.clientX - st.x0, t.clientY - st.y0) > MOVE_PX) {
        st.moved = true; clearTimer();
      }
      if (!st.moved) return;
      if (st.lpf && !st.lpfDrag) {
        // 长按后再拖：右键菜单已弹出 → 先派发 document mousedown 触发菜单 closeHandler
        // （target=document 不满足图标 closest，不影响 touchstart 时已建立的拖拽状态）
        st.lpfDrag = true;
        docMouse('mousedown', t.clientX, t.clientY, 0);
      }
      docMouse('mousemove', t.clientX, t.clientY, 0);
    }, { passive: false });

    function end(e) {
      if (!st) return;
      var s = st; st = null;
      clearTimer();
      e.preventDefault(); // 抑制原生 click 合成（已由下方按手势补发）
      if (s.lpf) {
        // 长按菜单：补 mouseup 清理桌面 dragState（长按前已合成了 mousedown）
        docMouse('mouseup', s.lastX, s.lastY, 0);
        return;
      }
      docMouse('mouseup', s.lastX, s.lastY, 0); // 拖动换位由桌面 mouseup handler 落位保存
      if (s.moved) return;
      // 守卫：手势期间目标被重渲染替换（如启动期 _render 重建图标）→ 按 data-app-id 重找
      var tgt = s.target;
      if (!tgt.isConnected) {
        var tid = tgt.dataset && tgt.dataset.appId;
        tgt = (tid && container.querySelector('[data-app-id="' + tid + '"]')) || null;
      }
      if (!tgt) return;
      var now = Date.now();
      var isDouble = now - lastTap.t < DOUBLE_MS &&
        Math.hypot(s.x0 - lastTap.x, s.y0 - lastTap.y) < DOUBLE_PX;
      mouse('click', tgt, s.x0, s.y0, 0);
      if (isDouble) {
        lastTap.t = 0;
        mouse('dblclick', tgt, s.x0, s.y0, 0);
        if (opts && typeof opts.onOpen === 'function') opts.onOpen();
      } else {
        lastTap.t = now; lastTap.x = s.x0; lastTap.y = s.y0;
      }
    }
    container.addEventListener('touchend', end, { passive: false });
    container.addEventListener('touchcancel', function (e) {
      if (!st) return;
      var s = st; st = null; clearTimer();
      docMouse('mouseup', s.lastX, s.lastY, 0); // 被打断也要清理 dragState
    });
  }

  var lastTap = { t: 0, x: 0, y: 0 };

  // ---- 侧边栏显隐（绕过 showDock 的 hover 语义，直接操作 visible class）----
  function toggleDockPanel() {
    var panel = document.getElementById('dockPanel');
    if (panel) panel.classList.toggle('visible');
  }
  function hideDockPanel() {
    var panel = document.getElementById('dockPanel');
    if (panel) panel.classList.remove('visible');
  }

  // ---- 左缘呼出（document 捕获阶段，先于 canvas touch-gestures 消费）----
  // 仅劫持背景触摸（3D/2D 画布、触发热区、body），不劫持 2D 卡片等 DOM 元素
  var edgeHandled = false;
  function isBackgroundTarget(t) {
    if (t === document.body || t === document.documentElement) return true;
    if (t.classList && (t.classList.contains('dock-trigger-zone') ||
        t.classList.contains('desktop-icons-layer'))) return true;
    return t.tagName === 'CANVAS';
  }
  document.addEventListener('touchstart', function (e) {
    edgeHandled = false;
    if (e.touches.length !== 1) return;
    var t = e.touches[0];
    if (t.clientX > EDGE_PX) return;
    if (!isBackgroundTarget(e.target)) return;
    e.preventDefault();
    e.stopPropagation(); // 拦下，避免 3D 相机旋转 / 2D 画布响应
    edgeHandled = true;
    toggleDockPanel();
  }, { capture: true, passive: false });

  // ---- 面板打开时，点面板外收起（气泡阶段；edgeHandled 的手势已被拦下不会到这里）----
  document.addEventListener('touchstart', function (e) {
    if (edgeHandled) { edgeHandled = false; return; }
    var panel = document.getElementById('dockPanel');
    if (!panel || !panel.classList.contains('visible')) return;
    if (e.target.closest && e.target.closest('#dockPanel')) return;
    hideDockPanel();
  }, false);

  // ---- 挂载：桌面图标层 + 侧边栏应用项 ----
  (function waitAttach() {
    var layer = document.getElementById('desktopIconsLayer');
    var panel = document.getElementById('dockPanel');
    var items = document.getElementById('dockAppItems');
    var ready = false;
    if (layer && !layer.__touchBound) {
      layer.__touchBound = true;
      attachTouchMouse(layer, function (t) {
        return t.closest ? t.closest('.desktop-icon') : null;
      }, null);
      ready = true;
      console.log('[tablet] 桌面图标触控已挂载（单击=选中/双击=打开/长按=菜单/拖动=换位）');
    }
    if (items && !items.__touchBound) {
      items.__touchBound = true;
      attachTouchMouse(items, function (t) {
        return t.closest ? t.closest('.dock-app-item') : null;
      }, { onOpen: function () { setTimeout(hideDockPanel, 150); } });
      ready = true;
      console.log('[tablet] 应用库侧边栏触控已挂载（单击=选中/双击=打开/长按=菜单）');
    }
    if (!ready || !panel) setTimeout(waitAttach, 300);
  })();
})();
