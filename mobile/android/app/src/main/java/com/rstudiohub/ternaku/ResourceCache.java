package com.rstudiohub.ternaku;

import android.app.ActivityManager;
import android.content.Context;
import android.os.SystemClock;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.ArrayDeque;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Supplier;

/** Resource cache maintenance only; never touches cookies, WebStorage, or app data. */
final class ResourceCache implements AutoCloseable {
    static final long NORMAL_LIMIT = 16L * 1024 * 1024;
    static final long LOW_RAM_LIMIT = 8L * 1024 * 1024;
    static final long CHECK_INTERVAL = 30L * 60 * 1000;
    static final long CAMERA_MAX_AGE = 24L * 60 * 60 * 1000;
    private static long lastCheck = -CHECK_INTERVAL;
    private final File root;
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Supplier<File> activeCamera;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> new Thread(r, "ternaku-resource-cache"));
    private final long limit;
    private volatile boolean closed;

    ResourceCache(Context context, WebView web, Supplier<File> activeCamera) {
        this(context, web, activeCamera, context.getSystemService(ActivityManager.class).isLowRamDevice() ? LOW_RAM_LIMIT : NORMAL_LIMIT);
    }

    ResourceCache(Context context, WebView web, Supplier<File> activeCamera, long limit) {
        this.root = context.getCacheDir();
        this.web = web;
        this.activeCamera = activeCamera;
        this.limit = limit;
        worker.execute(() -> cleanOldCameraFiles(root, activeCamera, System.currentTimeMillis()));
    }

    void onResume() {
        long now = SystemClock.elapsedRealtime();
        synchronized (ResourceCache.class) {
            if (closed || now - lastCheck < CHECK_INTERVAL) return;
            lastCheck = now;
        }
        inspect(null);
    }

    /** Runs filesystem work off the UI thread; callback means the clear request was issued. */
    void inspect(Runnable completed) {
        if (closed) return;
        worker.execute(() -> {
            cleanOldCameraFiles(root, activeCamera, System.currentTimeMillis());
            boolean oversized = aboveLimit(root, limit);
            main.post(() -> {
                if (closed) return;
                if (oversized) web.clearCache(true);
                if (completed != null) completed.run();
            });
        });
    }

    void trimMemory() {
        if (!closed) web.clearCache(false);
    }

    static boolean aboveLimit(File cacheRoot, long limit) {
        try {
            File canonicalRoot = cacheRoot.getCanonicalFile();
            File camera = new File(canonicalRoot, "camera");
            ArrayDeque<File> pending = new ArrayDeque<>();
            pending.add(canonicalRoot);
            long bytes = 0;
            int visited = 0;
            while (!pending.isEmpty()) {
                if (Thread.currentThread().isInterrupted()) return false;
                // Avoid spending unbounded time walking an unusually large cache tree.
                if (++visited > 8192) return true;
                File entry = pending.removeLast();
                if (Files.isSymbolicLink(entry.toPath())) continue;
                File resolved = entry.getCanonicalFile();
                if (!resolved.toPath().startsWith(canonicalRoot.toPath()) || resolved.equals(camera)) continue;
                if (resolved.isDirectory()) {
                    File[] children = resolved.listFiles();
                    if (children != null) for (File child : children) pending.add(child);
                } else {
                    bytes += resolved.length();
                    if (bytes > limit) return true;
                }
            }
        } catch (IOException | SecurityException ignored) { /* Cache maintenance must never block opening the app. */ }
        return false;
    }

    static void cleanOldCameraFiles(File cacheRoot, Supplier<File> activeCamera, long now) {
        try {
            File camera = new File(cacheRoot.getCanonicalFile(), "camera");
            if (Files.isSymbolicLink(camera.toPath())) return;
            File[] photos = camera.listFiles();
            if (photos == null) return;
            for (File file : photos) {
                if (Thread.currentThread().isInterrupted()) return;
                if (!file.getName().startsWith("foto-") || !file.getName().endsWith(".jpg") || !file.isFile()
                        || Files.isSymbolicLink(file.toPath()) || !file.getCanonicalFile().getParentFile().equals(camera)
                        || file.lastModified() >= now - CAMERA_MAX_AGE) continue;
                File active = activeCamera.get();
                if (active != null && file.getCanonicalFile().equals(active.getCanonicalFile())) continue;
                file.delete();
            }
        } catch (IOException | SecurityException ignored) { /* Keep the photo if its location cannot be verified. */ }
    }

    @Override public void close() { closed = true; worker.shutdownNow(); }
}
