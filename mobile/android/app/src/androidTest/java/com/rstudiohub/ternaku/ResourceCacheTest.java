package com.rstudiohub.ternaku;

import static org.junit.Assert.*;
import android.content.Context;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class ResourceCacheTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    private WebView web;

    private void main(Runnable task) { InstrumentationRegistry.getInstrumentation().runOnMainSync(task); }
    private String js(String code) throws Exception {
        CountDownLatch finished = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        main(() -> web.evaluateJavascript(code, value -> { result.set(value); finished.countDown(); }));
        assertTrue("JavaScript callback", finished.await(15, TimeUnit.SECONDS));
        return result.get();
    }
    private void awaitJs(String condition) throws Exception {
        long end = System.currentTimeMillis() + 15000;
        while (System.currentTimeMillis() < end) {
            if ("true".equals(js(condition))) return;
            Thread.sleep(100);
        }
        fail("Web fixture condition timed out: " + condition);
    }
    private void load(String url) throws Exception {
        CountDownLatch finished = new CountDownLatch(1);
        main(() -> {
            web.setWebViewClient(new WebViewClient() {
                @Override public void onPageFinished(WebView view, String location) { finished.countDown(); }
            });
            web.loadUrl(url);
        });
        assertTrue("Local fixture loaded", finished.await(20, TimeUnit.SECONDS));
        awaitJs("window.fixtureResource === true");
    }

    /** Uses only a loopback fixture. No login, cloud registration, or production request. */
    @Test public void resourcePurgeKeepsLoginCookieLocalStorageAndIndexedDbPhoto() throws Exception {
        try (FixtureServer fixture = new FixtureServer()) {
            String origin = fixture.origin();
            main(() -> {
                web = new WebView(context);
                web.getSettings().setJavaScriptEnabled(true);
                web.getSettings().setDomStorageEnabled(true);
            });
            ResourceCache[] policy = new ResourceCache[1];
            File persistent = new File(context.getFilesDir(), "cache-test-draft-" + UUID.randomUUID());
            Files.write(persistent.toPath(), "draft stays".getBytes(StandardCharsets.UTF_8));
            try {
                load(origin + "/");
                assertEquals(1, fixture.assets.get());
                js("localStorage.setItem('cache-test-auth','fixture-only-no-real-token');localStorage.setItem('cache-test-draft',JSON.stringify({kg:12.5,customer:'Uji'}));" +
                    "window.seeded=false;var req=indexedDB.open('cache-test-drafts',1);req.onupgradeneeded=()=>req.result.createObjectStore('photos');" +
                    "req.onsuccess=()=>{var db=req.result;var tx=db.transaction('photos','readwrite');tx.objectStore('photos').put(new Blob(['compressed-photo-fixture'],{type:'image/jpeg'}),'draft-photo');tx.oncomplete=()=>{db.close();window.seeded=true}};");
                awaitJs("window.seeded === true");
                main(() -> { CookieManager.getInstance().setCookie(origin, "cache_test_session=fixture-only; Path=/"); CookieManager.getInstance().flush(); });
                load(origin + "/?before");
                assertEquals("Resource served from actual HTTP cache before purge", 1, fixture.assets.get());
                CountDownLatch cleared = new CountDownLatch(1);
                main(() -> { policy[0] = new ResourceCache(context, web, () -> null, 0); policy[0].inspect(cleared::countDown); });
                assertTrue(cleared.await(15, TimeUnit.SECONDS));
                // clearCache is asynchronous inside Chromium; a small settling period precedes the new navigation.
                Thread.sleep(750);
                load(origin + "/?after");
                assertTrue("HTTP resource fetched again after cache purge", fixture.assets.get() >= 2);
                assertEquals("\"fixture-only-no-real-token\"", js("localStorage.getItem('cache-test-auth')"));
                assertEquals("12.5", js("JSON.parse(localStorage.getItem('cache-test-draft')).kg"));
                js("window.photoText=null;var q=indexedDB.open('cache-test-drafts',1);q.onsuccess=()=>{var db=q.result;var r=db.transaction('photos').objectStore('photos').get('draft-photo');r.onsuccess=()=>{r.result.text().then(t=>{window.photoText=t;db.close()})}};");
                awaitJs("window.photoText === 'compressed-photo-fixture'");
                assertEquals("draft stays", new String(Files.readAllBytes(persistent.toPath()), StandardCharsets.UTF_8));
                AtomicReference<String> cookie = new AtomicReference<>();
                main(() -> cookie.set(CookieManager.getInstance().getCookie(origin)));
                assertTrue(cookie.get().contains("cache_test_session=fixture-only"));
            } finally {
                if (policy[0] != null) policy[0].close();
                persistent.delete();
                try { js("localStorage.removeItem('cache-test-auth');localStorage.removeItem('cache-test-draft');indexedDB.deleteDatabase('cache-test-drafts')"); } catch (Exception ignored) { }
                main(() -> { CookieManager.getInstance().setCookie(origin, "cache_test_session=; Max-Age=0; Path=/"); web.destroy(); });
            }
        }
    }

    @Test public void cameraCleanupKeepsActiveAndRecentPhotosAndNeverFollowsLinks() throws Exception {
        File root = new File(context.getCacheDir(), "cache-policy-test-" + UUID.randomUUID());
        File camera = new File(root, "camera"); assertTrue(camera.mkdirs());
        File active = new File(camera, "foto-active.jpg"), old = new File(camera, "foto-old.jpg"), recent = new File(camera, "foto-recent.jpg"), unknown = new File(camera, "draft.jpg");
        long now = System.currentTimeMillis();
        for (File file : new File[]{active, old, recent, unknown}) Files.write(file.toPath(), new byte[1024]);
        for (File file : new File[]{active, old, unknown}) assertTrue(file.setLastModified(now - ResourceCache.CAMERA_MAX_AGE - 1000));
        File outside = new File(context.getFilesDir(), "cache-test-protected-" + UUID.randomUUID());
        Files.write(outside.toPath(), new byte[2048]);
        File link = new File(camera, "foto-link.jpg");
        try {
            Files.createSymbolicLink(link.toPath(), outside.toPath());
            ResourceCache.cleanOldCameraFiles(root, () -> active, now);
            assertFalse(old.exists()); assertTrue(active.exists()); assertTrue(recent.exists()); assertTrue(unknown.exists()); assertTrue(outside.exists());
            assertFalse("Camera photos are excluded from HTTP cache threshold", ResourceCache.aboveLimit(root, 0));
            File resource = new File(root, "resource-fixture"); Files.write(resource.toPath(), new byte[1024]);
            assertTrue(ResourceCache.aboveLimit(root, 512)); assertFalse(ResourceCache.aboveLimit(root, 2048));
            resource.delete();
        } finally {
            Files.deleteIfExists(link.toPath());
            for (File file : new File[]{active, old, recent, unknown, outside}) file.delete();
            camera.delete(); root.delete();
        }
    }

    private static final class FixtureServer implements AutoCloseable {
        final ServerSocket server = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
        final AtomicInteger assets = new AtomicInteger();
        final Thread worker;
        volatile boolean closed;
        FixtureServer() throws IOException {
            worker = new Thread(() -> {
                while (!closed) try (Socket client = server.accept()) {
                    client.setSoTimeout(5000);
                    BufferedReader reader = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.US_ASCII));
                    String request = reader.readLine();
                    String line; while ((line = reader.readLine()) != null && !line.isEmpty()) { }
                    boolean asset = request != null && request.contains(" /resource.js ");
                    if (asset) assets.incrementAndGet();
                    String body = asset ? "window.fixtureResource=true;/*" + "x".repeat(128 * 1024) + "*/" : "<!doctype html><script src='/resource.js'></script><p>Local cache fixture</p>";
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    String headers = "HTTP/1.1 200 OK\r\nContent-Type: " + (asset ? "application/javascript" : "text/html") + "\r\nCache-Control: " + (asset ? "public, max-age=3600" : "no-store") + "\r\nContent-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n";
                    client.getOutputStream().write(headers.getBytes(StandardCharsets.US_ASCII)); client.getOutputStream().write(bytes); client.getOutputStream().flush();
                } catch (IOException ignored) { }
            }, "ternaku-loopback-fixture");
            worker.start();
        }
        String origin() { return "http://127.0.0.1:" + server.getLocalPort(); }
        @Override public void close() throws IOException { closed = true; server.close(); }
    }
}
