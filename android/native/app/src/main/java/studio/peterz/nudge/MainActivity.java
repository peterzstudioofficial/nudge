package studio.peterz.nudge;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NudgePlugin.class);
        super.onCreate(savedInstanceState); // BridgeActivity passes the launch intent to onNewIntent
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        NudgePlugin.noteLaunch(intent);
    }
}
