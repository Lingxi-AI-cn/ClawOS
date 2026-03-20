package com.clawos.services;

import android.animation.ValueAnimator;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;

import com.clawos.app.MainActivity;
import com.clawos.audio.SherpaSTTEngine;
import com.clawos.audio.SherpaTTSEngine;
import com.clawos.gateway.FloatingGatewayClient;
import com.clawos.views.FloatingInputBar;

import org.json.JSONObject;

import java.util.UUID;

/**
 * Foreground service that manages the floating AI assistant overlay.
 *
 * Simplified design: a single semi-transparent input bar replaces the
 * previous bubble + chat panel interaction. AI responses are delivered
 * via TTS (text-to-speech), not displayed in a chat window.
 *
 * States:
 *   VISIBLE – input bar shown (when another app is in foreground)
 *   HIDDEN  – input bar hidden (when ClawOS Launcher is in foreground)
 */
public class ClawOSFloatingService extends Service {

    private static final String TAG = "FloatingService";
    private static final String CHANNEL_ID = "clawos_floating";
    private static final int NOTIFICATION_ID = 1001;

    public static final String ACTION_SHOW = "com.clawos.FLOATING_SHOW";
    public static final String ACTION_HIDE = "com.clawos.FLOATING_HIDE";

    private WindowManager windowManager;
    private FloatingInputBar inputBar;
    private WindowManager.LayoutParams barParams;

    private FloatingGatewayClient gatewayClient;
    private SherpaSTTEngine sttEngine;
    private SherpaTTSEngine ttsEngine;

    private boolean isBarVisible = false;
    private boolean isHidden = false; // Hidden by ClawOS Launcher
    private boolean ttsEnabled = true;
    private String lastGatewayStatus = "";
    private String currentRunId = null;

    private final Handler serviceHandler = new Handler(Looper.getMainLooper());
    private int gatewayInitRetries = 0;
    private static final int MAX_GATEWAY_RETRIES = 5;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.i(TAG, "FloatingService created");
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);

        createNotificationChannel();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, buildNotification(),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, buildNotification());
        }

        try {
            initViews();
        } catch (Exception e) {
            Log.e(TAG, "Failed to init views", e);
            stopSelf();
            return;
        }

        try {
            initGateway();
        } catch (Exception e) {
            Log.e(TAG, "Failed to init gateway", e);
        }

        Thread voiceInit = new Thread(() -> {
            try {
                Thread.sleep(20000);
                initVoice();
            } catch (InterruptedException ignored) {
            } catch (Exception e) {
                Log.e(TAG, "Failed to init voice", e);
            }
        }, "floating-voice-init");
        voiceInit.setPriority(Thread.MIN_PRIORITY);
        voiceInit.start();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_HIDE.equals(action)) {
                hideBar();
            } else if (ACTION_SHOW.equals(action)) {
                showBar();
            }
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "FloatingService destroyed");
        if (gatewayClient != null) gatewayClient.disconnect();
        if (sttEngine != null) sttEngine.release();
        if (ttsEngine != null) ttsEngine.release();
        removeViews();
        super.onDestroy();
    }

    // ── View Initialization ─────────────────────────────────────

    private void initViews() {
        float density = getResources().getDisplayMetrics().density;
        DisplayMetrics dm = getResources().getDisplayMetrics();

        inputBar = new FloatingInputBar(this);

        inputBar.setOnSendListener(message -> {
            if (gatewayClient != null && gatewayClient.isConnected()) {
                inputBar.setThinking(true);
                gatewayClient.chatSend(message, new FloatingGatewayClient.ResultCallback() {
                    @Override
                    public void onResult(JSONObject payload) {
                        if (payload != null) {
                            String runId = payload.optString("runId", null);
                            if (runId != null) currentRunId = runId;
                        }
                    }

                    @Override
                    public void onError(String msg) {
                        inputBar.setThinking(false);
                        inputBar.flashResponse("发送失败: " + msg, 3000);
                    }
                });
            } else {
                inputBar.flashResponse("AI 未连接", 2000);
            }
        });

        inputBar.setOnHomeListener(() -> {
            Intent homeIntent = new Intent(ClawOSFloatingService.this, MainActivity.class);
            homeIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(homeIntent);
        });

        inputBar.setOnMicListener(startListening -> {
            if (startListening) {
                startSTT();
            } else {
                stopSTT();
            }
        });

        inputBar.setOnFocusRequestListener(wantsFocus -> {
            setBarFocusable(wantsFocus);
            if (wantsFocus) {
                inputBar.requestInputFocus();
            } else {
                inputBar.clearInputFocus();
            }
        });

        // Bar dimensions: full width minus margins, 48dp height
        int barWidth = dm.widthPixels - (int) (32 * density);
        int barHeight = (int) (48 * density);

        barParams = new WindowManager.LayoutParams(
                barWidth, barHeight,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
        );
        barParams.gravity = Gravity.CENTER;
        barParams.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING;

        // Setup drag to reposition
        setupBarDrag();

        // Add to window (starts visible)
        windowManager.addView(inputBar, barParams);
        isBarVisible = true;
        Log.i(TAG, "Input bar added to WindowManager");
    }

    private void setupBarDrag() {
        inputBar.setOnTouchListener(new View.OnTouchListener() {
            private int initialY;
            private float initialTouchY;
            private boolean isDragging = false;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        initialY = barParams.y;
                        initialTouchY = event.getRawY();
                        isDragging = false;
                        return false;

                    case MotionEvent.ACTION_MOVE:
                        float dy = event.getRawY() - initialTouchY; // positive = down for CENTER gravity
                        if (Math.abs(dy) > 20) {
                            isDragging = true;
                        }
                        if (isDragging) {
                            barParams.y = initialY + (int) dy;
                            // Clamp: with CENTER gravity, y=0 is center; range ±(screenH/2 - barH/2)
                            int halfScreen = getResources().getDisplayMetrics().heightPixels / 2;
                            int maxY = halfScreen - barParams.height / 2;
                            barParams.y = Math.max(-maxY, Math.min(barParams.y, maxY));
                            try {
                                windowManager.updateViewLayout(inputBar, barParams);
                            } catch (Exception ignored) {}
                            return true;
                        }
                        return false;

                    case MotionEvent.ACTION_UP:
                        if (isDragging) return true;
                        return false;
                }
                return false;
            }
        });
    }

    private void removeViews() {
        try {
            if (isBarVisible && inputBar != null) {
                windowManager.removeView(inputBar);
                isBarVisible = false;
            }
        } catch (Exception e) {
            Log.w(TAG, "Error removing input bar", e);
        }
    }

    // ── Focus Management ────────────────────────────────────────

    /**
     * Toggle whether the overlay window can receive keyboard focus.
     * Default: non-focusable (FLAG_NOT_FOCUSABLE set) so the overlay
     * never steals input from the foreground app.
     * Only made focusable when the user explicitly taps the input field.
     */
    private void setBarFocusable(boolean focusable) {
        if (inputBar == null || !isBarVisible) return;
        if (focusable) {
            barParams.flags &= ~WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
        } else {
            barParams.flags |= WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
        }
        try {
            windowManager.updateViewLayout(inputBar, barParams);
        } catch (Exception e) {
            Log.w(TAG, "Failed to update bar focusability", e);
        }
    }

    // ── Visibility ──────────────────────────────────────────────

    private void hideBar() {
        isHidden = true;
        if (isBarVisible && inputBar != null) {
            setBarFocusable(false);
            inputBar.clearInputFocus();
            inputBar.setVisibility(View.GONE);
        }
    }

    private void showBar() {
        isHidden = false;
        if (isBarVisible && inputBar != null) {
            inputBar.setVisibility(View.VISIBLE);
        }
    }

    // ── Gateway ──────────────────────────────────────────────────

    private void initGateway() {
        String[] config = FloatingGatewayClient.loadConfig(getFilesDir());
        if (config == null) {
            gatewayInitRetries++;
            if (gatewayInitRetries <= MAX_GATEWAY_RETRIES) {
                long delay = 5000L * gatewayInitRetries;
                Log.w(TAG, "No gateway config found, retry " + gatewayInitRetries
                        + "/" + MAX_GATEWAY_RETRIES + " in " + delay + "ms");
                serviceHandler.postDelayed(this::initGateway, delay);
            } else {
                Log.w(TAG, "No gateway config found after retries");
            }
            return;
        }

        gatewayClient = new FloatingGatewayClient(config[0], config[1]);

        gatewayClient.setStatusListener(status -> {
            if (status.equals(lastGatewayStatus)) return;
            // Suppress intermediate "connecting" during reconnection
            if ("connecting".equals(status) &&
                    ("error".equals(lastGatewayStatus) || "disconnected".equals(lastGatewayStatus))) {
                return;
            }
            lastGatewayStatus = status;
            Log.i(TAG, "Gateway status: " + status);
            inputBar.setConnectionStatus(status);
        });

        gatewayClient.setChatListener((state, runId, text, errorMessage) -> {
            switch (state) {
                case "delta":
                    // Streaming – show brief thinking indicator
                    // (text accumulates on gateway side, we just wait for final)
                    break;
                case "final":
                    inputBar.setThinking(false);
                    currentRunId = null;
                    // Show brief text preview and speak via TTS (strip thinking blocks)
                    if (text != null && !text.isEmpty()) {
                        String cleanText = stripThinking(text);
                        if (!cleanText.isEmpty()) {
                            inputBar.flashResponse(cleanText, 5000);
                            speakAiResponse(cleanText);
                        }
                    }
                    break;
                case "error":
                    inputBar.setThinking(false);
                    currentRunId = null;
                    String errMsg = errorMessage != null ? errorMessage : "未知错误";
                    inputBar.flashResponse("错误: " + errMsg, 3000);
                    break;
                case "aborted":
                    inputBar.setThinking(false);
                    currentRunId = null;
                    break;
            }
        });

        gatewayClient.setAgentListener((stream, runId, data) -> {
            // Tool calls – could show brief indicator in future
        });

        gatewayClient.connect();
    }

    // ── Voice (STT + TTS) ──────────────────────────────────────

    private void initVoice() {
        String modelBase = SherpaSTTEngine.resolveModelBase();
        Log.i(TAG, "STT model base: " + (modelBase != null ? modelBase : "NOT FOUND"));
        Log.i(TAG, "STT available: " + SherpaSTTEngine.isAvailable());

        if (!SherpaSTTEngine.isAvailable()) {
            Log.w(TAG, "STT models not available, voice input disabled");
            return;
        }

        sttEngine = new SherpaSTTEngine(new SherpaSTTEngine.STTListener() {
            @Override
            public void onPartialResult(String text) {
                Log.d(TAG, "STT partial: " + text);
                serviceHandler.post(() -> inputBar.setPartialText(text));
            }

            @Override
            public void onFinalResult(String text) {
                Log.d(TAG, "STT final: " + text);
                serviceHandler.post(() -> inputBar.setPartialText(text));
            }

            @Override
            public void onError(String error) {
                Log.e(TAG, "STT error: " + error);
                serviceHandler.post(() -> inputBar.setMicActive(false));
            }
        });

        if (!sttEngine.init()) {
            Log.e(TAG, "Failed to initialize STT engine");
            sttEngine = null;
        }

        if (SherpaTTSEngine.isAvailable()) {
            ttsEngine = new SherpaTTSEngine(new SherpaTTSEngine.TTSListener() {
                @Override public void onSpeakStart() {}
                @Override public void onSpeakEnd() {}
                @Override
                public void onSpeakError(String error) {
                    Log.w(TAG, "TTS error: " + error);
                }
            });
            if (!ttsEngine.init()) {
                Log.e(TAG, "Failed to initialize TTS engine");
                ttsEngine = null;
            }
        }
    }

    private void startSTT() {
        if (sttEngine == null) {
            Log.w(TAG, "STT engine is null, voice input unavailable");
            inputBar.flashResponse("语音输入不可用", 2000);
            return;
        }
        Log.i(TAG, "Starting STT...");
        // Pause Activity's priming AudioRecord so this Service's AudioRecord gets audio
        // (Android emulator only routes audio to one AudioRecord at a time)
        MainActivity.pausePriming();
        sttEngine.startListening();
        inputBar.setMicActive(true);
    }

    private void stopSTT() {
        if (sttEngine != null) sttEngine.stopListening();
        inputBar.setMicActive(false);
        // Resume Activity's priming AudioRecord to keep mic route warm
        MainActivity.resumePriming();
    }

    /**
     * Strip LLM thinking/reasoning blocks (&lt;think&gt;...&lt;/think&gt;) from text.
     * Only removes complete blocks (with closing tag) to avoid removing actual content.
     */
    private String stripThinking(String text) {
        if (text == null) return "";
        // Remove complete <think>...</think> blocks only (multiline, lazy match)
        String result = text.replaceAll("(?si)<think[\\s>][\\s\\S]*?</think>", "");
        return result.trim();
    }

    /**
     * Speak the AI response text via TTS.
     * No length limit – the user explicitly wants TTS-driven responses.
     */
    private void speakAiResponse(String text) {
        if (!ttsEnabled || isHidden || ttsEngine == null || text == null || text.isEmpty()) return;
        String cleaned = stripThinking(text);
        if (!cleaned.isEmpty()) ttsEngine.speak(cleaned);
    }

    // ── Notification ─────────────────────────────────────────────

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "ClawOS AI 助理",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("ClawOS 悬浮 AI 助理服务");
            channel.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification() {
        Intent notifIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, notifIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }

        return builder
                .setContentTitle("ClawOS AI 助理")
                .setContentText("AI 助理正在运行")
                .setSmallIcon(android.R.drawable.ic_menu_info_details)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build();
    }
}
