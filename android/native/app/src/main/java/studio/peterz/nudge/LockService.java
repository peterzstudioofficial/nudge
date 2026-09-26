package studio.peterz.nudge;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ResolveInfo;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Telephony;
import android.telecom.TelecomManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Phone lock. While the wall says a focus session is running, any app that isn't on the
 * always-allowed list (phone, messages, maps, school, the home screen) is covered by Nudge's
 * lock screen. Outside a session it does nothing but ask the hub every 20 seconds.
 */
public class LockService extends Service {
    static final String EXTRA_LOCK = "nudge.lock";
    static final String EXTRA_BLOCKED = "nudge.blocked";
    static final String[] SCHOOL_APPS = {"com.microsoft.teams", "com.microsoft.office.outlook", "com.microsoft.sharepoint", "com.microsoft.skydrive"};
    private static final String[] ALWAYS = {
        "com.android.systemui", "com.android.server.telecom", "com.google.android.dialer", "com.android.dialer",
        "com.google.android.apps.messaging", "com.android.mms", "com.samsung.android.messaging", "com.google.android.apps.maps",
        "com.android.permissioncontroller", "com.google.android.permissioncontroller", "com.android.emergency",
        "com.google.android.inputmethod.latin", "com.samsung.android.honeyboard",
    };
    private static final int NOTE_ID = 4711;
    static volatile boolean sessionActive = false;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Set<String> allowed = new HashSet<>();
    private long lastPoll = 0;
    private long lastLock = 0;
    private boolean running = false;

    @Override
    public void onCreate() {
        super.onCreate();
        allowed.addAll(Arrays.asList(ALWAYS));
        allowed.addAll(Arrays.asList(SCHOOL_APPS));
        allowed.add(getPackageName());
        // Home screen, default phone and messages apps, whatever they are on this phone.
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        for (ResolveInfo r : getPackageManager().queryIntentActivities(home, 0)) allowed.add(r.activityInfo.packageName);
        TelecomManager tm = (TelecomManager) getSystemService(Context.TELECOM_SERVICE);
        if (tm != null && tm.getDefaultDialerPackage() != null) allowed.add(tm.getDefaultDialerPackage());
        String sms = Telephony.Sms.getDefaultSmsPackage(this);
        if (sms != null) allowed.add(sms);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!NudgePlugin.prefs(this).getBoolean("lock", false)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        ServiceCompat.startForeground(this, NOTE_ID, note("Phone lock is on", "Blocks distracting apps during a focus session."),
            Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0);
        if (!running) {
            running = true;
            main.post(tick);
        }
        return START_STICKY;
    }

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            long now = System.currentTimeMillis();
            if (now - lastPoll > (sessionActive ? 10_000 : 20_000)) {
                lastPoll = now;
                io.execute(LockService.this::poll);
            }
            if (sessionActive) guard(now);
            main.postDelayed(this, sessionActive ? 700 : 5_000);
        }
    };

    /** Is a focus session running? Asks the hub with this phone's own key. */
    private void poll() {
        SharedPreferences p = NudgePlugin.prefs(this);
        String hub = p.getString("hub", "");
        String token = p.getString("token", "");
        if (hub.isEmpty() || token.isEmpty()) return;
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(hub + "/api/session/lock").openConnection();
            c.setConnectTimeout(5000);
            c.setReadTimeout(5000);
            c.setRequestProperty("authorization", "Bearer " + token);
            if (c.getResponseCode() != 200) return;
            StringBuilder b = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream()))) {
                String line;
                while ((line = r.readLine()) != null) b.append(line);
            }
            boolean active = b.toString().contains("\"active\":true");
            if (active != sessionActive) {
                sessionActive = active;
                main.post(() -> {
                    NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                    nm.notify(NOTE_ID, active ? note("Focus session on", "Calls, messages and maps stay open.") : note("Phone lock is on", "Blocks distracting apps during a focus session."));
                });
            }
        } catch (Exception e) {
            // Hub unreachable: never lock someone out because the Wi-Fi dropped.
            sessionActive = false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private void guard(long now) {
        String fg = foreground(now);
        if (fg == null || allowed.contains(fg)) return;
        if (now - lastLock < 1200) return;
        lastLock = now;
        Intent i = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_LOCK, true)
            .putExtra(EXTRA_BLOCKED, fg);
        startActivity(i);
    }

    private String foreground(long now) {
        UsageStatsManager usm = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
        if (usm == null) return null;
        UsageEvents ev = usm.queryEvents(now - 10_000, now);
        UsageEvents.Event e = new UsageEvents.Event();
        String last = null;
        while (ev.hasNextEvent()) {
            ev.getNextEvent(e);
            int t = e.getEventType();
            if (t == UsageEvents.Event.MOVE_TO_FOREGROUND || (Build.VERSION.SDK_INT >= 29 && t == UsageEvents.Event.ACTIVITY_RESUMED)) last = e.getPackageName();
        }
        return last;
    }

    private Notification note(String title, String text) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel("lock") == null) {
            NotificationChannel ch = new NotificationChannel("lock", "Phone lock", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, "lock")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(open)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    @Override
    public void onDestroy() {
        running = false;
        main.removeCallbacks(tick);
        io.shutdownNow();
        sessionActive = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
