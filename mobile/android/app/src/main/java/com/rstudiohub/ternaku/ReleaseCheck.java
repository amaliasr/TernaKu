package com.rstudiohub.ternaku;

import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import java.io.InputStream;
import java.net.URL;
import java.util.Scanner;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

final class ReleaseCheck {
    private final MainActivity activity;
    private boolean checking;
    ReleaseCheck(MainActivity activity) { this.activity = activity; }

    void onResume() {
        SharedPreferences prefs = TernaKuApp.preferences(activity);
        long now = System.currentTimeMillis();
        if (checking || now - prefs.getLong("release_check", 0) < 6 * 60 * 60 * 1000L) return;
        checking = true;
        new Thread(() -> {
            HttpsURLConnection connection = null;
            try {
                connection = (HttpsURLConnection) new URL(MainActivity.ORIGIN + "/mobile/android-release.json").openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(4000);
                connection.setReadTimeout(4000);
                if (connection.getResponseCode() != 200) return;
                try (InputStream stream = connection.getInputStream(); Scanner scanner = new Scanner(stream, "UTF-8")) {
                    String json = scanner.findWithinHorizon("(?s).{1,4096}", 4096);
                    if (json == null) return;
                    int code = new JSONObject(json).getInt("versionCode");
                    var info = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
                    long installed = Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
                    if (code > installed) activity.runOnUiThread(this::offer);
                }
            } catch (Exception ignored) {
                // A failed update check must never block farm records.
            } finally {
                if (connection != null) connection.disconnect();
                prefs.edit().putLong("release_check", now).apply();
                activity.runOnUiThread(() -> checking = false);
            }
        }, "ternaku-version").start();
    }

    private void offer() {
        if (activity.isFinishing() || activity.isDestroyed() || !activity.hasWindowFocus()) return;
        new AlertDialog.Builder(activity).setTitle("Pembaruan TernaKu tersedia")
                .setMessage("Pasang versi terbaru sekarang atau lanjutkan mencatat.")
                .setNegativeButton("Nanti", null).setPositiveButton("Perbarui", (dialog, which) -> {
                    String installer = activity.getPackageManager().getInstallerPackageName(activity.getPackageName());
                    Uri uri = "com.android.vending".equals(installer)
                            ? Uri.parse("market://details?id=" + activity.getPackageName())
                            : Uri.parse(MainActivity.ORIGIN + "/mobile/TernaKu.apk");
                    try { activity.startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (ActivityNotFoundException missing) { activity.notice("Buka halaman unduhan TernaKu di browser HP."); }
                }).show();
    }
}
