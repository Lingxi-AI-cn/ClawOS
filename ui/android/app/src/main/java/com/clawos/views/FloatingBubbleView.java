package com.clawos.views;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.view.View;

/**
 * Floating AI bubble – a 56dp draggable circle with ClawOS branding.
 *
 * Visual states:
 *   - Default: semi-transparent dark circle with "AI" text
 *   - Expanded: cyan border glow
 *   - Badge: small red dot with unread count
 *   - Connection status: border color changes
 */
public class FloatingBubbleView extends View {

    private final Paint bgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint borderPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint badgePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint badgeTextPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint glowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);

    private boolean expanded = false;
    private int badgeCount = 0;
    private String connectionStatus = "disconnected";

    // Colors matching ClawOS theme
    private static final int CYAN = 0xFF22D3EE;
    private static final int PURPLE = 0xFFA855F7;
    private static final int BG_COLOR = 0xE60A0F1E;      // Dark background with high alpha
    private static final int BORDER_DEFAULT = 0x66FFFFFF;  // White 40%
    private static final int BORDER_CONNECTED = CYAN;
    private static final int BORDER_ERROR = 0xFFF87171;
    private static final int BADGE_RED = 0xFFEF4444;

    public FloatingBubbleView(Context context) {
        super(context);
        setClickable(true);

        bgPaint.setStyle(Paint.Style.FILL);
        bgPaint.setColor(BG_COLOR);

        borderPaint.setStyle(Paint.Style.STROKE);
        borderPaint.setStrokeWidth(dp(2));

        textPaint.setColor(CYAN);
        textPaint.setTextSize(dp(16));
        textPaint.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        textPaint.setTextAlign(Paint.Align.CENTER);

        badgePaint.setStyle(Paint.Style.FILL);
        badgePaint.setColor(BADGE_RED);

        badgeTextPaint.setColor(Color.WHITE);
        badgeTextPaint.setTextSize(dp(9));
        badgeTextPaint.setTypeface(Typeface.DEFAULT_BOLD);
        badgeTextPaint.setTextAlign(Paint.Align.CENTER);

        glowPaint.setStyle(Paint.Style.STROKE);
        glowPaint.setStrokeWidth(dp(4));
    }

    public void setExpanded(boolean expanded) {
        this.expanded = expanded;
        invalidate();
    }

    public void setConnectionStatus(String status) {
        this.connectionStatus = status;
        invalidate();
    }

    public void incrementBadge() {
        badgeCount++;
        invalidate();
    }

    public void clearBadge() {
        badgeCount = 0;
        invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        float w = getWidth();
        float h = getHeight();
        float cx = w / 2f;
        float cy = h / 2f;
        float radius = Math.min(cx, cy) - dp(3);

        // Glow effect when expanded
        if (expanded) {
            glowPaint.setShader(new LinearGradient(0, 0, w, h, CYAN, PURPLE, Shader.TileMode.CLAMP));
            glowPaint.setAlpha(60);
            canvas.drawCircle(cx, cy, radius + dp(2), glowPaint);
        }

        // Background circle
        canvas.drawCircle(cx, cy, radius, bgPaint);

        // Border
        int borderColor;
        switch (connectionStatus) {
            case "connected":
                borderColor = expanded ? CYAN : BORDER_CONNECTED;
                break;
            case "error":
                borderColor = BORDER_ERROR;
                break;
            default:
                borderColor = BORDER_DEFAULT;
        }
        borderPaint.setColor(borderColor);
        canvas.drawCircle(cx, cy, radius, borderPaint);

        // "AI" text or ClawOS icon
        if (expanded) {
            textPaint.setColor(PURPLE);
        } else {
            textPaint.setColor(CYAN);
        }
        float textY = cy - (textPaint.descent() + textPaint.ascent()) / 2f;
        canvas.drawText("AI", cx, textY, textPaint);

        // Badge
        if (badgeCount > 0 && !expanded) {
            float badgeR = dp(8);
            float badgeX = w - dp(6);
            float badgeY = dp(6);
            canvas.drawCircle(badgeX, badgeY, badgeR, badgePaint);

            String countText = badgeCount > 9 ? "9+" : String.valueOf(badgeCount);
            float badgeTextY = badgeY - (badgeTextPaint.descent() + badgeTextPaint.ascent()) / 2f;
            canvas.drawText(countText, badgeX, badgeTextY, badgeTextPaint);
        }
    }

    private float dp(float dp) {
        return dp * getResources().getDisplayMetrics().density;
    }
}
