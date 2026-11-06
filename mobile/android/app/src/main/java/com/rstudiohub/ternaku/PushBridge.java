package com.rstudiohub.ternaku;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import androidx.webkit.JavaScriptReplyProxy;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import org.json.JSONException;
import org.json.JSONObject;

final class PushBridge {
    private final MainActivity activity;
    private final SharedPreferences prefs;
    private final NotificationManager notifications;
    private JavaScriptReplyProxy permissionReply;
    private String permissionRequest;
    static final int PERMISSION = 1;

    PushBridge(MainActivity activity) {
        this.activity = activity;
        this.prefs = TernaKuApp.preferences(activity);
        this.notifications = activity.getSystemService(NotificationManager.class);
    }

    void handle(JSONObject message, JavaScriptReplyProxy reply) {
        String id = message.optString("requestId");
        if (id.isEmpty() || id.length() > 128) return;
        String action = message.optString("action");
        if ("bound".equals(action) || "unbound".equals(action)) {
            String userId = message.optString("user_id");
            String binding = message.optString("binding_id");
            if ("bound".equals(action) && (userId.isEmpty() || binding.isEmpty() || binding.length() > 128 || userId.length() > 128)) return;
            if ("bound".equals(action)) prefs.edit().putString("user", userId).putString("binding", binding).commit();
            else {
                prefs.edit().remove("user").remove("binding").commit();
                notifications.cancelAll();
            }
            send(reply, id, status(), null);
            return;
        }
        if ("settings".equals(action)) {
            boolean channelOnly = notifications.areNotificationsEnabled();
            Intent settings = new Intent(channelOnly ? Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS
                    : Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            settings.putExtra(Settings.EXTRA_APP_PACKAGE, activity.getPackageName());
            settings.putExtra(Settings.EXTRA_CHANNEL_ID, activity.getString(R.string.price_channel));
            activity.startActivity(settings);
            send(reply, id, status(), null);
            return;
        }
        if (FirebaseApp.getApps(activity).isEmpty()) {
            send(reply, id, "unavailable", null);
            return;
        }
        switch (action) {
            case "enable":
                prefs.edit().putBoolean("opted_out", false).apply();
                if (Build.VERSION.SDK_INT >= 33 && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
                    if (permissionReply != null) { send(reply, id, "default", null); return; }
                    permissionReply = reply;
                    permissionRequest = id;
                    activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, PERMISSION);
                } else {
                    if (!"denied".equals(status())) setEnabled(true);
                    inspect(reply, id);
                }
                break;
            case "disable":
                prefs.edit().remove("user").remove("binding").putBoolean("opted_out", true).commit();
                setEnabled(false);
                notifications.cancelAll();
                FirebaseMessaging.getInstance().deleteToken();
                send(reply, id, "default", null);
                break;
            case "status":
                inspect(reply, id);
                break;
        }
    }

    private void setEnabled(boolean enabled) {
        prefs.edit().putBoolean("enabled", enabled).apply();
        FirebaseMessaging.getInstance().setAutoInitEnabled(enabled);
    }

    void permissionResult(boolean granted) {
        prefs.edit().putBoolean("asked", true).apply();
        if (granted) setEnabled(true);
        if (permissionReply != null) inspect(permissionReply, permissionRequest);
        permissionReply = null;
        permissionRequest = null;
    }

    private String status() {
        if (Build.VERSION.SDK_INT >= 33 && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) return prefs.getBoolean("asked", false) ? "denied" : "default";
        if (!notifications.areNotificationsEnabled() || notifications.getNotificationChannel(activity.getString(R.string.price_channel))
                .getImportance() == NotificationManager.IMPORTANCE_NONE) return "denied";
        return prefs.getBoolean("enabled", false) ? "granted" : "default";
    }

    private void inspect(JavaScriptReplyProxy reply, String id) {
        String current = status();
        if (!"granted".equals(current)) { send(reply, id, current, null); return; }
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(activity, task -> {
            String valid = status();
            String token = "granted".equals(valid) && task.isSuccessful() ? task.getResult() : null;
            send(reply, id, token == null && "granted".equals(valid) ? "unavailable" : valid, token);
        });
    }

    private void send(JavaScriptReplyProxy reply, String id, String status, String token) {
        try {
            JSONObject payload = new JSONObject().put("requestId", id).put("platform", "android")
                    .put("installation_id", TernaKuApp.installationId(activity)).put("status", status)
                    .put("optedOut", prefs.getBoolean("opted_out", false));
            if (token != null) payload.put("token", token);
            // The reply proxy belongs to the exact origin-verified document that made this request.
            reply.postMessage(payload.toString());
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
