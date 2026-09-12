package com.astroknot.tablet;

import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebView.HitTestResult;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StoragePermPlugin.class); // 文件化存储权限桥（fs-boot 依赖）
        super.onCreate(savedInstanceState);
        setupLongPressLinkBridge();
    }

    /**
     * 长按链接桥：主 WebView 的长按（含 iframe 内部，HitTestResult 为 WebView 级）
     * 命中链接时回调 JS 层 window.__tabletLongPressLink(url)，
     * 由 webview-shim.js 转成 Electron context-menu 事件 → 桌面右键菜单弹出。
     * 仅链接命中时吞掉事件（返回 true），文本选择等其余长按行为不受影响。
     */
    private void setupLongPressLinkBridge() {
        WebView wv = bridge != null ? bridge.getWebView() : null;
        if (wv == null) return;
        wv.setOnLongClickListener(v -> {
            HitTestResult r = ((WebView) v).getHitTestResult();
            if (r != null && r.getExtra() != null && (
                    r.getType() == HitTestResult.SRC_ANCHOR_TYPE ||
                    r.getType() == HitTestResult.SRC_IMAGE_ANCHOR_TYPE)) {
                String url = JSONObject.quote(r.getExtra());
                final WebView w = (WebView) v;
                w.post(() -> w.evaluateJavascript(
                        "window.__tabletLongPressLink && window.__tabletLongPressLink(" + url + ")", null));
                return true;
            }
            return false;
        });
    }
}
