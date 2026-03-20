package com.clawos.views;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Floating mini chat panel – native Android views styled to match ClawOS theme.
 *
 * Layout:
 *   ┌──────────────────────────┐
 *   │ ClawOS AI ─── status ─ ✕ │  ← header
 *   ├──────────────────────────┤
 *   │                          │
 *   │  [message bubbles]       │  ← scrollable message area
 *   │                          │
 *   ├──────────────────────────┤
 *   │ [input___________] [➤]  │  ← input bar
 *   └──────────────────────────┘
 */
public class FloatingChatView extends FrameLayout {

    // Callbacks
    public interface OnSendListener { void onSend(String message); }
    public interface OnCloseListener { void onClose(); }
    public interface OnAbortListener { void onAbort(); }
    public interface OnMicListener { void onMicToggle(boolean startListening); }

    private OnSendListener sendListener;
    private OnCloseListener closeListener;
    private OnAbortListener abortListener;
    private OnMicListener micListener;

    // Views
    private LinearLayout messagesContainer;
    private ScrollView scrollView;
    private EditText inputField;
    private ImageButton sendButton;
    private ImageButton micButton;
    private TextView statusDot;
    private TextView headerStatus;

    // State
    private final Map<String, TextView> streamingMessages = new HashMap<>();
    private final Map<String, StringBuilder> streamingBuffers = new HashMap<>();
    private boolean isGenerating = false;
    private boolean isMicActive = false;
    private final Handler handler = new Handler(Looper.getMainLooper());

    // Theme colors
    private static final int BG_DARK = 0xF00D0B1F;
    private static final int BORDER_COLOR = 0x33FFFFFF;
    private static final int CYAN = 0xFF22D3EE;
    private static final int PURPLE = 0xFFA855F7;
    private static final int USER_BUBBLE_BG = 0x5908919A;         // rgba(8,145,178,0.35)
    private static final int USER_BUBBLE_BORDER = 0x8022D3EE;     // rgba(34,211,238,0.5)
    private static final int USER_TEXT_COLOR = 0xFFA5F3FC;
    private static final int AI_BUBBLE_BG = 0x596B21A8;           // rgba(107,33,168,0.35)
    private static final int AI_BUBBLE_BORDER = 0x80A855F7;       // rgba(168,85,247,0.5)
    private static final int AI_TEXT_COLOR = 0xFFE9D5FF;
    private static final int SYSTEM_TEXT_COLOR = 0x80FFFFFF;
    private static final int INPUT_BG = 0x15FFFFFF;
    private static final int INPUT_BORDER = 0x1AFFFFFF;

    public FloatingChatView(Context context) {
        super(context);
        buildUI();
    }

    public void setOnSendListener(OnSendListener l) { sendListener = l; }
    public void setOnCloseListener(OnCloseListener l) { closeListener = l; }
    public void setOnAbortListener(OnAbortListener l) { abortListener = l; }
    public void setOnMicListener(OnMicListener l) { micListener = l; }

    private void buildUI() {
        // Root container with rounded corners and dark background
        GradientDrawable rootBg = new GradientDrawable();
        rootBg.setColor(BG_DARK);
        rootBg.setCornerRadius(dp(20));
        rootBg.setStroke(dp(1), BORDER_COLOR);
        setBackground(rootBg);
        setPadding(dp(2), dp(2), dp(2), dp(2));

        LinearLayout root = new LinearLayout(getContext());
        root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutParams(new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));

        // ── Header ──────────────────────────────────────────────
        LinearLayout header = new LinearLayout(getContext());
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(14), dp(10), dp(8), dp(8));

        // Status dot
        statusDot = new TextView(getContext());
        statusDot.setText("●");
        statusDot.setTextSize(TypedValue.COMPLEX_UNIT_SP, 8);
        statusDot.setTextColor(0x80FFFFFF);
        header.addView(statusDot, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        // Title
        TextView title = new TextView(getContext());
        title.setText(" ClawOS AI");
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        title.setTextColor(CYAN);
        title.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        title.setPadding(dp(4), 0, 0, 0);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        header.addView(title, titleParams);

        // Status text
        headerStatus = new TextView(getContext());
        headerStatus.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        headerStatus.setTextColor(0x66FFFFFF);
        headerStatus.setPadding(0, 0, dp(8), 0);
        header.addView(headerStatus);

        // Close button
        TextView closeBtn = new TextView(getContext());
        closeBtn.setText("✕");
        closeBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        closeBtn.setTextColor(0x66FFFFFF);
        closeBtn.setPadding(dp(8), dp(4), dp(8), dp(4));
        closeBtn.setOnClickListener(v -> {
            if (closeListener != null) closeListener.onClose();
        });
        header.addView(closeBtn);

        root.addView(header, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        // Divider
        View divider = new View(getContext());
        divider.setBackgroundColor(0x1AFFFFFF);
        root.addView(divider, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(1)));

        // ── Messages Area ───────────────────────────────────────
        scrollView = new ScrollView(getContext());
        scrollView.setFillViewport(true);
        scrollView.setVerticalScrollBarEnabled(false);

        messagesContainer = new LinearLayout(getContext());
        messagesContainer.setOrientation(LinearLayout.VERTICAL);
        messagesContainer.setPadding(dp(10), dp(8), dp(10), dp(8));
        scrollView.addView(messagesContainer, new LayoutParams(
                LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));

        LinearLayout.LayoutParams scrollParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f);
        root.addView(scrollView, scrollParams);

        // ── Input Bar ───────────────────────────────────────────
        LinearLayout inputBar = new LinearLayout(getContext());
        inputBar.setOrientation(LinearLayout.HORIZONTAL);
        inputBar.setGravity(Gravity.CENTER_VERTICAL);
        inputBar.setPadding(dp(10), dp(6), dp(8), dp(10));

        // Input field
        inputField = new EditText(getContext());
        inputField.setHint("Ask ClawOS...");
        inputField.setHintTextColor(0x40FFFFFF);
        inputField.setTextColor(0xE6FFFFFF);
        inputField.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        inputField.setSingleLine(true);
        inputField.setImeOptions(EditorInfo.IME_ACTION_SEND);
        inputField.setBackgroundColor(Color.TRANSPARENT);
        inputField.setPadding(dp(12), dp(8), dp(12), dp(8));

        GradientDrawable inputBg = new GradientDrawable();
        inputBg.setColor(INPUT_BG);
        inputBg.setCornerRadius(dp(14));
        inputBg.setStroke(dp(1), INPUT_BORDER);
        inputField.setBackground(inputBg);

        inputField.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_SEND) {
                doSend();
                return true;
            }
            return false;
        });

        LinearLayout.LayoutParams inputParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        inputParams.setMargins(0, 0, dp(4), 0);
        inputBar.addView(inputField, inputParams);

        // Mic button
        micButton = new ImageButton(getContext());
        micButton.setImageResource(android.R.drawable.ic_btn_speak_now);
        micButton.setColorFilter(0xCCFFFFFF);
        micButton.setBackgroundColor(Color.TRANSPARENT);
        micButton.setPadding(dp(6), dp(6), dp(6), dp(6));
        micButton.setOnClickListener(v -> toggleMic());
        inputBar.addView(micButton, new LinearLayout.LayoutParams(dp(36), dp(36)));

        // Send button
        sendButton = new ImageButton(getContext());
        sendButton.setImageResource(android.R.drawable.ic_menu_send);
        sendButton.setColorFilter(CYAN);
        sendButton.setBackgroundColor(Color.TRANSPARENT);
        sendButton.setPadding(dp(6), dp(6), dp(6), dp(6));
        sendButton.setOnClickListener(v -> doSend());
        inputBar.addView(sendButton, new LinearLayout.LayoutParams(dp(36), dp(36)));

        root.addView(inputBar, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        addView(root);

        // Welcome message
        addSystemMessage("ClawOS AI 助理已就绪");
    }

    // ── Public API ──────────────────────────────────────────────

    public void setConnectionStatus(String status) {
        handler.post(() -> {
            switch (status) {
                case "connected":
                    statusDot.setTextColor(0xFF34D399); // Green
                    headerStatus.setText("已连接");
                    break;
                case "connecting":
                    statusDot.setTextColor(0xFFFBBF24); // Yellow
                    headerStatus.setText("连接中...");
                    break;
                case "error":
                    statusDot.setTextColor(0xFFF87171); // Red
                    headerStatus.setText("连接错误");
                    break;
                default:
                    statusDot.setTextColor(0x80FFFFFF); // Gray
                    headerStatus.setText("未连接");
            }
        });
    }

    public void addUserMessage(String text) {
        handler.post(() -> {
            addBubble(text, true);
            isGenerating = true;
        });
    }

    /**
     * Add a complete AI message bubble (used for history restoration).
     */
    public void addAiMessage(String text) {
        handler.post(() -> {
            addBubble(text, false);
        });
    }

    public void addSystemMessage(String text) {
        handler.post(() -> {
            TextView tv = new TextView(getContext());
            tv.setText(text);
            tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
            tv.setTextColor(SYSTEM_TEXT_COLOR);
            tv.setGravity(Gravity.CENTER);
            tv.setPadding(dp(8), dp(6), dp(8), dp(6));

            GradientDrawable bg = new GradientDrawable();
            bg.setColor(0x15FFFFFF);
            bg.setCornerRadius(dp(12));
            tv.setBackground(bg);

            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            params.gravity = Gravity.CENTER_HORIZONTAL;
            params.setMargins(0, dp(4), 0, dp(4));
            messagesContainer.addView(tv, params);
            scrollToBottom();
        });
    }

    public void appendAiText(String runId, String text) {
        handler.post(() -> {
            if (TextUtils.isEmpty(text)) return;

            if (!streamingMessages.containsKey(runId)) {
                // Create new AI message bubble and add to container
                TextView tv = createBubble("", false);
                LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
                p.gravity = Gravity.START;
                p.setMargins(dp(4), dp(3), dp(40), dp(3));
                messagesContainer.addView(tv, p);
                streamingMessages.put(runId, tv);
                streamingBuffers.put(runId, new StringBuilder());
            }

            StringBuilder buffer = streamingBuffers.get(runId);
            if (buffer != null) {
                buffer.append(text);
                TextView tv = streamingMessages.get(runId);
                if (tv != null) {
                    tv.setText(buffer.toString());
                }
            }
            scrollToBottom();
        });
    }

    public void finalizeAiMessage(String runId, String finalText) {
        handler.post(() -> {
            TextView tv = streamingMessages.remove(runId);
            StringBuilder buffer = streamingBuffers.remove(runId);

            if (tv != null) {
                if (finalText != null && !finalText.isEmpty()) {
                    tv.setText(finalText);
                } else if (buffer != null) {
                    tv.setText(buffer.toString());
                }
            } else if (finalText != null && !finalText.isEmpty()) {
                addBubble(finalText, false);
            }

            isGenerating = false;
            scrollToBottom();
        });
    }

    public void addToolCallIndicator(String toolName) {
        handler.post(() -> {
            TextView tv = new TextView(getContext());
            tv.setText("🔧 " + toolName);
            tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
            tv.setTextColor(0xB3A855F7);
            tv.setPadding(dp(12), dp(2), dp(12), dp(2));

            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            params.gravity = Gravity.START;
            params.setMargins(dp(8), dp(1), 0, dp(1));
            messagesContainer.addView(tv, params);
            scrollToBottom();
        });
    }

    /**
     * Clear all messages from the chat panel. Used before restoring history.
     */
    public void clearMessages() {
        handler.post(() -> {
            messagesContainer.removeAllViews();
            streamingMessages.clear();
            streamingBuffers.clear();
            isGenerating = false;
        });
    }

    public void focusInput() {
        handler.postDelayed(() -> {
            inputField.requestFocus();
            InputMethodManager imm = (InputMethodManager) getContext().getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) imm.showSoftInput(inputField, InputMethodManager.SHOW_IMPLICIT);
        }, 200);
    }

    // ── Mic control ──────────────────────────────────────────────

    private void toggleMic() {
        boolean newState = !isMicActive;
        if (micListener != null) micListener.onMicToggle(newState);
    }

    /**
     * Update mic button visual state. Called by the service after STT starts/stops.
     */
    public void setMicActive(boolean active) {
        handler.post(() -> {
            isMicActive = active;
            if (active) {
                // Red tint when recording
                micButton.setColorFilter(0xFFEF4444);
                // Pulsing alpha animation
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
     * Set the input field text from STT partial results (replaces existing text).
     */
    public void setPartialText(String text) {
        handler.post(() -> {
            inputField.setText(text);
            inputField.setSelection(text.length());
        });
    }

    // ── Internal ────────────────────────────────────────────────

    private void doSend() {
        String text = inputField.getText().toString().trim();
        if (text.isEmpty() || isGenerating) return;
        // If mic was active, stop it before sending
        if (isMicActive && micListener != null) {
            micListener.onMicToggle(false);
        }
        inputField.setText("");
        if (sendListener != null) sendListener.onSend(text);
    }

    private void addBubble(String text, boolean isUser) {
        TextView tv = createBubble(text, isUser);

        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        params.gravity = isUser ? Gravity.END : Gravity.START;
        params.setMargins(
                isUser ? dp(40) : dp(4), dp(3),
                isUser ? dp(4) : dp(40), dp(3));
        messagesContainer.addView(tv, params);
        scrollToBottom();
    }

    /**
     * Create a styled bubble TextView without adding it to the container.
     * The caller is responsible for calling addView().
     */
    private TextView createBubble(String text, boolean isUser) {
        TextView tv = new TextView(getContext());
        tv.setText(text);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        tv.setTextColor(isUser ? USER_TEXT_COLOR : AI_TEXT_COLOR);
        tv.setLineSpacing(dp(2), 1f);
        tv.setMaxWidth((int) (getResources().getDisplayMetrics().widthPixels * 0.65));

        GradientDrawable bg = new GradientDrawable();
        bg.setColor(isUser ? USER_BUBBLE_BG : AI_BUBBLE_BG);
        bg.setStroke(dp(1), isUser ? USER_BUBBLE_BORDER : AI_BUBBLE_BORDER);

        if (isUser) {
            bg.setCornerRadii(new float[]{
                    dp(14), dp(14), dp(14), dp(14),
                    dp(4), dp(4), dp(14), dp(14)});
        } else {
            bg.setCornerRadii(new float[]{
                    dp(14), dp(14), dp(14), dp(14),
                    dp(14), dp(14), dp(4), dp(4)});
        }
        tv.setBackground(bg);
        tv.setPadding(dp(12), dp(8), dp(12), dp(8));

        return tv;
    }

    private void scrollToBottom() {
        handler.post(() -> scrollView.fullScroll(ScrollView.FOCUS_DOWN));
    }

    private int dp(float dp) {
        return (int) (dp * getResources().getDisplayMetrics().density);
    }
}
