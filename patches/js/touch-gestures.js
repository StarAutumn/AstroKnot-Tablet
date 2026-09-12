// ============================================================
// AstroKnot Tablet - 3D 触控手势补丁（平板专属）
//
// 根因: Android WebView 触摸输入不合成 contextmenu / dblclick，
//   且手指停留稍久（约 >500ms）被系统判定为 long-press 后连 click 也不合成，
//   而桌面 3D 交互全部绑定在 renderer.domElement 的鼠标事件上
//   （MoveMode/move-mode/event-bindings/click-handlers.js）：
//     click       = 单击选中节点 / 点连线弹标签框 / 点空白取消选中并关闭菜单标签框
//     dblclick    = 双击节点进文本编辑器
//     contextmenu = 节点/空白右键菜单
// 方案: 在 3D 渲染 canvas 上完全接管 tap 手势，统一合成 MouseEvent
//   交给桌面现有 handler 消费（桌面 handler 不检查 isTrusted），桌面源码零改动：
//   - 单指 tap（位移 ≤12px、未触发长按）→ 合成 click；第二次 tap 间隔 <300ms
//     且落点 <30px → 额外合成 dblclick（时序 click→dblclick 贴近桌面）
//   - 单指长按 ~550ms → 合成 contextmenu（button:2），并震动 15ms 反馈
//   - 所有触摸结束均 preventDefault 抑制浏览器自带鼠标事件合成（避免重复触发/
//     long-press 吞 click），并补发 window mouseup 保证桌面拖拽状态
//     （drag3DNode / drag3DWasMoved / resolveOverlapAfterMove）正常清理
//   - 多指（捏合缩放）不参与，交还原生行为；2D 模式走 document 级双指捏合
//     → appState.zoom2D(factor)（与桌面滚轮同链路，卡片 overlay 上也可捏合）
// ============================================================
(function () {
  'use strict';

  var LONG_PRESS_MS = 550;   // 长按判定时长（Android 系统长按约 500ms）；tap 上限同值
  var LONG_PRESS_MOVE = 12;  // 长按允许最大位移 px（超过即判定为拖动/旋转）
  var DOUBLE_TAP_MS = 300;   // 双击最大间隔 ms
  var DOUBLE_TAP_MOVE = 30;  // 双击两次落点最大距离 px

  var canvas = null;
  var timer = null;
  var seq = 0;               // 手势代数：触摸序列变化即作废旧定时器/计数
  var startX = 0, startY = 0, startT = 0;
  var moved = false;
  var longPressFired = false;
  var lastTapT = 0, lastTapX = 0, lastTapY = 0;

  function is3D() {
    return !!(window.appState && window.appState.renderer && !window.appState.is2DView);
  }

  function is2D() {
    return !!(window.appState && window.appState.is2DView && typeof window.appState.zoom2D === 'function');
  }

  // ---- 2D 双指捏合缩放 + 单指拖动/长按（document 级：卡片 overlay 上的手势也要能响应）----
  // 捏合：与桌面滚轮同链路 appState.zoom2D(factor)（scale 钳制 0.1–3，中心锚点，同 3D dolly）；
  //   仅接管 2 指；3D 模式捏合交还 OrbitControls 原生处理
  // 空白直接框选：单指落在【裸 canvas 空白】（非节点/群组/已有框选区）时无需长按，
  //   触摸开始立即合成 canvas mousedown → 桌面 onMouseDown 自行判定（空白→框选、
  //   连线→标签、批量移动→群拖）；快速点按空白由桌面 mouseup 链路去选中，并补 canvas
  //   click 供 document 级 click-away 关菜单；长按空白原地松手仍弹空白菜单。
  //   仅在触点直接落在画布元素上时启用——卡片/菜单/标签等 DOM 元素仍走长按路径，
  //   避免吞掉菜单项等原生点击。
  // 长按拖动：Android WebView 触摸在拖动场景不合成 mousemove（tap 才合成），
  //   桌面 2D 节点拖拽链 = #view2dCanvas mousedown → window mousemove/mouseup，
  //   故长按（550ms、位移 ≤12px）落在卡片正文 [data-card-overlay]（非交互元素）上时：
  //   合成 canvas mousedown 启动桌面拖拽 → move/up 合成 window 事件走桌面原链路，
  //   落点在空白/交互元素（链接/按钮/输入框）不接管，保持原生行为（滚动/点击/文本选择）
  // 长按菜单（框选/群组/节点/空白菜单入口）：
  //   a) 长按落在【已有框选区内空白】→ 直接合成 canvas contextmenu → 桌面 onContextMenu
  //      弹多选菜单（新建群组/对齐/批量移动）；不合成 mousedown（会重置框选区丢失菜单判据）
  //   b) 长按后【原地松手未拖动】→ 先按原链路收尾（mouseup/click 选中），再合成 canvas
  //      contextmenu → 桌面自行判定：节点→节点菜单 / 群组→群组样式菜单 / 空白→空白菜单
  //   c) 长按后拖动 → 保持原拖拽链（节点拖动/框选/群组拖动/把手缩放），不弹菜单
  //   命中判定通过动态 import 桌面 2DView/shared.js 读取 nodeHitAreas/groupRects/框选区状态
  var pinch = { active: false, lastDist: 0 };
  var drag2D = { armed: false, active: false, timer: null, sx: 0, sy: 0, lx: 0, ly: 0, st: 0, moved: false, menuOnly: false };
  var shared2D = undefined; // undefined=未加载 / null=加载失败 / object=就绪（桌面 2DView/shared.js 模块状态）

  function loadShared2D() {
    if (shared2D !== undefined) return;
    shared2D = null;
    // 根绝对路径：垫片经典脚本内动态 import 按【脚本自身 URL】（/js/）解析而非文档根，
    // 相对路径 './modules/...' 会错指 /js/modules/...（与 browser-shim.js 等垫片的 /modules/ 约定一致）
    import('/modules/2DView/shared.js').then(function (m) { shared2D = m; }).catch(function () {});
  }

  // ---- 3D 移动模式节点拖拽接力 ----
  // 桌面链路（MoveMode/event-bindings/click-handlers.js）：
  //   pointerdown(capture, rendererDom) 命中节点 → drag3DNode=true（stopImmediatePropagation 挡 OrbitControls）
  //   → mousemove(rendererDom) 沿拖拽平面移动节点 → window mouseup 收尾（resolveOverlapAfterMove）
  // 平板断点：真实触摸的 pointerdown 已能设 drag3DNode=true，但 Android 拖动期间不合成 mousemove
  //   → 节点不动。接力 = 触摸开始时读到 drag3DNode=true 即把 touchmove 转合成 rendererDom
  //   mousemove、touchend 补发 window mouseup；快速点按（未移动、<550ms）补发 click 保住选中。
  //   isMoveMode / layer3DLayout 的命中判定全在桌面 pointerdown 里，垫片只认 drag3DNode 结果。
  var shared3D = undefined; // undefined=未加载 / null=加载失败 / object=就绪（桌面 MoveMode/shared.js 模块状态）
  var dragRelay = { active: false, moved: false, lx: 0, ly: 0 };

  function loadShared3D() {
    if (shared3D !== undefined) return;
    shared3D = null;
    // 根绝对路径（同上）：按脚本 URL /js/ 解析会错指 /js/modules/...，必须用 /modules/ 根路径
    import('/modules/MoveMode/shared.js').then(function (m) { shared3D = m; }).catch(function () {});
  }

  // 命中判定（复刻桌面 context-menu.js / box-select.js 口径）：
  // 节点矩形 / 群组矩形（含图层过滤）/ 已有框选区（canvas 坐标 ±5px）
  function hit2DPoint(clientX, clientY) {
    var cv2 = document.getElementById('view2dCanvas');
    if (!cv2 || !shared2D || !shared2D.transform) return null;
    var rect = cv2.getBoundingClientRect();
    var px = clientX - rect.left, py = clientY - rect.top;
    var t = shared2D.transform;
    var wx = (px - cv2.width / 2 - t.offsetX) / t.scale;
    var wy = (py - cv2.height / 2 - t.offsetY) / t.scale;
    var onNode = shared2D.nodeHitAreas.some(function (a) {
      return a.id && wx >= a.x && wx <= a.x + a.width && wy >= a.y && wy <= a.y + a.height;
    });
    var onGroup = false;
    for (var i = shared2D.groupRects.length - 1; i >= 0; i--) {
      var gr = shared2D.groupRects[i];
      if (gr.layerId && gr.layerId !== window.appState.currentLayerId) continue;
      if (wx >= gr.x && wx <= gr.x + gr.width && wy >= gr.y && wy <= gr.y + gr.height) { onGroup = true; break; }
    }
    var inMarquee = false;
    if (shared2D.boxSelectNodeIds.size > 0) {
      var s = shared2D.boxSelectCanvasStart, e2 = shared2D.boxSelectCanvasEnd;
      var minX = Math.min(s.x, e2.x) - 5, maxX = Math.max(s.x, e2.x) + 5;
      var minY = Math.min(s.y, e2.y) - 5, maxY = Math.max(s.y, e2.y) + 5;
      inMarquee = px >= minX && px <= maxX && py >= minY && py <= maxY;
    }
    return { onNode: onNode, onGroup: onGroup, inMarquee: inMarquee };
  }

  function touchDist(e) {
    var a = e.touches[0], b = e.touches[1];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  function cancelDrag2D() {
    if (drag2D.timer) { clearTimeout(drag2D.timer); drag2D.timer = null; }
    drag2D.armed = false;
    if (drag2D.active) {
      drag2D.active = false;
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, clientX: drag2D.lx, clientY: drag2D.ly, button: 0, buttons: 0
      }));
    }
  }

  function onDocTouchStart(e) {
    if (!is2D()) return;
    if (e.touches.length === 2) {           // 双指 → 捏合缩放
      cancelDrag2D();                       // 拖动中第二指按下 → 结束拖动交还捏合
      pinch.active = true;
      pinch.lastDist = touchDist(e);
      e.preventDefault(); // 抑制浏览器原生页面缩放
      return;
    }
    if (e.touches.length !== 1) return;
    // 单指 → 长按 550ms 后合成 canvas mousedown，把命中判定交给桌面
    //（桌面 onMouseDown 自己 hitTest：卡片/球节点→拖拽、空白→框选、连线→标签、把手→resize），
    // 落点在交互元素（链接/按钮/输入框/弹层）不接管，保持原生行为；
    // 未满长按的 tap 不接管 → 原生合成 click 管选中/取消选中
    var t = e.touches[0];
    var el = document.elementFromPoint(t.clientX, t.clientY);
    var in2D = el && el.closest && el.closest('#view2dContainer');
    var interactive = el && el.closest && el.closest('a, button, input, textarea, select, [contenteditable="true"], iframe, .rich-modal');
    if (!in2D || interactive) return;
    var onCard = !!(el.closest && el.closest('[data-card-overlay]'));
    loadShared2D();
    // 空白（裸 canvas，非节点/群组/已有框选区）→ 无需长按，立即开始框选：
    // 桌面 onMouseDown 自行判定（空白→框选、连线→标签、批量移动→群拖）。
    // 仅在触点直接落在画布元素上时启用，卡片/菜单等 DOM 走下方长按路径防误吞原生点击
    var cv2 = document.getElementById('view2dCanvas');
    if (cv2 && el === cv2) {
      var hit0 = null;
      try { hit0 = hit2DPoint(t.clientX, t.clientY); } catch (_) {}
      if (hit0 && !hit0.onNode && !hit0.onGroup && !hit0.inMarquee) {
        drag2D.active = true;
        drag2D.menuOnly = false;
        drag2D.moved = false;
        drag2D.sx = drag2D.lx = t.clientX;
        drag2D.sy = drag2D.ly = t.clientY;
        drag2D.st = Date.now();
        cv2.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, cancelable: true, view: window,
          clientX: t.clientX, clientY: t.clientY, button: 0, buttons: 1
        }));
        return;
      }
    }
    drag2D.armed = true;
    drag2D.sx = drag2D.lx = t.clientX;
    drag2D.sy = drag2D.ly = t.clientY;
    drag2D.moved = false;
    drag2D.menuOnly = false;
    drag2D.st = Date.now();
    var my = ++seq;
    drag2D.timer = setTimeout(function () {
      if (my !== seq || !drag2D.armed || !is2D()) return;
      drag2D.armed = false;
      var cv2 = document.getElementById('view2dCanvas');
      if (!cv2) return;
      // 空白点且落在已有框选区内 → 直接弹多选菜单（新建群组/对齐/批量移动）。
      // 不合成 mousedown：桌面 onMouseDown 会重置框选区，菜单判据（boxSelectCanvasStart/End）就丢了；
      // 桌面 onContextMenu 自行命中判定（区内→多选菜单，区外→空白菜单）
      var hit = hit2DPoint(drag2D.sx, drag2D.sy);
      if (hit && !hit.onNode && !hit.onGroup && hit.inMarquee) {
        drag2D.menuOnly = true;
        cv2.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, view: window,
          clientX: drag2D.sx, clientY: drag2D.sy, button: 2, buttons: 2
        }));
        return;
      }
      drag2D.active = true;
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch (_) {} }
      if (onCard) { try { window.getSelection().removeAllRanges(); } catch (_) {} }
      cv2.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, view: window,
        clientX: drag2D.sx, clientY: drag2D.sy, button: 0, buttons: 1
      }));
    }, LONG_PRESS_MS);
  }

  function onDocTouchMove(e) {
    if (drag2D.menuOnly) {                  // 菜单已弹出：吞掉后续移动，防误滚/误拖
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (drag2D.active) {                    // 拖动中：合成 window mousemove 走桌面拖拽链
      if (e.touches.length !== 1) { cancelDrag2D(); return; }
      e.preventDefault();
      e.stopPropagation();
      var t0 = e.touches[0];
      drag2D.lx = t0.clientX; drag2D.ly = t0.clientY;
      if (Math.hypot(t0.clientX - drag2D.sx, t0.clientY - drag2D.sy) > 6) drag2D.moved = true;
      window.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, cancelable: true, view: window,
        clientX: t0.clientX, clientY: t0.clientY, button: 0, buttons: 1
      }));
      return;
    }
    if (drag2D.armed && e.touches.length === 1) {
      var t1 = e.touches[0];
      if (Math.hypot(t1.clientX - drag2D.sx, t1.clientY - drag2D.sy) > LONG_PRESS_MOVE) {
        if (drag2D.timer) { clearTimeout(drag2D.timer); drag2D.timer = null; }
        drag2D.armed = false;
        // 已有框选区内空白（或 touchstart 时命中模块未就绪的裸空白）拖动 → 转直接框选：
        // 桌面 mousedown 在旧框选区内会重置并开新框选，行为与鼠标一致；
        // 节点/群组命中或卡片 DOM 元素不转换（卡片走原生滚动，节点等长按后再拖）
        var cv2m = document.getElementById('view2dCanvas');
        if (cv2m && document.elementFromPoint(t1.clientX, t1.clientY) === cv2m) {
          var hit1 = null;
          try { hit1 = hit2DPoint(t1.clientX, t1.clientY); } catch (_) {}
          if (hit1 && !hit1.onNode && !hit1.onGroup) {
            drag2D.active = true;
            drag2D.sx = drag2D.lx = t1.clientX;
            drag2D.sy = drag2D.ly = t1.clientY;
            cv2m.dispatchEvent(new MouseEvent('mousedown', {
              bubbles: true, cancelable: true, view: window,
              clientX: t1.clientX, clientY: t1.clientY, button: 0, buttons: 1
            }));
            e.preventDefault();
            return;
          }
        }
      }
      return; // 未接管（武装中）不 preventDefault，保持卡片原生滚动
    }
    if (!pinch.active || e.touches.length < 2) return;
    var dist = touchDist(e);
    if (!pinch.lastDist || !dist) return;
    var factor = Math.max(0.85, Math.min(1.18, dist / pinch.lastDist)); // 单步钳制防跳变
    pinch.lastDist = dist;
    window.appState.zoom2D(factor);
    e.preventDefault();
  }

  function onDocTouchEnd(e) {
    if (drag2D.menuOnly) {                  // 菜单已弹（长按框选区空白）：抑制原生 click 防关菜单
      drag2D.menuOnly = false;
      e.preventDefault();
      return;
    }
    if (drag2D.active || drag2D.armed) {
      var wasActive = drag2D.active;
      var dt = Date.now() - drag2D.st;
      var holdMenu = wasActive && !drag2D.moved && dt >= LONG_PRESS_MS; // 长按原地松手（未拖动）→ 视为右键
      var quickTap = wasActive && !drag2D.moved && dt < LONG_PRESS_MS;  // 空白快速点按 → 补 click（click-away 关菜单）
      var mx = drag2D.lx, my = drag2D.ly;
      cancelDrag2D();
      if (wasActive) e.preventDefault(); // 抑制拖动落点处的原生合成 click（防误选其他节点）
      if (holdMenu) {
        // 桌面 onContextMenu 自行命中判定：节点→节点菜单 / 群组→群组样式菜单 / 空白→空白菜单
        var cv2 = document.getElementById('view2dCanvas');
        if (cv2) cv2.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, view: window,
          clientX: mx, clientY: my, button: 2, buttons: 2
        }));
      } else if (quickTap) {
        // 空白直接框选路径的快速点按：桌面 mouseup 链路已去选中，
        // 这里补 canvas click（冒泡到 document）让 click-away 类处理器（如已开菜单）正常关闭
        var cv2b = document.getElementById('view2dCanvas');
        if (cv2b) cv2b.dispatchEvent(new MouseEvent('click', {
          bubbles: true, cancelable: true, view: window,
          clientX: mx, clientY: my, button: 0, buttons: 0
        }));
      }
      return;
    }
    if (!pinch.active) return;
    if (e.touches.length < 2) {
      pinch.active = false;
      pinch.lastDist = 0;
      e.preventDefault();
    }
  }

  function dispatchOnCanvas(type, x, y, button) {
    canvas.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y,
      button: button, buttons: button === 2 ? 2 : 1
    }));
  }

  // 补发 window mouseup：桌面 handler 依赖它清理拖拽/旋转状态
  // （touchend preventDefault 后浏览器不再合成兼容 mouseup）
  function fireMouseup(button) {
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true, button: button || 0, buttons: 0
    }));
  }

  function onTouchStart(e) {
    clearTimeout(timer); timer = null;
    if (!is3D() || e.touches.length !== 1) { seq++; moved = true; return; } // 多指（捏合缩放）不参与手势
    var t = e.touches[0];
    var my = ++seq;
    startX = t.clientX; startY = t.clientY; startT = Date.now();
    moved = false; longPressFired = false;
    // 移动模式/2D排列 3D 视图：真实 pointerdown 已命中节点（drag3DNode=true）→ 接力拖拽，
    // 不武装长按定时器（长按弹菜单会中途 fireMouseup(2) 打断桌面拖拽）
    loadShared3D();
    if (shared3D && shared3D.drag3DNode) {
      dragRelay.active = true;
      dragRelay.moved = false;
      dragRelay.lx = t.clientX; dragRelay.ly = t.clientY;
      moved = true; // 禁用本触点的长按/tap 逻辑，收尾走 onTouchEnd 接力分支
      return;
    }
    timer = setTimeout(function () {
      if (my !== seq || moved || !is3D()) return;
      longPressFired = true;
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch (_) {} }
      dispatchOnCanvas('contextmenu', startX, startY, 2);
    }, LONG_PRESS_MS);
  }

  function onTouchMove(e) {
    if (dragRelay.active) {                 // 3D 移动模式节点拖拽中：touchmove → rendererDom mousemove
      if (e.touches.length !== 1) {         // 第二指按下 → 结束拖拽交还原生手势
        dragRelay.active = false;
        fireMouseup(0);
        return;
      }
      e.preventDefault();
      var t0 = e.touches[0];
      dragRelay.lx = t0.clientX; dragRelay.ly = t0.clientY;
      if (Math.hypot(t0.clientX - startX, t0.clientY - startY) > 6) dragRelay.moved = true;
      dispatchOnCanvas('mousemove', t0.clientX, t0.clientY, 0);
      return;
    }
    if (longPressFired) { e.preventDefault(); return; } // 菜单已弹出，抑制后续兼容鼠标事件
    if (!timer) return;
    var t = e.touches[0];
    if (t && Math.hypot(t.clientX - startX, t.clientY - startY) > LONG_PRESS_MOVE) {
      clearTimeout(timer); timer = null; moved = true;
    }
  }

  function onTouchEnd(e) {
    if (dragRelay.active) {                 // 3D 拖拽收尾：mouseup 结束桌面拖拽链
      dragRelay.active = false;
      e.preventDefault();
      var wasTap = !dragRelay.moved && (Date.now() - startT < LONG_PRESS_MS); // 快速点按 → 补 click 保选中
      fireMouseup(0);
      if (wasTap) dispatchOnCanvas('click', dragRelay.lx, dragRelay.ly, 0);
      return;
    }
    clearTimeout(timer); timer = null;
    if (longPressFired) {
      longPressFired = false; seq++;
      e.preventDefault(); // 抑制合成 click，防止刚弹出的菜单被 click 关闭
      fireMouseup(2);
      return;
    }
    if (!is3D()) return; // 2D 模式不接管
    var t = e.changedTouches[0];
    if (!t) return;
    e.preventDefault();  // 统一接管：抑制浏览器自带 mousedown/mouseup/click 合成
    seq++;
    fireMouseup(0);
    if (moved || Date.now() - startT >= LONG_PRESS_MS) { lastTapT = 0; return; }
    var x = t.clientX, y = t.clientY, now = Date.now();
    var isDouble = now - lastTapT < DOUBLE_TAP_MS &&
      Math.hypot(x - lastTapX, y - lastTapY) < DOUBLE_TAP_MOVE;
    // 先 click 再 dblclick，贴近桌面 click→click→dblclick 时序
    dispatchOnCanvas('click', x, y, 0);
    if (isDouble) {
      lastTapT = 0;
      dispatchOnCanvas('dblclick', x, y, 0);
    } else {
      lastTapT = now; lastTapX = x; lastTapY = y;
    }
  }

  function onTouchCancel() {
    if (dragRelay.active) {                 // 系统打断拖拽 → 结束桌面拖拽链
      dragRelay.active = false;
      fireMouseup(0);
      return;
    }
    clearTimeout(timer); timer = null;
    seq++;
    if (longPressFired) { longPressFired = false; fireMouseup(2); }
    moved = true; // 被系统打断的手势不算 tap
  }

  // 2D 双指捏合缩放（不依赖 renderer，脚本加载即挂）
  document.addEventListener('touchstart', onDocTouchStart, { passive: false });
  document.addEventListener('touchmove', onDocTouchMove, { passive: false });
  document.addEventListener('touchend', onDocTouchEnd, { passive: false });
  document.addEventListener('touchcancel', onDocTouchEnd, { passive: false });

  // 等待桌面模块创建好 renderer 后挂载（本脚本先于 ES module 执行）
  (function waitAttach() {
    if (window.appState && window.appState.renderer && window.appState.renderer.domElement) {
      canvas = window.appState.renderer.domElement;
      canvas.addEventListener('touchstart', onTouchStart, { passive: false });
      canvas.addEventListener('touchmove', onTouchMove, { passive: false });
      canvas.addEventListener('touchend', onTouchEnd, { passive: false });
      canvas.addEventListener('touchcancel', onTouchCancel, { passive: false });
      loadShared3D(); // 预热 MoveMode/shared.js，进移动模式后首触即可接力
      loadShared2D(); // 预热 2DView/shared.js，2D 首触即可判定空白直接框选
      console.log('[tablet] 3D 触控手势已挂载（单击=选中/连线标签/空白取消，长按=右键菜单，双击=进编辑器，移动模式=拖节点）');
      return;
    }
    setTimeout(waitAttach, 100);
  })();
})();
