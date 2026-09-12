package com.astroknot.tablet;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * StoragePermPlugin — 「所有文件访问」权限桥（MANAGE_EXTERNAL_STORAGE）
 *
 * 供 Web 层 fs-core.js / fs-boot.js 调用：
 *   ensureAccess({ openSettings }) → { granted: boolean }
 *   - Android 11+（API 30+）: Environment.isExternalStorageManager() 判定；
 *     未授权且 openSettings=true 时跳转系统「所有文件访问」授权页
 *     （用户返回 App 后由 visibilitychange 复查并自动升级存储根）
 *   - Android 10 及以下: WRITE_EXTERNAL_STORAGE 运行时权限直接弹窗
 */
@CapacitorPlugin(name = "StoragePerm")
public class StoragePermPlugin extends Plugin {

    private static final int LEGACY_PERM_REQUEST = 9001;

    @PluginMethod
    public void ensureAccess(PluginCall call) {
        boolean openSettings = Boolean.TRUE.equals(call.getBoolean("openSettings", false));
        boolean granted = hasAccess();
        if (!granted && openSettings) {
            requestAccess();
            // 跳授权页/弹权限框后立刻回查大概率仍为未授权；
            // 用户授权返回后由 fs-boot 的 visibilitychange 监听复查升级
            granted = hasAccess();
        }
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    /**
     * exitApp() → 真正退出应用（对应桌面 closeApp / window.close）。
     * finishAffinity 结束任务栈内全部 Activity，应用彻底退出（非退后台）。
     */
    @PluginMethod
    public void exitApp(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            getActivity().finishAffinity();
            android.os.Process.killProcess(android.os.Process.myPid());
        });
        call.resolve();
    }

    /**
     * openExternal({ url }) → 跳系统浏览器打开网页。
     * 平板 WebView 无 Electron <webview>，内置浏览器应用由此降级为系统浏览器。
     */
    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.resolve(err("缺少网址"));
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                android.content.Intent i = new android.content.Intent(android.content.Intent.ACTION_VIEW,
                        android.net.Uri.parse(url));
                i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(i);
                call.resolve();
            } catch (Exception e) {
                call.reject("无法打开系统浏览器: " + e.getMessage());
            }
        });
    }

    /**
     * openInApp({ url }) → 应用内浏览器页（原生 WebView Activity，无嵌套限制）。
     * 平板内置浏览器的正式通道；openExternal 保留为兜底。
     */
    @PluginMethod
    public void openInApp(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.resolve(err("缺少网址"));
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                android.content.Intent i = new android.content.Intent(getActivity(), BrowserActivity.class);
                i.putExtra("url", url);
                getActivity().startActivity(i);
                call.resolve();
            } catch (Exception e) {
                call.reject("打开内置浏览器失败: " + e.getMessage());
            }
        });
    }

    private boolean hasAccess() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return Environment.isExternalStorageManager();
        }
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.WRITE_EXTERNAL_STORAGE)
                == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * openPath({ path }) → { success, error? }
     * 在系统文件管理器中打开文件夹（对应桌面 shell.showItemInFolder）。
     * 支持绝对路径或 /storage/emulated/0 根内路径；私有 Data 目录无法被外部
     * 文件管理器访问（Android 11+），返回 error: 'restricted'。
     */
    @PluginMethod
    public void openPath(PluginCall call) {
        String p = call.getString("path");
        if (p == null || p.isEmpty()) {
            call.resolve(err("缺少路径"));
            return;
        }
        String primary = Environment.getExternalStorageDirectory().getAbsolutePath();
        String canonical = p;
        if (canonical.startsWith("/data/") || canonical.startsWith(primary + "/Android/data/")) {
            call.resolve(err("restricted"));
            return;
        }
        if (!canonical.startsWith("/")) {
            // 相对路径 = Documents 内相对（fs-core 的 base 为 'AstroKnot-Data'）
            canonical = primary + "/Documents/" + canonical;
        }
        if (!canonical.startsWith(primary)) {
            call.resolve(err("unsupported"));
            return;
        }
        String rel = canonical.substring(primary.length()).replaceAll("^/", "");
        if (rel.isEmpty()) rel = "Documents";
        if (openDir("primary:" + rel) || openDirFallback(rel)) {
            call.resolve(ok());
        } else {
            call.resolve(err("未找到可用的文件管理器"));
        }
    }

    private boolean openDir(String documentId) {
        try {
            // document URI 直接 ACTION_VIEW 会因调用方无契约级授权抛 SecurityException；
            // root URI 无需授权，EXTRA_INITIAL_URI 由 DocumentsUI 自己解析跳转到子目录
            Uri rootUri = DocumentsContract.buildRootUri(
                    "com.android.externalstorage.documents", "primary");
            Uri docUri = DocumentsContract.buildDocumentUri(
                    "com.android.externalstorage.documents", documentId);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(rootUri, "vnd.android.document/directory");
            i.putExtra(DocumentsContract.EXTRA_INITIAL_URI, docUri);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            return true;
        } catch (Exception e) {
            android.util.Log.e("StoragePerm", "openDir failed: " + documentId, e);
            return false;
        }
    }

    /** 回退：第三方文件管理器常用 resource/folder 约定 */
    private boolean openDirFallback(String rel) {
        try {
            Uri docUri = DocumentsContract.buildDocumentUri(
                    "com.android.externalstorage.documents", "primary:" + rel);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(docUri, "resource/folder");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            return true;
        } catch (Exception e) {
            android.util.Log.e("StoragePerm", "openDirFallback failed: " + rel, e);
            return false;
        }
    }

    private JSObject ok() {
        JSObject r = new JSObject();
        r.put("success", true);
        return r;
    }

    private JSObject err(String msg) {
        JSObject r = new JSObject();
        r.put("success", false);
        r.put("error", msg);
        return r;
    }

    private void requestAccess() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                Intent i = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                        Uri.parse("package:" + getContext().getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
            } catch (Exception e) {
                try {
                    // 部分厂商 ROM 不支持带包名 URI 的入口 → 退到全量列表页
                    Intent fallback = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                    fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(fallback);
                } catch (Exception ignored) {
                }
            }
        } else {
            ActivityCompat.requestPermissions(
                    getActivity(),
                    new String[]{
                            Manifest.permission.WRITE_EXTERNAL_STORAGE,
                            Manifest.permission.READ_EXTERNAL_STORAGE
                    },
                    LEGACY_PERM_REQUEST);
        }
    }
}
