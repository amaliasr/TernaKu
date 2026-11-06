package com.rstudiohub.ternaku;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import java.util.UUID;

public final class TernaKuApp extends Application {
    static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences("ternaku", Context.MODE_PRIVATE);
    }

    static synchronized String installationId(Context context) {
        SharedPreferences prefs = preferences(context);
        String id = prefs.getString("installation", null);
        if (id == null) {
            id = UUID.randomUUID().toString();
            prefs.edit().putString("installation", id).commit();
        }
        return id;
    }

    @Override public void onCreate() {
        super.onCreate();
        NotificationChannel channel = new NotificationChannel(getString(R.string.price_channel),
                "Pengumuman harga telur", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Setiap kali atasan menerbitkan harga telur bagus dan bentes.");
        channel.enableVibration(true);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
}
