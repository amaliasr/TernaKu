package com.rstudiohub.ternaku;

import static org.junit.Assert.*;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Bundle;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.messaging.FirebaseMessaging;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class PriceDeviceTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final Bundle args = InstrumentationRegistry.getArguments();

    @Test public void priceChannelAllowsHeadsUpBeforeOpeningTheActivity() {
        var manager = context.getSystemService(NotificationManager.class);
        var channel = manager.getNotificationChannel(context.getString(R.string.price_channel));
        assertNotNull(channel);
        assertEquals(NotificationManager.IMPORTANCE_HIGH, channel.getImportance());
    }

    /** For an isolated emulator only. Never sends an event, registers a production employee, or logs a token. */
    @Test public void prepareCloudFixture() throws Exception {
        Assume.assumeTrue("1".equals(args.getString("cloudFixture")));
        assertTrue(android.os.Build.FINGERPRINT.contains("emu") || android.os.Build.MODEL.contains("sdk"));
        FirebaseMessaging fcm = FirebaseMessaging.getInstance();
        fcm.setAutoInitEnabled(true);
        String token = Tasks.await(fcm.getToken(), 45, TimeUnit.SECONDS);
        assertFalse(token.isEmpty());
        try (FileOutputStream file = new FileOutputStream(new File(context.getFilesDir(), "cloud-fixture-token"))) {
            file.write(token.getBytes(StandardCharsets.UTF_8));
        }
        var preferences = TernaKuApp.preferences(context).edit().putBoolean("enabled", true);
        String user = args.getString("user_id"), binding = args.getString("binding_id");
        if (user != null && binding != null) preferences.putString("user", user).putString("binding", binding);
        preferences.commit();
    }
}
