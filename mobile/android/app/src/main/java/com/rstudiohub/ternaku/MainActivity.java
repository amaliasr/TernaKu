package com.rstudiohub.ternaku;

import android.app.Activity;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.*;
import android.widget.*;
import androidx.core.content.ContextCompat;
import androidx.webkit.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import org.json.JSONObject;
import org.json.JSONException;

public final class MainActivity extends Activity {
    static final String ORIGIN = "https://ternaku.rstudiohub.com";
    private WebView web;
    private FrameLayout layout;
    private PushBridge push;
    private WebFiles files;
    private ReleaseCheck releases;
    private ResourceCache resourceCache;
    private final BroadcastReceiver rotation = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent event) {
            if (trusted(Uri.parse(String.valueOf(web.getUrl())))) {
                web.evaluateJavascript("window.dispatchEvent(new Event('ternaku:native-token-changed'))", null);
            }
        }
    };

    static boolean trusted(Uri url) {
        return url != null && "https".equals(url.getScheme()) && "ternaku.rstudiohub.com".equals(url.getHost())
                && url.getUserInfo() == null && (url.getPort() == -1 || url.getPort() == 443);
    }

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        layout = new FrameLayout(this);
        layout.setBackgroundColor(0xFF196348);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            layout.setOnApplyWindowInsetsListener((view, insets) -> {
                var space = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                view.setPadding(space.left, space.top, space.right, space.bottom);
                return WindowInsets.CONSUMED;
            });
        }
        setContentView(layout);
        web = new WebView(this);
        layout.addView(web);
        files = new WebFiles(this);
        resourceCache = new ResourceCache(this, web, files::activeCameraFile);
        push = new PushBridge(this);
        releases = new ReleaseCheck(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        web.setWebChromeClient(files);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (trusted(url)) return false;
                if (request.isForMainFrame() && request.hasGesture() && "https".equals(url.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, url)); }
                    catch (ActivityNotFoundException ignored) { notice("Browser belum tersedia di HP ini."); }
                }
                return true;
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError error) {
                if (req.isForMainFrame()) offlineView();
            }
        });
        installBridge();
        web.setDownloadListener((url, userAgent, disposition, mime, size) -> {
            if (url.startsWith("blob:" + ORIGIN + "/") && trusted(Uri.parse(String.valueOf(web.getUrl())))) {
                String js = "window.__ternakuSaveBlob(" + JSONObject.quote(url) + "," + JSONObject.quote(mime) + ")";
                web.evaluateJavascript(js, null);
            }
        });
        ContextCompat.registerReceiver(this, rotation, new IntentFilter(PriceMessagingService.TOKEN_CHANGED),
                ContextCompat.RECEIVER_NOT_EXPORTED);
        if (saved == null || web.restoreState(saved) == null) web.loadUrl(ORIGIN + "/");
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::goBack);
    }

    private void installBridge() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
                || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            notice("Perbarui Android System WebView di Play Store untuk memakai notifikasi.");
            return;
        }
        var origin = Collections.singleton(ORIGIN);
        WebViewCompat.addWebMessageListener(web, "TernaKuAndroid", origin, (view, message, source, main, reply) -> {
            if (!main || !trusted(source) || message.getType() != WebMessageCompat.TYPE_STRING) return;
            String raw = message.getData();
            if (raw == null || raw.length() > WebFiles.MAX_MESSAGE) return;
            try {
                JSONObject request = new JSONObject(raw);
                if ("save-document".equals(request.optString("action"))) files.saveDocument(request);
                else if (raw.length() < 1024) push.handle(request, reply);
            } catch (JSONException ignored) { /* Ignore malformed messages. */ }
        });
        try (InputStream input = getAssets().open("bridge.js");
                BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            StringBuilder js = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) js.append(line).append('\n');
            WebViewCompat.addDocumentStartJavaScript(web, js.toString(), origin);
        } catch (IOException error) { throw new IllegalStateException(error); }
    }

    private void offlineView() {
        if (isFinishing() || layout.getChildCount() > 1) return;
        Button retry = new Button(this);
        retry.setText("Belum terhubung. Coba lagi");
        retry.setOnClickListener(v -> { layout.removeView(retry); web.setVisibility(View.VISIBLE); web.loadUrl(ORIGIN + "/"); });
        web.setVisibility(View.INVISIBLE);
        layout.addView(retry, new FrameLayout.LayoutParams(-2, -2, android.view.Gravity.CENTER));
    }

    void notice(String text) { Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }

    private void goBack() { if (web.canGoBack()) web.goBack(); else finish(); }
    @Override public void onBackPressed() { goBack(); }
    @Override public void onSaveInstanceState(Bundle saved) { super.onSaveInstanceState(saved); web.saveState(saved); }
    @Override public void onResume() { super.onResume(); web.onResume(); releases.onResume(); resourceCache.onResume(); }
    @Override public void onPause() { web.onPause(); super.onPause(); }
    @Override public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (resourceCache != null && (level >= TRIM_MEMORY_BACKGROUND
                || (level >= TRIM_MEMORY_RUNNING_LOW && level < TRIM_MEMORY_UI_HIDDEN)
                || (level >= TRIM_MEMORY_UI_HIDDEN && getSystemService(android.app.ActivityManager.class).isLowRamDevice()))) {
            resourceCache.trimMemory();
        }
    }
    @Override public void onLowMemory() { super.onLowMemory(); if (resourceCache != null) resourceCache.trimMemory(); }
    @Override public void onDestroy() {
        unregisterReceiver(rotation);
        files.close();
        resourceCache.close();
        layout.removeView(web);
        web.destroy();
        super.onDestroy();
    }
    @Override public void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        files.onResult(code, result, data);
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == PushBridge.PERMISSION) push.permissionResult(results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED);
        else files.onPermissions(code);
    }
}
