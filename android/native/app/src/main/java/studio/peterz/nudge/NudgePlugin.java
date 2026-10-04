package studio.peterz.nudge;

import android.app.AppOpsManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Native bits the web apps can't do on their own:
 *  - phone lock during a focus session (usage access + a foreground service)
 *  - opening the always-allowed apps (phone, messages, maps, school)
 *  - sending a note to Google Keep
 */
@CapacitorPlugin(name = "NudgeNative")
public class NudgePlugin extends Plugin {
    static final String PREFS = "nudge";
    private static NudgePlugin instance;
    private static boolean launchedForLock = false;

    @Override
    public void load() {
        instance = this;
    }

    /** Called by MainActivity for every launch; the lock service launches us with EXTRA_LOCK. */
    static void noteLaunch(Intent intent) {
        if (intent == null || !intent.getBooleanExtra(LockService.EXTRA_LOCK, false)) return;
        launchedForLock = true;
        if (instance != null) {
            JSObject o = new JSObject();
            o.put("blocked", intent.getStringExtra(LockService.EXTRA_BLOCKED));
            instance.notifyListeners("lock", o, true);
        }
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Where the hub is and this phone's key, so the service can ask whether a session is running. */
    @PluginMethod
    public void configure(PluginCall call) {
        String hub = call.getString("hub", "");
        String token = call.getString("token", "");
        prefs(getContext()).edit().putString("hub", hub).putString("token", token).apply();
        call.resolve();
    }

    @PluginMethod
    public void lockStatus(PluginCall call) {
        Context c = getContext();
        JSObject o = new JSObject();
        o.put("usageAccess", hasUsageAccess(c));
        o.put("overlay", Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(c));
        o.put("enabled", prefs(c).getBoolean("lock", false));
        o.put("sessionActive", LockService.sessionActive);
        o.put("launchedForLock", launchedForLock);
        launchedForLock = false;
        call.resolve(o);
    }

    @PluginMethod
    public void openUsageSettings(PluginCall call) {
        startSettings(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS));
        call.resolve();
    }

    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        startSettings(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName())));
        call.resolve();
    }

    @PluginMethod
    public void setLock(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        Context c = getContext();
        // The same rule as the wall: nothing on the phone can switch it off mid-session.
        if (!on && LockService.sessionActive) {
            call.reject("not during a session");
            return;
        }
        if (on && !hasUsageAccess(c)) {
            call.reject("usage access needed");
            return;
        }
        prefs(c).edit().putBoolean("lock", on).apply();
        Intent svc = new Intent(c, LockService.class);
        if (on) ContextCompat.startForegroundService(c, svc);
        else c.stopService(svc);
        call.resolve();
    }

    /** Open one of the apps that never lock. */
    @PluginMethod
    public void openApp(PluginCall call) {
        String which = call.getString("which", "");
        Intent i;
        switch (which) {
            case "call":
                i = new Intent(Intent.ACTION_DIAL);
                break;
            case "chat":
                i = Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_MESSAGING);
                break;
            case "map":
                i = Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_MAPS);
                break;
            case "school": {
                PackageManager pm = getContext().getPackageManager();
                i = null;
                for (String p : LockService.SCHOOL_APPS) {
                    Intent l = pm.getLaunchIntentForPackage(p);
                    if (l != null) {
                        i = l;
                        break;
                    }
                }
                String url = call.getString("url", "");
                if (i == null && url != null && url.startsWith("https://")) i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                if (i == null) {
                    call.reject("no school app installed");
                    return;
                }
                break;
            }
            default:
                call.reject("unknown app");
                return;
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("not installed");
        }
    }

    /** Send a note to Google Keep (Google has no Keep API for personal accounts, so it's a share). */
    /** Status and navigation bars follow the app's light/dark theme (dark icons on light, light on dark). */
    @PluginMethod
    public void setBars(PluginCall call) {
        final boolean light = Boolean.TRUE.equals(call.getBoolean("light", false));
        final String css = call.getString("color", "");
        getActivity().runOnUiThread(() -> {
            android.view.Window w = getActivity().getWindow();
            int color = light ? 0xFFF4F3EF : 0xFF0A0A0C;
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)").matcher(css);
            if (m.find()) color = android.graphics.Color.rgb(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)));
            w.setStatusBarColor(color);
            w.setNavigationBarColor(color);
            // Android 15+ (edge to edge): the bars are see-through, so the strips behind them
            // show the window itself. Paint it to match the app.
            w.getDecorView().setBackgroundColor(color);
            androidx.core.view.WindowInsetsControllerCompat c = androidx.core.view.WindowCompat.getInsetsController(w, w.getDecorView());
            c.setAppearanceLightStatusBars(light);
            c.setAppearanceLightNavigationBars(light);
            call.resolve();
        });
    }

    /** Opens a built tool in Chrome (not the app's web view), so Android can install it as an app. */
    @PluginMethod
    public void openInBrowser(PluginCall call) {
        String url = call.getString("url", "");
        if (!(url.startsWith("https://") || url.startsWith("http://"))) {
            call.reject("not a web address");
            return;
        }
        Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        view.addCategory(Intent.CATEGORY_BROWSABLE);
        view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            view.setPackage("com.android.chrome");
            getContext().startActivity(view);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            try {
                view.setPackage(null);
                getContext().startActivity(view);
                call.resolve();
            } catch (ActivityNotFoundException e2) {
                call.reject("no browser");
            }
        }
    }

    @PluginMethod
    public void shareToKeep(PluginCall call) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_SUBJECT, call.getString("title", ""));
        send.putExtra(Intent.EXTRA_TEXT, call.getString("text", ""));
        Intent target = send;
        if (getContext().getPackageManager().getLaunchIntentForPackage("com.google.android.keep") != null) {
            send.setPackage("com.google.android.keep");
        } else {
            target = Intent.createChooser(send, "Send note");
        }
        target.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(target);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("nothing can take the note");
        }
    }

    private void startSettings(Intent i) {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
        } catch (ActivityNotFoundException e) {
            getContext().startActivity(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
    }

    static boolean hasUsageAccess(Context c) {
        AppOpsManager ops = (AppOpsManager) c.getSystemService(Context.APP_OPS_SERVICE);
        int mode = Build.VERSION.SDK_INT >= 29
            ? ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), c.getPackageName())
            : ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), c.getPackageName());
        return mode == AppOpsManager.MODE_ALLOWED;
    }
}
