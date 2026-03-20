package com.clawos.views;

import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.animation.LinearInterpolator;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Minimal floating input bar for the AI assistant overlay.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────┐
 *   │ [●] [🎤] [  Ask ClawOS...              ] [➤] │
 *   └──────────────────────────────────────────────┘
 *
 * Semi-transparent, always-visible (when outside ClawOS main UI).
 * AI responses are delivered via TTS, not shown in a chat panel.
 */
public class FloatingInputBar extends FrameLayout {

    // Callbacks
    public interface OnSendListener { void onSend(String message); }
    public interface OnMicListener { void onMicToggle(boolean startListening); }
    public interface OnHomeListener { void onHome(); }
    public interface OnFocusRequestListener { void onFocusRequest(boolean wantsFocus); }

    private OnSendListener sendListener;
    private OnMicListener micListener;
    private OnHomeListener homeListener;
    private OnFocusRequestListener focusRequestListener;

    // Views
    private TextView statusDot;
    private TextView homeButton;
    private ImageButton micButton;
    private EditText inputField;
    private ImageButton sendButton;
    private TextView statusHint; // Brief overlay hint for AI status

    // State
    private boolean isMicActive = false;
    private boolean isThinking = false;
    private ObjectAnimator workingAnimator;

    // Theme colors (matching ClawOS cyberpunk theme)
    private static final int BAR_BG = 0xCC0D0B1F;         // 80% opaque dark
    private static final int BORDER_COLOR = 0x33FFFFFF;
    private static final int CYAN = 0xFF22D3EE;
    private static final int PURPLE = 0xFFA855F7;
    private static final int INPUT_BG = 0x15FFFFFF;
    private static final int INPUT_BORDER = 0x1AFFFFFF;

    public FloatingInputBar(Context context) {
        super(context);
        buildUI();
    }

    public void setOnSendListener(OnSendListener l) { sendListener = l; }
    public void setOnMicListener(OnMicListener l) { micListener = l; }
    public void setOnHomeListener(OnHomeListener l) { homeListener = l; }
    public void setOnFocusRequestListener(OnFocusRequestListener l) { focusRequestListener = l; }

    private void buildUI() {
        // Root bar with rounded corners and semi-transparent background
        GradientDrawable rootBg = new GradientDrawable();
        rootBg.setColor(BAR_BG);
        rootBg.setCornerRadius(dp(24));
        rootBg.setStroke(dp(1), BORDER_COLOR);
        setBackground(rootBg);
        setPadding(dp(6), dp(4), dp(6), dp(4));

        LinearLayout row = new LinearLayout(getContext());
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setLayoutParams(new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));

        // ── Status dot ──
        statusDot = new TextView(getContext());
        statusDot.setText("●");
        statusDot.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        statusDot.setTextColor(0x80FFFFFF); // Gray until connected
        statusDot.setPadding(dp(6), 0, dp(2), 0);
        row.addView(statusDot, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));

        // ── Home button ──
        homeButton = new TextView(getContext());
        homeButton.setText("⌂");
        homeButton.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        homeButton.setTextColor(CYAN);
        homeButton.setGravity(Gravity.CENTER);
        homeButton.setPadding(dp(4), 0, dp(4), 0);
        homeButton.setClickable(true);
        homeButton.setFocusable(true);
        homeButton.setOnClickListener(v -> {
            if (homeListener != null) homeListener.onHome();
        });
        row.addView(homeButton, new LinearLayout.LayoutParams(dp(28), dp(36)));

        // ── Mic button ──
        micButton = new ImageButton(getContext());
        micButton.setImageResource(android.R.drawable.ic_btn_speak_now);
        micButton.setColorFilter(0xCCFFFFFF);
        micButton.setBackgroundColor(Color.TRANSPARENT);
        micButton.setPadding(dp(4), dp(4), dp(4), dp(4));
        micButton.setOnClickListener(v -> toggleMic());
        row.addView(micButton, new LinearLayout.LayoutParams(dp(36), dp(36)));

        // ── Input field ──
        inputField = new EditText(getContext());
        inputField.setHint("Ask ClawOS...");
        inputField.setHintTextColor(0x40FFFFFF);
        inputField.setTextColor(0xE6FFFFFF);
        inputField.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        inputField.setSingleLine(true);
        inputField.setImeOptions(EditorInfo.IME_ACTION_SEND);
        inputField.setBackgroundColor(Color.TRANSPARENT);
        inputField.setPadding(dp(10), dp(6), dp(10), dp(6));

        GradientDrawable inputBg = new GradientDrawable();
        inputBg.setColor(INPUT_BG);
        inputBg.setCornerRadius(dp(16));
        inputBg.setStroke(dp(1), INPUT_BORDER);
        inputField.setBackground(inputBg);

        inputField.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_SEND) {
                doSend();
                return true;
            }
            return false;
        });

        inputField.setOnClickListener(v -> {
            if (focusRequestListener != null) focusRequestListener.onFocusRequest(true);
        });

        LinearLayout.LayoutParams inputParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        inputParams.setMargins(dp(4), 0, dp(4), 0);
        row.addView(inputField, inputParams);

        // ── Send button ──
        sendButton = new ImageButton(getContext());
        sendButton.setImageResource(android.R.drawable.ic_menu_send);
        sendButton.setColorFilter(CYAN);
        sendButton.setBackgroundColor(Color.TRANSPARENT);
        sendButton.setPadding(dp(4), dp(4), dp(4), dp(4));
        sendButton.setOnClickListener(v -> doSend());
        row.addView(sendButton, new LinearLayout.LayoutParams(dp(36), dp(36)));

        addView(row);
    }

    // ── Public API ──────────────────────────────────────────────

    public void setConnectionStatus(String status) {
        post(() -> {
            switch (status) {
                case "connected":
                    statusDot.setTextColor(0xFF34D399); // Green
                    break;
                case "connecting":
                    statusDot.setTextColor(0xFFFBBF24); // Yellow
                    break;
                case "error":
                    statusDot.setTextColor(0xFFF87171); // Red
                    break;
                default:
                    statusDot.setTextColor(0x80FFFFFF); // Gray
            }
        });
    }

    /**
     * Show an "executing" indicator: change hint text, replace mic icon
     * with a rotating sync icon to prevent accidental recording.
     */
    public void setThinking(boolean thinking) {
        post(() -> {
            isThinking = thinking;
            if (thinking) {
                inputField.setHint("AI 正在执行指令...");
                inputField.setEnabled(false);
                sendButton.setEnabled(false);
                sendButton.setColorFilter(0x40FFFFFF);
                // Replace mic with rotating work indicator
                micButton.setImageResource(android.R.drawable.ic_popup_sync);
                micButton.setColorFilter(PURPLE);
                micButton.setEnabled(false);
                startWorkingAnimation();
            } else {
                inputField.setHint("Ask ClawOS...");
                inputField.setEnabled(true);
                sendButton.setEnabled(true);
                sendButton.setColorFilter(CYAN);
                // Restore mic button
                stopWorkingAnimation();
                micButton.setImageResource(android.R.drawable.ic_btn_speak_now);
                micButton.setColorFilter(0xCCFFFFFF);
                micButton.setEnabled(true);
            }
        });
    }

    /**
     * Show a brief response preview in the input field hint, then clear.
     */
    public void flashResponse(String text, int durationMs) {
        post(() -> {
            if (text == null || text.isEmpty()) return;
            // Show truncated response as hint
            String preview = text.length() > 60 ? text.substring(0, 60) + "..." : text;
            inputField.setHint("AI: " + preview);
            // Clear after duration
            postDelayed(() -> {
                if (!isThinking) {
                    inputField.setHint("Ask ClawOS...");
                }
            }, durationMs);
        });
    }

    /**
     * Set partial STT text in the input field.
     */
    public void setPartialText(String text) {
        post(() -> {
            inputField.setText(text);
            inputField.setSelection(text.length());
        });
    }

    /**
     * Update mic button visual state.
     */
    public void setMicActive(boolean active) {
        post(() -> {
            isMicActive = active;
            if (active) {
                micButton.setColorFilter(0xFFEF4444); // Red when recording
                micButton.animate().alpha(0.5f).setDuration(500)
                        .withEndAction(() -> {
                            if (isMicActive) micButton.animate().alpha(1f).setDuration(500).start();
                        }).start();
            } else {
                micButton.clearAnimation();
                micButton.setAlpha(1f);
                micButton.setColorFilter(0xCCFFFFFF);
            }
        });
    }

    /**
     * Intercept ACTION_OUTSIDE events: when the user taps anywhere outside
     * the floating bar, release keyboard focus back to the foreground app.
     * Requires FLAG_WATCH_OUTSIDE_TOUCH on the overlay window.
     */
    @Override
    public boolean dispatchTouchEvent(MotionEvent event) {
        if (event.getAction() == MotionEvent.ACTION_OUTSIDE) {
            if (focusRequestListener != null) {
                focusRequestListener.onFocusRequest(false);
            }
            return true;
        }
        return super.dispatchTouchEvent(event);
    }

    // ── Internal ────────────────────────────────────────────────

    private void toggleMic() {
        if (isThinking) return; // Don't allow recording while AI is executing
        boolean newState = !isMicActive;
        isMicActive = newState;
        if (micListener != null) micListener.onMicToggle(newState);
    }

    private void doSend() {
        String text = inputField.getText().toString().trim();
        if (text.isEmpty() || isThinking) return;
        if (isMicActive && micListener != null) {
            micListener.onMicToggle(false);
        }
        inputField.setText("");
        inputField.clearFocus();
        if (sendListener != null) sendListener.onSend(text);
        if (focusRequestListener != null) focusRequestListener.onFocusRequest(false);
    }

    /** Explicitly request focus on the input field and show the keyboard. */
    public void requestInputFocus() {
        post(() -> {
            inputField.requestFocus();
            InputMethodManager imm = (InputMethodManager) getContext()
                    .getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) {
                imm.showSoftInput(inputField, InputMethodManager.SHOW_IMPLICIT);
            }
        });
    }

    /** Clear focus from the input field and hide the keyboard. */
    public void clearInputFocus() {
        post(() -> {
            inputField.clearFocus();
            InputMethodManager imm = (InputMethodManager) getContext()
                    .getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) {
                imm.hideSoftInputFromWindow(inputField.getWindowToken(), 0);
            }
        });
    }

    private void startWorkingAnimation() {
        workingAnimator = ObjectAnimator.ofFloat(micButton, "rotation", 0f, 360f);
        workingAnimator.setDuration(1500);
        workingAnimator.setRepeatCount(ValueAnimator.INFINITE);
        workingAnimator.setInterpolator(new LinearInterpolator());
        workingAnimator.start();
    }

    private void stopWorkingAnimation() {
        if (workingAnimator != null) {
            workingAnimator.cancel();
            workingAnimator = null;
        }
        micButton.setRotation(0f);
    }

    private int dp(float dp) {
        return (int) (dp * getResources().getDisplayMetrics().density);
    }
}
