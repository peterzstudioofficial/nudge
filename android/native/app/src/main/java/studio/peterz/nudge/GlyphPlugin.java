package studio.peterz.nudge;

import android.content.Context;
import android.os.Build;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;

/**
 * The Glyph lights on the back of a Nothing phone (the Phone (4a)'s six-zone Glyph Bar first).
 *
 * Nothing's Glyph SDK is reached by reflection, so this compiles and runs on every phone: if it
 * isn't a Nothing phone, the SDK isn't in the build, or Nothing's service says no, every call
 * quietly does nothing and status() says why. Nothing only lets the app that's on screen use the
 * Glyphs, so they're switched off whenever Nudge goes to the background and brought back after.
 *
 * Zones are numbered from the top: on the Phone (4a), 0 is A1 (top) and 5 is A6 (bottom).
 */
@CapacitorPlugin(name = "NudgeGlyph")
public class GlyphPlugin extends Plugin {
    private static final String TAG = "NudgeGlyph";
    /** device code → number of separately lit zones (0 = treat the whole Glyph as one light) */
    private static final String[][] DEVICES = { { "25111", "6" }, { "25131", "4" }, { "24111", "0" }, { "23113", "0" }, { "23111", "0" }, { "22111", "0" }, { "20111", "0" } };

    private Object gm;
    private Class<?> gmClass;
    private String device;
    private String code = "";
    private int zones = 0;
    private volatile boolean ready = false;
    private volatile boolean foreground = true;
    private String reason = "starting";
    /** the last thing shown, replayed when the app comes back to the front */
    private Runnable last;

    @Override
    public void load() {
        if (Build.VERSION.SDK_INT < 34 || !"nothing".equalsIgnoreCase(Build.MANUFACTURER)) {
            reason = "not a Nothing phone";
            return;
        }
        try {
            Class<?> common = Class.forName("com.nothing.ketchum.Common");
            Class<?> glyph = Class.forName("com.nothing.ketchum.Glyph");
            for (String[] d : DEVICES) {
                if (Boolean.TRUE.equals(common.getMethod("is" + d[0]).invoke(null))) {
                    device = (String) glyph.getField("DEVICE_" + d[0]).get(null);
                    code = d[0];
                    zones = Integer.parseInt(d[1]);
                    break;
                }
            }
            if (device == null) {
                reason = "this model has no Glyph lights the SDK can use";
                return;
            }
            gmClass = Class.forName("com.nothing.ketchum.GlyphManager");
            Class<?> cb = Class.forName("com.nothing.ketchum.GlyphManager$Callback");
            gm = gmClass.getMethod("getInstance", Context.class).invoke(null, getContext().getApplicationContext());
            Object callback = Proxy.newProxyInstance(cb.getClassLoader(), new Class<?>[] { cb }, (proxy, m, args) -> {
                switch (m.getName()) {
                    case "onServiceConnected":
                        connected();
                        return null;
                    case "onServiceDisconnected":
                        ready = false;
                        reason = "Glyph service disconnected";
                        return null;
                    case "hashCode":
                        return System.identityHashCode(proxy);
                    case "equals":
                        return proxy == args[0];
                    case "toString":
                        return "NudgeGlyphCallback";
                    default:
                        return null;
                }
            });
            gmClass.getMethod("init", cb).invoke(gm, callback);
            reason = "connecting";
        } catch (ClassNotFoundException e) {
            gm = null;
            reason = "Glyph SDK not in this build";
        } catch (Throwable t) {
            gm = null;
            reason = "Glyph unavailable";
            Log.w(TAG, "init failed", t);
        }
    }

    private void connected() {
        try {
            Object ok = gmClass.getMethod("register", String.class).invoke(gm, device);
            if (!Boolean.TRUE.equals(ok)) {
                reason = "Nothing didn't allow it (turn on Glyph debug mode, see docs)";
                return;
            }
            if (foreground) gmClass.getMethod("openSession").invoke(gm);
            ready = true;
            reason = "ok";
            if (foreground && last != null) last.run();
        } catch (Throwable t) {
            reason = "Glyph session failed";
            Log.w(TAG, "register/openSession failed", t);
        }
    }

    private boolean usable() {
        return gm != null && ready && foreground;
    }

    private Object frame(int[] zs, int period, int cycles, int interval) throws Exception {
        Object b = gmClass.getMethod("getGlyphFrameBuilder").invoke(gm);
        Class<?> bc = b.getClass();
        if (zones > 0) {
            Method ch = bc.getMethod("buildChannel", int.class);
            for (int z : zs) if (z >= 0 && z < zones) b = ch.invoke(b, z);
        } else {
            b = bc.getMethod("buildChannelA").invoke(b);
        }
        if (period > 0) b = bc.getMethod("buildPeriod", int.class).invoke(b, period);
        if (cycles > 0) b = bc.getMethod("buildCycles", int.class).invoke(b, cycles);
        if (interval > 0) b = bc.getMethod("buildInterval", int.class).invoke(b, interval);
        return bc.getMethod("build").invoke(b);
    }

    private void off() {
        try {
            gmClass.getMethod("turnOff").invoke(gm);
        } catch (Throwable t) {
            Log.w(TAG, "turnOff failed", t);
        }
    }

    private static int[] ints(JSArray a) {
        if (a == null) return new int[0];
        int[] out = new int[Math.min(a.length(), 64)];
        for (int i = 0; i < out.length; i++) out[i] = a.optInt(i, -1);
        return out;
    }

    private void run(PluginCall call, Runnable r) {
        last = r;
        if (usable()) r.run();
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject o = new JSObject();
        o.put("supported", gm != null && !"Glyph session failed".equals(reason) && !reason.startsWith("Nothing didn't"));
        o.put("ready", ready);
        o.put("device", code);
        o.put("model", Build.MODEL);
        o.put("nothing", "nothing".equalsIgnoreCase(Build.MANUFACTURER));
        o.put("zones", zones);
        o.put("reason", reason);
        call.resolve(o);
    }

    /** Light exactly these zones (none = off). */
    @PluginMethod
    public void light(PluginCall call) {
        if (gm == null) {
            call.resolve();
            return;
        }
        final int[] zs = ints(call.getArray("zones"));
        run(call, () -> {
            try {
                if (zs.length == 0) off();
                else gmClass.getMethod("toggle", Class.forName("com.nothing.ketchum.GlyphFrame")).invoke(gm, frame(zs, 0, 0, 0));
            } catch (Throwable t) {
                Log.w(TAG, "light failed", t);
            }
        });
    }

    /** A soft breathing pulse on these zones: period ms per breath, cycles (0 = the SDK's default). */
    @PluginMethod
    public void breathe(PluginCall call) {
        if (gm == null) {
            call.resolve();
            return;
        }
        final int[] zs = ints(call.getArray("zones"));
        final int period = Math.max(200, Math.min(10_000, call.getInt("period", 2000)));
        final int cycles = Math.max(1, Math.min(1000, call.getInt("cycles", 1000)));
        final int interval = Math.max(0, Math.min(10_000, call.getInt("interval", 0)));
        run(call, () -> {
            try {
                gmClass.getMethod("animate", Class.forName("com.nothing.ketchum.GlyphFrame")).invoke(gm, frame(zs, period, cycles, interval));
            } catch (Throwable t) {
                Log.w(TAG, "breathe failed", t);
            }
        });
    }

    @PluginMethod
    public void off(PluginCall call) {
        if (gm == null) {
            call.resolve();
            return;
        }
        run(call, this::off);
    }

    // Nothing only lets the app on screen use the Glyphs: let go in the background, pick up after.
    @Override
    protected void handleOnPause() {
        foreground = false;
        if (gm == null || !ready) return;
        off();
        try {
            gmClass.getMethod("closeSession").invoke(gm);
        } catch (Throwable t) {
            Log.w(TAG, "closeSession failed", t);
        }
    }

    @Override
    protected void handleOnResume() {
        foreground = true;
        if (gm == null || !ready) return;
        try {
            gmClass.getMethod("openSession").invoke(gm);
            if (last != null) last.run();
        } catch (Throwable t) {
            Log.w(TAG, "openSession failed", t);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (gm == null) return;
        try {
            if (ready) {
                off();
                gmClass.getMethod("closeSession").invoke(gm);
            }
            gmClass.getMethod("unInit").invoke(gm);
        } catch (Throwable t) {
            Log.w(TAG, "unInit failed", t);
        }
        gm = null;
        ready = false;
    }
}
