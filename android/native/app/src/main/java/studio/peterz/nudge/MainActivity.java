package studio.peterz.nudge;

import android.content.Intent;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NudgePlugin.class);
        registerPlugin(GlyphPlugin.class);
        super.onCreate(savedInstanceState); // BridgeActivity passes the launch intent to onNewIntent

        WebView web = getBridge().getWebView();
        // Android 15+ draws apps edge to edge: keep the app clear of the status bar, the camera
        // cut-out and the gesture bar, and above the keyboard while typing. The strips behind
        // the bars take the app's own background (set from the web side with setBars).
        ViewCompat.setOnApplyWindowInsetsListener(web, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            ViewGroup.MarginLayoutParams lp = (ViewGroup.MarginLayoutParams) v.getLayoutParams();
            lp.setMargins(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            v.setLayoutParams(lp);
            return WindowInsetsCompat.CONSUMED;
        });

        // Back gesture: close the open sheet / go back a tab first (the web app keeps these in its
        // history), and only leave the app when there's nothing left to go back to.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView w = getBridge().getWebView();
                if (w != null && w.canGoBack()) {
                    w.goBack();
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        NudgePlugin.noteLaunch(intent);
    }
}
