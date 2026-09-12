// ============================================================
// AstroKnot Tablet - 虚拟摇杆（平板专属，触摸移动控制）
//
// 左下: 四方向半透明摇杆 → 合成 W/A/S/D 键盘事件
//       3D 模式 = 相机移动；2D 模式 = 视图平移（复用桌面 keys/keys2D 逻辑）
// 右下: 升 / 降 两个按钮 → 空格 / Ctrl（仅 3D 模式显示，2D 自动隐藏）
//
// 原理: dispatch KeyboardEvent 到 window，由桌面 UI/Keyboard.js 统一处理，
//       桌面源码零改动；方向状态去重，斜向支持双键组合。
// ============================================================
(function () {
  'use strict';

  // ---------- 样式 ----------
  var style = document.createElement('style');
  style.textContent = [
    // z-index 1400：低于 .rich-modal(1500)/任务栏(2000)/应用窗口(≤1999)/模态遮罩(10000+)，
    // 模态框打开时摇杆被盖住；配合下方轮询检测到模态时直接隐藏
    '#vk-root{position:fixed;inset:0;pointer-events:none;z-index:1400;',
      'user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}',
    '.vk-stick{position:absolute;left:26px;bottom:110px;width:128px;height:128px;border-radius:50%;',
      'background:rgba(18,32,46,.30);border:1.5px solid rgba(140,190,230,.38);',
      'pointer-events:auto;touch-action:none;opacity:.45;transition:opacity .15s;}',
    '.vk-stick.active{opacity:.8}',
    '.vk-nub{position:absolute;left:50%;top:50%;width:54px;height:54px;border-radius:50%;',
      'background:rgba(150,200,240,.40);border:1.5px solid rgba(190,225,255,.55);',
      'transform:translate(-50%,-50%);box-shadow:0 0 14px rgba(80,160,220,.28);',
      'pointer-events:none;}',
    '.vk-dir{position:absolute;color:rgba(170,215,250,.55);font-size:12px;pointer-events:none;}',
    '.vk-btns{position:absolute;right:26px;bottom:110px;display:flex;flex-direction:column;gap:14px;}',
    '.vk-btn{width:64px;height:64px;border-radius:50%;pointer-events:auto;touch-action:none;',
      'background:rgba(18,32,46,.30);border:1.5px solid rgba(140,190,230,.38);',
      'color:rgba(170,215,250,.75);font-size:24px;display:flex;align-items:center;justify-content:center;',
      'opacity:.45;transition:opacity .15s,background .1s;}',
    '.vk-btn.active,.vk-btn:active{opacity:.8;background:rgba(60,110,160,.45)}'
  ].join('');
  document.head.appendChild(style);

  // ---------- DOM ----------
  var root = document.createElement('div');
  root.id = 'vk-root';
  root.innerHTML =
    '<div class="vk-stick" id="vk-stick">' +
      '<span class="vk-dir" style="left:50%;top:6px;transform:translateX(-50%)">&#9650;</span>' +
      '<span class="vk-dir" style="left:50%;bottom:6px;transform:translateX(-50%)">&#9660;</span>' +
      '<span class="vk-dir" style="left:8px;top:50%;transform:translateY(-50%)">&#9664;</span>' +
      '<span class="vk-dir" style="right:8px;top:50%;transform:translateY(-50%)">&#9654;</span>' +
      '<div class="vk-nub" id="vk-nub"></div>' +
    '</div>' +
    '<div class="vk-btns" id="vk-btns">' +
      '<div class="vk-btn" id="vk-up">&#9650;</div>' +
      '<div class="vk-btn" id="vk-down">&#9660;</div>' +
    '</div>';
  document.body.appendChild(root);

  var stick = document.getElementById('vk-stick');
  var nub = document.getElementById('vk-nub');
  var btns = document.getElementById('vk-btns');
  var btnUp = document.getElementById('vk-up');
  var btnDown = document.getElementById('vk-down');

  // ---------- 合成键盘事件 ----------
  var KEYMAP = { up: 'w', down: 's', left: 'a', right: 'd' };
  var pressed = {}; // 方向名 → true

  function sendKey(type, key) {
    var ev = new KeyboardEvent(type, { key: key, bubbles: true, cancelable: true });
    ev.__vk = true; // 标记摇杆合成事件：GuideCore 平板桥凭此转发到 document（引导检测器监听 document）
    window.dispatchEvent(ev);
  }
  function press(name) {
    if (!pressed[name]) { pressed[name] = true; sendKey('keydown', KEYMAP[name]); }
  }
  function release(name) {
    if (pressed[name]) { delete pressed[name]; sendKey('keyup', KEYMAP[name]); }
  }
  function releaseAll() {
    for (var name in pressed) { delete pressed[name]; sendKey('keyup', KEYMAP[name]); }
  }

  // ---------- 左摇杆 ----------
  var stickId = null; // 正在操作的 pointerId

  function stickMove(e) {
    var r = stick.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var dx = e.clientX - cx, dy = e.clientY - cy;
    var max = r.width / 2 - 8;
    var dist = Math.hypot(dx, dy);
    if (dist > max) { dx = dx / dist * max; dy = dy / dist * max; }
    nub.style.transform = 'translate(calc(-50% + ' + dx.toFixed(1) + 'px), calc(-50% + ' + dy.toFixed(1) + 'px))';
    // 死区 = 半径 18%，出区即判定方向（支持斜向组合）
    var dz = r.width * 0.18;
    (dx > dz) ? press('right') : release('right');
    (dx < -dz) ? press('left') : release('left');
    (dy < -dz) ? press('up') : release('up');
    (dy > dz) ? press('down') : release('down');
  }
  function stickReset() {
    stickId = null;
    stick.classList.remove('active');
    nub.style.transform = 'translate(-50%,-50%)';
    releaseAll();
  }

  stick.addEventListener('pointerdown', function (e) {
    e.preventDefault(); e.stopPropagation();
    stickId = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    stick.classList.add('active');
    stickMove(e);
  });
  stick.addEventListener('pointermove', function (e) {
    if (e.pointerId !== stickId) return;
    e.preventDefault(); e.stopPropagation();
    stickMove(e);
  });
  stick.addEventListener('pointerup', function (e) {
    if (e.pointerId !== stickId) return;
    e.preventDefault(); stickReset();
  });
  stick.addEventListener('pointercancel', stickReset);

  // ---------- 右侧 升/降 按钮（空格 / Ctrl）----------
  function bindBtn(el, key) {
    var id = null;
    el.addEventListener('pointerdown', function (e) {
      e.preventDefault(); e.stopPropagation();
      id = e.pointerId;
      el.setPointerCapture(e.pointerId);
      el.classList.add('active');
      sendKey('keydown', key);
    });
    function up(e) {
      if (e.pointerId !== id) return;
      e.preventDefault();
      el.classList.remove('active');
      sendKey('keyup', key);
      id = null;
    }
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
  bindBtn(btnUp, ' ');       // 3D 上升 = 空格
  bindBtn(btnDown, 'Control'); // 3D 下降 = Ctrl

  // ---------- 2D/3D 切换 + 模态框检测 ----------
  // 2D 模式只显示摇杆，隐藏升降按钮；
  // 模态框（应用窗口/富文本/沙盒/设置/确认弹窗）打开时隐藏整个摇杆，
  // 关闭后恢复；隐藏瞬间松掉全部合成键，防止卡键。
  var vkHiddenByModal = false;
  function isModalVisible() {
    // 用 computed display 判断：桌面多个模态（richEditor/settingsPopup/versionMap）
    // 的初始隐藏靠 CSS 类（.rich-modal{display:none}），inline style 判断会误判可见
    function vis(el) { return el && getComputedStyle(el).display !== 'none'; }
    var i, nodes = document.querySelectorAll('.rich-modal');
    for (i = 0; i < nodes.length; i++) { if (vis(nodes[i])) return true; } // AppRunner 应用窗口/富文本/沙盒
    if (vis(document.getElementById('settingsPopup'))) return true;        // 设置面板
    if (vis(document.getElementById('customConfirmModal'))) return true;   // 确认弹窗（代码 remove 清理）
    return false;
  }
  setInterval(function () {
    var is2D = !!(window.appState && window.appState.is2DView);
    btns.style.display = is2D ? 'none' : 'flex';
    var modal = isModalVisible();
    if (modal !== vkHiddenByModal) {
      vkHiddenByModal = modal;
      root.style.display = modal ? 'none' : '';
      if (modal) { stickReset(); btnUp.classList.remove('active'); btnDown.classList.remove('active'); sendKey('keyup', ' '); sendKey('keyup', 'Control'); }
    }
  }, 200);

  // 长按不弹系统菜单
  root.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  console.log('[tablet] 虚拟摇杆已加载（左摇杆 WASD / 右侧 升降按钮）');
})();
