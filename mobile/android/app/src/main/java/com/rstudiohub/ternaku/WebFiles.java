package com.rstudiohub.ternaku;

import android.Manifest;
import android.app.Activity;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.*;
import androidx.core.content.FileProvider;
import java.io.*;
import org.json.JSONObject;

final class WebFiles extends WebChromeClient {
    static final int MAX_MESSAGE = 32 * 1024 * 1024;
    private static final int PICK = 4, SAVE = 5, LOCATE = 6;
    private final MainActivity activity;
    private ValueCallback<Uri[]> upload;
    private Uri cameraUri;
    private boolean cameraCleanupStarted;
    private byte[] document;
    private GeolocationPermissions.Callback location;
    private String locationOrigin;

    WebFiles(MainActivity activity) { this.activity = activity; }

    @Override public boolean onShowFileChooser(WebView web, ValueCallback<Uri[]> callback, FileChooserParams params) {
        if (!MainActivity.trusted(Uri.parse(String.valueOf(web.getUrl())))) return false;
        if (upload != null) upload.onReceiveValue(null);
        upload = callback;
        cameraUri = null;
        try {
            Intent intent;
            if (params.isCaptureEnabled()) {
                File dir = new File(activity.getCacheDir(), "camera");
                if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException();
                File photo = File.createTempFile("foto-", ".jpg", dir);
                cameraUri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".photos", photo);
                intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                intent.setClipData(ClipData.newRawUri("Foto", cameraUri));
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } else {
                intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("image/*").putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
            }
            activity.startActivityForResult(intent, PICK);
            if (cameraUri != null && !cameraCleanupStarted) {
                cameraCleanupStarted = true;
                File dir = new File(activity.getCacheDir(), "camera");
                new Thread(() -> {
                    File[] photos = dir.listFiles();
                    if (photos == null) return;
                    long cutoff = System.currentTimeMillis() - 86400000L;
                    for (File file : photos) if (file.lastModified() < cutoff) file.delete();
                }, "ternaku-photo-cache").start();
            }
        } catch (ActivityNotFoundException | IOException failed) {
            callback.onReceiveValue(null);
            upload = null;
            activity.notice("Kamera atau galeri belum tersedia. Coba pilih foto lain.");
        }
        return true;
    }

    void saveDocument(JSONObject message) {
        if (document != null) return;
        String mime = message.optString("mime");
        String extension;
        if (mime.equals("application/pdf")) extension = ".pdf";
        else if (mime.equals("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) extension = ".xlsx";
        else return;
        String filename = new File(message.optString("filename", "TernaKu")).getName().replaceAll("[\\p{Cntrl}/\\\\]", "_");
        if (filename.length() > 120) filename = filename.substring(0, 120);
        if (!filename.toLowerCase(java.util.Locale.ROOT).endsWith(extension)) filename += extension;
        try {
            document = Base64.decode(message.getString("data"), Base64.NO_WRAP);
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(mime).putExtra(Intent.EXTRA_TITLE, filename);
            activity.startActivityForResult(intent, SAVE);
        } catch (Exception failed) {
            document = null;
            activity.notice("Berkas belum bisa disimpan.");
        }
    }

    void onResult(int code, int result, Intent data) {
        if (code == PICK && upload != null) {
            Uri[] chosen = null;
            if (result == Activity.RESULT_OK) {
                if (cameraUri != null) chosen = new Uri[]{cameraUri};
                else if (data != null && data.getClipData() != null) {
                    ClipData clip = data.getClipData();
                    chosen = new Uri[clip.getItemCount()];
                    for (int i = 0; i < chosen.length; i++) chosen[i] = clip.getItemAt(i).getUri();
                } else if (data != null && data.getData() != null) chosen = new Uri[]{data.getData()};
                if (cameraUri == null && chosen != null) for (Uri uri : chosen) {
                    if (uri == null || !"content".equals(uri.getScheme())
                            || (activity.getPackageName() + ".photos").equals(uri.getAuthority())) { chosen = null; break; }
                }
            }
            upload.onReceiveValue(chosen);
            upload = null;
            if (cameraUri != null) activity.revokeUriPermission(cameraUri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            cameraUri = null;
        } else if (code == SAVE && document != null) {
            byte[] bytes = document;
            document = null;
            if (result != Activity.RESULT_OK || data == null || data.getData() == null) return;
            Uri destination = data.getData();
            if (!"content".equals(destination.getScheme())) return;
            new Thread(() -> {
                try (OutputStream out = activity.getContentResolver().openOutputStream(destination, "w")) {
                    if (out == null) throw new IOException();
                    out.write(bytes);
                } catch (IOException | SecurityException failed) {
                    activity.runOnUiThread(() -> activity.notice("Berkas belum tersimpan. Coba lagi."));
                }
            }, "ternaku-export").start();
        }
    }

    @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
        if (!MainActivity.trusted(Uri.parse(origin))) { callback.invoke(origin, false, false); return; }
        if (location != null) location.invoke(locationOrigin, false, false);
        location = callback;
        locationOrigin = origin;
        if (locationGranted()) onPermissions(LOCATE);
        else activity.requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION}, LOCATE);
    }

    private boolean locationGranted() {
        return activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    void onPermissions(int code) {
        if (code == LOCATE && location != null) { location.invoke(locationOrigin, locationGranted(), false); location = null; }
    }

    void close() {
        if (upload != null) upload.onReceiveValue(null);
        if (location != null) location.invoke(locationOrigin, false, false);
    }
}
