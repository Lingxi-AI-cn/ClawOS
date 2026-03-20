package com.clawos.app;

import android.content.Intent;
import android.graphics.Rect;
import android.net.Uri;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Log;
import android.view.View;
import android.view.ViewTreeObserver;
import android.view.Window;
import android.view.WindowManager;

import com.clawos.plugins.ClawOSBridge;
import com.clawos.plugins.ClawOSVoice;
import com.clawos.services.ClawOSFloatingService;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "ClawOS.Main";

    private int lastKeyboardHeightDp = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ClawOSBridge.class);
        registerPlugin(ClawOSVoice.class);
        super.onCreate(savedInstanceState);

        enableImmersiveMode();
        setupKeyboardDetection();

        // Prime the emulator's virtual microphone by briefly opening AudioRecord.
        // On Android emulator, the mic doesn't route audio to background Services
        // until an Activity-context AudioRecord opens it first.
        primeMicrophone();

        // Floating service disabled: system gesture navigation now handles
        // returning to launcher. Code preserved for future re-enable.
        // getWindow().getDecorView().postDelayed(this::tryStartFloatingService, 10000);
    }

    /**
     * Detect soft keyboard via ViewTreeObserver. In immersive/fullscreen mode,
     * adjustResize and visualViewport do not report keyboard changes. We fall
     * back to comparing the visible display frame to the root view height —
     * this works reliably regardless of fullscreen flags.
     *
     * When the keyboard height changes, we inject a JS custom event
     * ('keyboardchange') into the Capacitor WebView so the web UI can
     * shrink its layout above the keyboard.
     */
    private void setupKeyboardDetection() {
        final View contentView = findViewById(android.R.id.content);
        contentView.getViewTreeObserver().addOnGlobalLayoutListener(() -> {
            Rect visibleFrame = new Rect();
            contentView.getWindowVisibleDisplayFrame(visibleFrame);
            int screenHeight = contentView.getRootView().getHeight();
            int keypadHeightPx = screenHeight - visibleFrame.bottom;

            float density = getResources().getDisplayMetrics().density;
            int keypadHeightDp = Math.round(keypadHeightPx / density);

            // Only treat as keyboard if > 15% of screen height
            if (keypadHeightPx < screenHeight * 0.15) {
                keypadHeightDp = 0;
            }

            if (keypadHeightDp == lastKeyboardHeightDp) return;
            lastKeyboardHeightDp = keypadHeightDp;

            final int heightDp = keypadHeightDp;
            try {
                getBridge().getWebView().post(() -> {
                    String js = String.format(
                        "window.__KEYBOARD_HEIGHT__=%d;" +
                        "window.dispatchEvent(new CustomEvent('keyboardchange',{detail:{height:%d}}));",
                        heightDp, heightDp
                    );
                    getBridge().getWebView().evaluateJavascript(js, null);
                });
            } catch (Exception e) {
                Log.w(TAG, "Failed to notify WebView of keyboard: " + e.getMessage());
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri data = intent.getData();
        if (data != null && "clawos".equals(data.getScheme()) && "oauth-callback".equals(data.getHost())) {
            ClawOSBridge.handleOAuthCallback(data);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        // sendFloatingAction(ClawOSFloatingService.ACTION_HIDE);
    }

    @Override
    public void onPause() {
        super.onPause();
        // sendFloatingAction(ClawOSFloatingService.ACTION_SHOW);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enableImmersiveMode();
        }
    }

    private int floatingRetryCount = 0;

    /**
     * Try to start the floating AI assistant service.
     * On custom ROM, init.clawos.rc grants SYSTEM_ALERT_WINDOW via appops.
     * If permission isn't ready yet (race condition), retry up to 3 times.
     */
    private void tryStartFloatingService() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
                floatingRetryCount++;
                if (floatingRetryCount <= 3) {
                    Log.w(TAG, "Overlay permission not ready, retry " + floatingRetryCount + "/3 in 5s");
                    getWindow().getDecorView().postDelayed(this::tryStartFloatingService, 5000);
                } else {
                    Log.w(TAG, "Overlay permission not granted after retries – floating disabled");
                }
                return;
            }

            Intent serviceIntent = new Intent(this, ClawOSFloatingService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
            Log.i(TAG, "Floating service started (overlay permission OK)");
        } catch (Exception e) {
            Log.e(TAG, "Failed to start floating service", e);
        }
    }

    private void sendFloatingAction(String action) {
        try {
            Intent intent = new Intent(this, ClawOSFloatingService.class);
            intent.setAction(action);
            startService(intent);
        } catch (Exception e) {
            // Service may not be running yet – safe to ignore
        }
    }

    /**
     * Keep a persistent AudioRecord alive to "prime" the emulator's virtual mic.
     * On Android emulator, the virtual mic only routes audio to AudioRecord instances
     * that were created after the mic is initially opened by an Activity context.
     *
     * The priming AudioRecord must be PAUSED when other STT engines start recording,
     * because the emulator only routes audio to one AudioRecord at a time.
     * Use pausePriming() / resumePriming() from other components.
     */
    private static AudioRecord sPrimingRecord;
    private static final Object sPrimingLock = new Object();

    /**
     * Pause the priming AudioRecord so another AudioRecord can receive audio.
     * Call this before starting STT in a Service context.
     */
    public static void pausePriming() {
        synchronized (sPrimingLock) {
            if (sPrimingRecord != null) {
                try {
                    sPrimingRecord.stop();
                    Log.i("ClawOS.Main", "Priming AudioRecord paused");
                } catch (Exception e) {
                    Log.w("ClawOS.Main", "Failed to pause priming: " + e.getMessage());
                }
            }
        }
    }

    /**
     * Resume the priming AudioRecord after STT is done.
     * Call this after stopping STT in a Service context.
     */
    public static void resumePriming() {
        synchronized (sPrimingLock) {
            if (sPrimingRecord != null && sPrimingRecord.getState() == AudioRecord.STATE_INITIALIZED) {
                try {
                    sPrimingRecord.startRecording();
                    Log.i("ClawOS.Main", "Priming AudioRecord resumed");
                } catch (Exception e) {
                    Log.w("ClawOS.Main", "Failed to resume priming: " + e.getMessage());
                }
            }
        }
    }

    /**
     * Prime the emulator's virtual microphone by creating an AudioRecord from
     * the Activity context and keeping it in RECORDING state.
     */
    private void primeMicrophone() {
        getWindow().getDecorView().postDelayed(() -> {
            new Thread(() -> primeMicrophoneImpl(0)).start();
        }, 8000);
    }

    private void primeMicrophoneImpl(int attempt) {
        try {
            int sampleRate = 16000;
            int bufSize = AudioRecord.getMinBufferSize(
                    sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (bufSize <= 0) bufSize = sampleRate * 2;

            AudioRecord record = new AudioRecord(
                    MediaRecorder.AudioSource.VOICE_RECOGNITION,
                    sampleRate, AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT, bufSize);

            if (record.getState() == AudioRecord.STATE_INITIALIZED) {
                record.startRecording();
                short[] buf = new short[sampleRate / 10];
                for (int i = 0; i < 3; i++) {
                    record.read(buf, 0, buf.length);
                }
                synchronized (sPrimingLock) {
                    sPrimingRecord = record;
                }
                Log.i(TAG, "Microphone primed (attempt " + attempt + "), keeping in RECORDING state");
            } else {
                record.release();
                if (attempt < 3) {
                    Log.w(TAG, "Mic prime failed (attempt " + attempt + "), retrying in 5s");
                    Thread.sleep(5000);
                    primeMicrophoneImpl(attempt + 1);
                } else {
                    Log.w(TAG, "Mic prime failed after " + attempt + " attempts");
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Microphone priming error: " + e.getMessage());
        }
    }

    private void enableImmersiveMode() {
        Window window = getWindow();
        View decorView = window.getDecorView();
        decorView.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        );
        // Keep screen on during development
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
