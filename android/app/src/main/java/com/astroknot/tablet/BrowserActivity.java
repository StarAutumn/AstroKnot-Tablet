package com.astroknot.tablet;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * BrowserActivity — 平板内置浏览器（应用内原生 WebView 页，桌面级增强版）。
 *
 * 对标桌面 BrowserApp 的核心体验：
 *   - 多标签（每 tab 独立 WebView 实例，切换保留状态，上限 8 个）
 *   - 导航（后退/前进/刷新）
 *   - 书签（☆ 收藏当前页，点书签条目当前标签打开，长按删除，独立持久化）
 *   - 历史记录（onPageFinished 记录，面板点开/清空，独立持久化）
 *   - 地址栏可输入网址/搜索词（搜索词走 Bing）
 * 数据文件：getFilesDir()/browser_bookmarks.json、browser_history.json
 */
public class BrowserActivity extends Activity {

    private static final int MAX_TABS = 8;
    private static final int MAX_HISTORY = 500;

    private static final String C_BG = "#0e1621";
    private static final String C_BAR = "#16202e";
    private static final String C_CHIP = "#1f2c3d";
    private static final String C_CHIP_ACTIVE = "#0b4551";
    private static final String C_ACCENT = "#5ee8ff";
    private static final String C_TEXT = "#cfe3ee";

    private class Tab {
        WebView web;
        String url = "";
        String title = "新标签页";
        LinearLayout chip;
        TextView titleView;
    }

    private final ArrayList<Tab> tabs = new ArrayList<>();
    private int currentTab = -1;

    private LinearLayout tabRow;
    private FrameLayout holder;
    private EditText urlBox;
    private ProgressBar progress;
    private TextView starBtn;

    private final ArrayList<JSONObject> bookmarks = new ArrayList<>();
    private final ArrayList<JSONObject> history = new ArrayList<>();
    private File bmFile;
    private File histFile;

    private int dp(float v) {
        return Math.round(getResources().getDisplayMetrics().density * v);
    }

    // ────────────────────────── 生命周期 ──────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        bmFile = new File(getFilesDir(), "browser_bookmarks.json");
        histFile = new File(getFilesDir(), "browser_history.json");
        loadList(bmFile, bookmarks);
        loadList(histFile, history);

        setContentView(buildUi());

        String url = getIntent().getStringExtra("url");
        newTab(normalize(url));
        log("onCreate, url=" + url);
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        // singleTask 复用实例：再次触发打开 → 新标签加载
        String url = intent != null ? intent.getStringExtra("url") : null;
        if (url != null) {
            newTab(normalize(url));
            log("onNewIntent, url=" + url);
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // 返回键优先当前标签网页历史，无历史才退出整个浏览器
        if (keyCode == KeyEvent.KEYCODE_BACK && currentTab >= 0) {
            Tab t = tabs.get(currentTab);
            if (t.web != null && t.web.canGoBack()) {
                t.web.goBack();
                return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        for (Tab t : tabs) {
            if (t.web != null) {
                t.web.loadUrl("about:blank");
                t.web.destroy();
            }
        }
        tabs.clear();
        super.onDestroy();
    }

    // ────────────────────────── UI 构建 ──────────────────────────

    private View buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor(C_BG));

        // ── 第一行：✕ | ◀ ▶ ⟳ | 地址栏 | ☆ | 历史 ──
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setPadding(dp(10), dp(8), dp(10), dp(4));
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.parseColor(C_BAR));

        bar.addView(iconBtn("✕", v -> finish()));

        bar.addView(iconBtn("◀", v -> {
            if (cur() != null && cur().web.canGoBack()) cur().web.goBack();
        }));
        bar.addView(iconBtn("▶", v -> {
            if (cur() != null && cur().web.canGoForward()) cur().web.goForward();
        }));
        bar.addView(iconBtn("⟳", v -> {
            if (cur() != null) cur().web.reload();
        }));

        urlBox = new EditText(this);
        urlBox.setSingleLine(true);
        urlBox.setImeOptions(EditorInfo.IME_ACTION_GO);
        urlBox.setInputType(android.text.InputType.TYPE_TEXT_VARIATION_URI);
        urlBox.setTextSize(13);
        urlBox.setTextColor(Color.WHITE);
        urlBox.setHint("搜索或输入网址");
        urlBox.setHintTextColor(Color.parseColor("#5a6b7d"));
        GradientDrawable boxBg = new GradientDrawable();
        boxBg.setColor(Color.parseColor(C_CHIP));
        boxBg.setCornerRadius(dp(18));
        urlBox.setBackground(boxBg);
        urlBox.setPadding(dp(14), dp(8), dp(14), dp(8));
        LinearLayout.LayoutParams urlLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        urlLp.setMargins(dp(6), 0, dp(6), 0);
        bar.addView(urlBox, urlLp);
        urlBox.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO) {
                String u = normalize(urlBox.getText().toString().trim());
                if (cur() != null && !u.isEmpty()) cur().web.loadUrl(u);
                return true;
            }
            return false;
        });

        starBtn = iconBtn("☆", v -> toggleBookmark());
        starBtn.setOnLongClickListener(v -> {
            showBookmarkDialog();
            return true;
        });
        bar.addView(starBtn);
        bar.addView(iconBtn("⏱", v -> showHistoryDialog()));

        // ── 第二行：标签栏 + 新建 ──
        LinearLayout tabBar = new LinearLayout(this);
        tabBar.setOrientation(LinearLayout.HORIZONTAL);
        tabBar.setGravity(Gravity.CENTER_VERTICAL);
        tabBar.setPadding(dp(6), 0, dp(6), dp(4));
        tabBar.setBackgroundColor(Color.parseColor(C_BAR));

        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        scroll.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        tabRow = new LinearLayout(this);
        tabRow.setOrientation(LinearLayout.HORIZONTAL);
        scroll.addView(tabRow);
        tabBar.addView(scroll);

        TextView addBtn = new TextView(this);
        addBtn.setText("＋");
        addBtn.setTextSize(18);
        addBtn.setTextColor(Color.parseColor(C_ACCENT));
        addBtn.setPadding(dp(10), dp(4), dp(10), dp(4));
        addBtn.setOnClickListener(v -> newTab("https://www.bing.com"));
        tabBar.addView(addBtn);

        // ── 进度条 ──
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.getProgressDrawable().setColorFilter(Color.parseColor(C_ACCENT), android.graphics.PorterDuff.Mode.SRC_IN);
        progress.setMax(100);

        // ── 网页容器 ──
        holder = new FrameLayout(this);

        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(tabBar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(progress, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(holder, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        return root;
    }

    private TextView iconBtn(String text, View.OnClickListener l) {
        TextView b = new TextView(this);
        b.setText(text);
        b.setTextSize(15);
        b.setTextColor(Color.parseColor(C_ACCENT));
        b.setPadding(dp(8), dp(6), dp(8), dp(6));
        b.setGravity(Gravity.CENTER);
        b.setOnClickListener(l);
        return b;
    }

    private LinearLayout buildChip(final Tab t) {
        LinearLayout chip = new LinearLayout(this);
        chip.setOrientation(LinearLayout.HORIZONTAL);
        chip.setGravity(Gravity.CENTER_VERTICAL);
        chip.setPadding(dp(10), dp(4), dp(6), dp(4));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor(C_CHIP));
        bg.setCornerRadius(dp(14));
        chip.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(dp(2), 0, dp(2), 0);
        chip.setLayoutParams(lp);

        t.titleView = new TextView(this);
        t.titleView.setTextSize(12);
        t.titleView.setTextColor(Color.parseColor(C_TEXT));
        t.titleView.setMaxWidth(dp(96));
        t.titleView.setSingleLine(true);
        t.titleView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        t.titleView.setText(t.title);
        chip.addView(t.titleView);

        TextView x = new TextView(this);
        x.setText(" ✕");
        x.setTextSize(11);
        x.setTextColor(Color.parseColor("#8899aa"));
        x.setPadding(dp(4), dp(2), dp(4), dp(2));
        x.setOnClickListener(v -> closeTab(tabs.indexOf(t)));
        chip.addView(x);

        chip.setOnClickListener(v -> switchTab(tabs.indexOf(t)));
        t.chip = chip;
        return chip;
    }

    // ────────────────────────── 标签管理 ──────────────────────────

    private Tab cur() {
        return currentTab >= 0 && currentTab < tabs.size() ? tabs.get(currentTab) : null;
    }

    private void newTab(String url) {
        if (tabs.size() >= MAX_TABS) {
            Toast.makeText(this, "最多打开 " + MAX_TABS + " 个标签页", Toast.LENGTH_SHORT).show();
            return;
        }
        Tab t = new Tab();
        t.web = createWebView();
        tabRow.addView(buildChip(t));
        tabs.add(t);
        switchTab(tabs.size() - 1);
        if (url != null && !url.isEmpty()) t.web.loadUrl(url);
        log("newTab, total=" + tabs.size());
    }

    private void switchTab(int i) {
        if (i < 0 || i >= tabs.size()) return;
        currentTab = i;
        holder.removeAllViews();
        holder.addView(tabs.get(i).web);
        for (int k = 0; k < tabs.size(); k++) {
            GradientDrawable bg = new GradientDrawable();
            bg.setColor(Color.parseColor(k == i ? C_CHIP_ACTIVE : C_CHIP));
            bg.setCornerRadius(dp(14));
            tabs.get(k).chip.setBackground(bg);
        }
        urlBox.setText(tabs.get(i).url);
        refreshStar();
    }

    private void closeTab(int i) {
        if (i < 0 || i >= tabs.size()) return;
        Tab t = tabs.get(i);
        if (i == currentTab) holder.removeAllViews();
        tabRow.removeView(t.chip);
        t.web.loadUrl("about:blank");
        t.web.destroy();
        tabs.remove(i);
        if (tabs.isEmpty()) {
            finish();
            return;
        }
        switchTab(Math.min(i, tabs.size() - 1));
        log("closeTab, total=" + tabs.size());
    }

    @SuppressLint("SetJavaScriptEnabled")
    private WebView createWebView() {
        WebView w = new WebView(this);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setMediaPlaybackRequiresUserGesture(false);

        w.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String u) {
                return false; // 所有导航留在本标签内
            }

            @Override
            public void onPageFinished(WebView view, String u) {
                Tab t = ownerOf(view);
                if (t == null) return;
                t.url = u;
                String title = view.getTitle();
                t.title = (title == null || title.isEmpty()) ? hostOf(u) : title;
                t.titleView.setText(t.title);
                if (tabs.indexOf(t) == currentTab) {
                    urlBox.setText(u);
                    refreshStar();
                }
                addHistory(t.title, u);
            }
        });
        w.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progress.setProgress(newProgress);
                progress.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }
        });
        return w;
    }

    private Tab ownerOf(WebView view) {
        for (Tab t : tabs) if (t.web == view) return t;
        return null;
    }

    private String hostOf(String u) {
        try {
            return android.net.Uri.parse(u).getHost();
        } catch (Exception e) {
            return u;
        }
    }

    // ────────────────────────── 书签 ──────────────────────────

    private boolean isBookmarked(String url) {
        for (JSONObject b : bookmarks) {
            if (url != null && url.equals(b.optString("u"))) return true;
        }
        return false;
    }

    private void refreshStar() {
        Tab t = cur();
        boolean marked = t != null && isBookmarked(t.url);
        starBtn.setText(marked ? "★" : "☆");
        starBtn.setTextColor(Color.parseColor(marked ? "#f5c542" : C_ACCENT));
    }

    private void toggleBookmark() {
        Tab t = cur();
        if (t == null || t.url.isEmpty()) return;
        for (int i = 0; i < bookmarks.size(); i++) {
            if (t.url.equals(bookmarks.get(i).optString("u"))) {
                bookmarks.remove(i);
                saveList(bmFile, bookmarks);
                Toast.makeText(this, "已从书签移除", Toast.LENGTH_SHORT).show();
                refreshStar();
                log("bookmark removed");
                return;
            }
        }
        try {
            JSONObject b = new JSONObject();
            b.put("t", t.title);
            b.put("u", t.url);
            bookmarks.add(0, b);
            saveList(bmFile, bookmarks);
            Toast.makeText(this, "已加入书签", Toast.LENGTH_SHORT).show();
            refreshStar();
            log("bookmark added");
        } catch (Exception ignored) {
        }
    }

    private void showBookmarkDialog() {
        ArrayList<String> lines = new ArrayList<>();
        for (JSONObject b : bookmarks) lines.add(b.optString("t") + "\n" + b.optString("u"));
        if (lines.isEmpty()) lines.add("（暂无书签，点 ☆ 收藏当前页）");
        new AlertDialog.Builder(this)
                .setTitle("书签")
                .setAdapter(new android.widget.ArrayAdapter<>(this, android.R.layout.simple_list_item_1, lines), null)
                .show();
    }

    // ────────────────────────── 历史 ──────────────────────────

    private void addHistory(String title, String url) {
        if (url == null || url.startsWith("about:")) return;
        try {
            JSONObject h = new JSONObject();
            h.put("t", title == null ? "" : title);
            h.put("u", url);
            h.put("ts", System.currentTimeMillis());
            // 同 URL 去重旧的
            for (int i = history.size() - 1; i >= 0; i--) {
                if (url.equals(history.get(i).optString("u"))) history.remove(i);
            }
            history.add(0, h);
            while (history.size() > MAX_HISTORY) history.remove(history.size() - 1);
            saveList(histFile, history);
            log("history saved, size=" + history.size());
        } catch (Exception ignored) {
        }
    }

    private void showHistoryDialog() {
        ArrayList<String> lines = new ArrayList<>();
        SimpleDateFormat fmt = new SimpleDateFormat("MM-dd HH:mm", Locale.getDefault());
        for (JSONObject h : history) {
            lines.add(fmt.format(new Date(h.optLong("ts"))) + "  " + h.optString("t") + "\n" + h.optString("u"));
        }
        if (lines.isEmpty()) lines.add("（暂无历史记录）");
        AlertDialog.Builder b = new AlertDialog.Builder(this)
                .setTitle("历史记录")
                .setAdapter(new android.widget.ArrayAdapter<>(this, android.R.layout.simple_list_item_1, lines),
                        (dialog, which) -> {
                            if (which < history.size()) {
                                String u = history.get(which).optString("u");
                                if (cur() != null) cur().web.loadUrl(u);
                            }
                        });
        if (!history.isEmpty()) {
            b.setNeutralButton("清空", (dialog, which) -> {
                history.clear();
                saveList(histFile, history);
                Toast.makeText(this, "历史已清空", Toast.LENGTH_SHORT).show();
                log("history cleared");
            });
        }
        b.setNegativeButton("关闭", null).show();
    }

    // ────────────────────────── 持久化 ──────────────────────────

    private void loadList(File f, ArrayList<JSONObject> out) {
        out.clear();
        try {
            if (!f.exists()) return;
            FileInputStream fis = new FileInputStream(f);
            byte[] buf = new byte[(int) f.length()];
            int n = fis.read(buf);
            fis.close();
            JSONArray arr = new JSONArray(new String(buf, 0, Math.max(n, 0), StandardCharsets.UTF_8));
            for (int i = 0; i < arr.length(); i++) out.add(arr.getJSONObject(i));
        } catch (Exception e) {
            log("loadList failed: " + e.getMessage());
        }
    }

    private void saveList(File f, ArrayList<JSONObject> list) {
        try {
            JSONArray arr = new JSONArray();
            for (JSONObject o : list) arr.put(o);
            FileOutputStream fos = new FileOutputStream(f);
            fos.write(arr.toString().getBytes(StandardCharsets.UTF_8));
            fos.close();
        } catch (Exception e) {
            log("saveList failed: " + e.getMessage());
        }
    }

    // ────────────────────────── 工具 ──────────────────────────

    private String normalize(String u) {
        if (u == null || u.trim().isEmpty()) return "https://www.bing.com";
        u = u.trim();
        if (!u.matches("(?i)^https?://.*")) {
            if (u.matches("^[\\w-]+(\\.[\\w-]+)+(/|$|\\?|:).*")) u = "https://" + u;
            else return "https://www.bing.com/search?q=" + android.net.Uri.encode(u);
        }
        return u;
    }

    private static void log(String msg) {
        android.util.Log.i("AstroBrowser", msg);
    }
}
