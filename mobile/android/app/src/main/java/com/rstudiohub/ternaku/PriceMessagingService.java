package com.rstudiohub.ternaku;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public final class PriceMessagingService extends FirebaseMessagingService {
    static final String TOKEN_CHANGED = "com.rstudiohub.ternaku.TOKEN_CHANGED";

    @Override public void onNewToken(String token) {
        sendBroadcast(new Intent(TOKEN_CHANGED).setPackage(getPackageName()));
    }

    @Override public void onMessageReceived(RemoteMessage message) {
        if (!TernaKuApp.preferences(this).getBoolean("enabled", false)) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (!manager.areNotificationsEnabled()) return;
        Map<String, String> data = message.getData();
        if (!TernaKuApp.preferences(this).getString("user", "").equals(data.get("user_id"))
                || !TernaKuApp.preferences(this).getString("binding", "").equals(data.get("binding_id"))
                || TernaKuApp.preferences(this).getString("binding", "").isEmpty()) return;
        String id = data.get("id");
        String title = data.get("title");
        String body = data.get("body");
        if (id == null || id.isEmpty() || title == null || body == null) return;
        String tag = data.get("tag");
        if (tag == null || tag.isEmpty()) tag = id;
        Intent open = new Intent(this, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification = new Notification.Builder(this, getString(R.string.price_channel))
                .setSmallIcon(R.drawable.ic_price).setColor(0xFF196348)
                .setContentTitle(title).setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setContentIntent(tap).setAutoCancel(true).setOnlyAlertOnce(true)
                .build();
        manager.notify(tag, 1, notification);
    }
}
