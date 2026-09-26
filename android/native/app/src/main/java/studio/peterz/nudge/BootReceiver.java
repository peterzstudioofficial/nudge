package studio.peterz.nudge;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;

/** Phone lock comes back after a restart, so switching the phone off and on isn't a way out. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        if (NudgePlugin.prefs(c).getBoolean("lock", false) && NudgePlugin.hasUsageAccess(c)) {
            ContextCompat.startForegroundService(c, new Intent(c, LockService.class));
        }
    }
}
