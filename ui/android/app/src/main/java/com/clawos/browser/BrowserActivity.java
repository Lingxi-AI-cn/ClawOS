package com.clawos.browser;

import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

/**
 * WebView browser with a minimal navigation UI for user browsing,
 * plus CDP debugging support for AI-controlled automation.
 *
 * Launch modes:
 *   - Normal: shows URL bar + navigation buttons
 *   - Background: intent extra "background"=true -> loads about:blank,
 *     moves to back, keeps CDP proxy active for AI
 *   - URL: intent extra "url"="https://..." -> navigates directly
 */
public class BrowserActivity extends AppCompatActivity {

    private static final String TAG = "ClawOS.Browser";
    private static final String DEFAULT_URL = "https://www.baidu.com";

    private LinearLayout rootLayout;
    private WebView webView;
    private EditText urlBar;
    private ProgressBar progressBar;
    private TextView btnBack, btnForward, btnRefresh;
    private boolean backgroundMode = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        backgroundMode = getIntent().getBooleanExtra("background", false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        rootLayout = new LinearLayout(this);
        rootLayout.setOrientation(LinearLayout.VERTICAL);
        rootLayout.setBackgroundColor(Color.BLACK);

        if (!backgroundMode) {
            rootLayout.addView(createToolbar());
            rootLayout.addView(createProgressBar());
        }

        webView = new WebView(this);
        LinearLayout.LayoutParams webParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1.0f);
        webView.setLayoutParams(webParams);
        rootLayout.addView(webView);

        setContentView(rootLayout);
        configureWebView();
        enableImmersiveMode();

        String url;
        if (backgroundMode) {
            url = "about:blank";
        } else {
            url = getIntent().getStringExtra("url");
            if (TextUtils.isEmpty(url)) {
                url = DEFAULT_URL;
            }
        }
        webView.loadUrl(url);

        Log.i(TAG, "BrowserActivity created, background=" + backgroundMode + ", PID=" + android.os.Process.myPid());

        // Notify system that WebView CDP is ready (after a short delay for socket creation)
        webView.postDelayed(() -> {
            try {
                Runtime.getRuntime().exec(new String[]{
                    "sh", "-c",
                    "setprop clawos.browser.cdp.ready " + android.os.Process.myPid()
                });
                Log.i(TAG, "CDP ready notification sent (PID=" + android.os.Process.myPid() + ")");
            } catch (Exception e) {
                Log.w(TAG, "Failed to set CDP ready property: " + e.getMessage());
            }
        }, 1000);

        // CdpProxyService no longer needed: cdp-bridge.mjs (Node.js, shell user)
        // handles the TCP→Cromite socket bridge with proper SELinux permissions.

        if (backgroundMode) {
            webView.postDelayed(() -> {
                moveTaskToBack(true);
                Log.i(TAG, "Moved to background (CDP proxy remains active)");
            }, 500);
        }
    }

    private int dp(int value) {
        return (int) TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
    }

    private LinearLayout createToolbar() {
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setBackgroundColor(Color.parseColor("#0d0d1a"));
        int hPad = dp(6);
        int vPad = dp(6);
        toolbar.setPadding(hPad, vPad, hPad, vPad);
        toolbar.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        btnBack = addNavButton(toolbar, "\u25C0", v -> {
            if (webView.canGoBack()) webView.goBack();
        });
        btnForward = addNavButton(toolbar, "\u25B6", v -> {
            if (webView.canGoForward()) webView.goForward();
        });
        btnRefresh = addNavButton(toolbar, "\u21BB", v -> webView.reload());

        urlBar = new EditText(this);
        LinearLayout.LayoutParams urlParams = new LinearLayout.LayoutParams(0, dp(36), 1.0f);
        urlParams.setMargins(dp(6), 0, dp(6), 0);
        urlBar.setLayoutParams(urlParams);
        urlBar.setTextColor(Color.WHITE);
        urlBar.setHintTextColor(Color.parseColor("#666666"));
        urlBar.setHint("Search or enter URL");
        urlBar.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        urlBar.setSingleLine(true);

        GradientDrawable urlBg = new GradientDrawable();
        urlBg.setColor(Color.parseColor("#1a1a2e"));
        urlBg.setCornerRadius(dp(8));
        urlBar.setBackground(urlBg);
        urlBar.setPadding(dp(12), dp(4), dp(12), dp(4));
        urlBar.setImeOptions(EditorInfo.IME_ACTION_GO);
        urlBar.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO ||
                (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER
                        && event.getAction() == KeyEvent.ACTION_DOWN)) {
                navigateToInput(urlBar.getText().toString().trim());
                return true;
            }
            return false;
        });
        toolbar.addView(urlBar);

        addNavButton(toolbar, "\u2716", v -> finish());

        return toolbar;
    }

    private TextView addNavButton(LinearLayout parent, String symbol, View.OnClickListener listener) {
        TextView btn = new TextView(this);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(36), dp(36));
        params.setMargins(dp(2), 0, dp(2), 0);
        btn.setLayoutParams(params);
        btn.setText(symbol);
        btn.setTextColor(Color.parseColor("#22d3ee"));
        btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        btn.setGravity(Gravity.CENTER);
        btn.setTypeface(null, Typeface.BOLD);
        btn.setClickable(true);
        btn.setFocusable(true);
        btn.setOnClickListener(listener);
        parent.addView(btn);
        return btn;
    }

    private ProgressBar createProgressBar() {
        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(2));
        progressBar.setLayoutParams(params);
        progressBar.setMax(100);
        progressBar.setProgress(0);
        progressBar.setVisibility(View.GONE);
        return progressBar;
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setSupportMultipleWindows(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        String ua = settings.getUserAgentString();
        settings.setUserAgentString(ua + " ClawOS/1.0");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    return false;
                }
                Log.d(TAG, "Blocked non-http URL: " + uri.toString().substring(0, Math.min(100, uri.toString().length())));
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                Log.d(TAG, "Loading: " + url);
                if (urlBar != null) urlBar.setText(url);
                updateNavButtons();
                if (backgroundMode && url != null && !url.equals("about:blank")) {
                    backgroundMode = false;
                    bringToForeground();
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                Log.d(TAG, "Loaded: " + url);
                if (urlBar != null) urlBar.setText(url);
                updateNavButtons();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onReceivedTitle(WebView view, String title) {
                Log.d(TAG, "Title: " + title);
            }

            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (progressBar != null) {
                    if (newProgress < 100) {
                        progressBar.setVisibility(View.VISIBLE);
                        progressBar.setProgress(newProgress);
                    } else {
                        progressBar.setVisibility(View.GONE);
                    }
                }
            }
        });
    }

    private void updateNavButtons() {
        if (btnBack != null) btnBack.setAlpha(webView.canGoBack() ? 1.0f : 0.3f);
        if (btnForward != null) btnForward.setAlpha(webView.canGoForward() ? 1.0f : 0.3f);
    }

    private void navigateToInput(String input) {
        if (TextUtils.isEmpty(input)) return;

        String url;
        if (input.startsWith("http://") || input.startsWith("https://")) {
            url = input;
        } else if (input.contains(".") && !input.contains(" ")) {
            url = "https://" + input;
        } else {
            url = "https://www.google.com/search?q=" + Uri.encode(input);
        }
        webView.loadUrl(url);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String url = intent.getStringExtra("url");
        if (!TextUtils.isEmpty(url) && webView != null) {
            webView.loadUrl(url);
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }

    private void bringToForeground() {
        Log.i(TAG, "Bringing browser to foreground (CDP navigation detected)");
        runOnUiThread(() -> {
            if (urlBar == null && rootLayout != null && webView != null) {
                rootLayout.addView(createToolbar(), 0);
                rootLayout.addView(createProgressBar(), 1);
            }
        });
        Intent intent = new Intent(this, BrowserActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        startActivity(intent);
    }

    private void enableImmersiveMode() {
        Window window = getWindow();
        View decorView = window.getDecorView();
        decorView.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        );
        window.setStatusBarColor(Color.parseColor("#0d0d1a"));
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
