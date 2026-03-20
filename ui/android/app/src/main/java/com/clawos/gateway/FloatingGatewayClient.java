package com.clawos.gateway;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * Java WebSocket client for OpenClaw Gateway – used by the floating overlay.
 *
 * Mirrors the logic in ui/src/gateway/client.ts but uses OkHttp WebSocket.
 * Communicates with the Gateway at ws://localhost:18789.
 */
public class FloatingGatewayClient {

    private static final String TAG = "FloatingGateway";
    private static final int NORMAL_CLOSE = 1000;

    private final String wsUrl;
    private final String token;
    private final OkHttpClient httpClient;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Map<String, PendingRequest> pendingRequests = new ConcurrentHashMap<>();

    private WebSocket webSocket;
    private boolean handshakeSent = false;
    private boolean disposed = false;
    private int reconnectAttempts = 0;
    private static final int MAX_RECONNECT_ATTEMPTS = 10;

    // Callbacks (set by the service)
    private StatusListener statusListener;
    private ChatEventListener chatListener;
    private AgentEventListener agentListener;

    public interface StatusListener {
        void onStatusChanged(String status); // "connecting", "connected", "disconnected", "error"
    }

    public interface ChatEventListener {
        void onChatEvent(String state, String runId, String text, String errorMessage);
    }

    public interface AgentEventListener {
        void onAgentEvent(String stream, String runId, JSONObject data);
    }

    private static class PendingRequest {
        final ResultCallback callback;
        PendingRequest(ResultCallback cb) { this.callback = cb; }
    }

    public interface ResultCallback {
        void onResult(JSONObject payload);
        void onError(String message);
    }

    public FloatingGatewayClient(String wsUrl, String token) {
        this.wsUrl = wsUrl;
        this.token = token;
        this.httpClient = new OkHttpClient.Builder()
                .readTimeout(0, TimeUnit.MILLISECONDS) // No read timeout for WebSocket
                .build();
    }

    public void setStatusListener(StatusListener listener) { this.statusListener = listener; }
    public void setChatListener(ChatEventListener listener) { this.chatListener = listener; }
    public void setAgentListener(AgentEventListener listener) { this.agentListener = listener; }

    // ── Connection management ────────────────────────────────────

    public void connect() {
        if (disposed) return;
        if (webSocket != null) return;

        notifyStatus("connecting");
        handshakeSent = false;

        // Must send an Origin header matching the Gateway's allowedOrigins.
        // Capacitor WebView connects from http://localhost, so we use the same.
        Request request = new Request.Builder()
                .url(wsUrl)
                .header("Origin", "http://localhost")
                .build();
        webSocket = httpClient.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket ws, Response response) {
                Log.i(TAG, "WebSocket connected");
                reconnectAttempts = 0;
                // Fallback: send handshake after 1.5s if challenge not received
                mainHandler.postDelayed(() -> {
                    if (webSocket != null && !handshakeSent) {
                        sendHandshake();
                    }
                }, 1500);
            }

            @Override
            public void onMessage(WebSocket ws, String text) {
                try {
                    JSONObject frame = new JSONObject(text);
                    mainHandler.post(() -> handleFrame(frame));
                } catch (JSONException e) {
                    Log.e(TAG, "Failed to parse frame", e);
                }
            }

            @Override
            public void onClosing(WebSocket ws, int code, String reason) {
                ws.close(NORMAL_CLOSE, null);
            }

            @Override
            public void onClosed(WebSocket ws, int code, String reason) {
                Log.i(TAG, "WebSocket closed: " + code + " " + reason);
                webSocket = null;
                rejectAllPending("Connection closed");
                notifyStatus("disconnected");
                if (!disposed) scheduleReconnect();
            }

            @Override
            public void onFailure(WebSocket ws, Throwable t, Response response) {
                Log.e(TAG, "WebSocket failure", t);
                webSocket = null;
                rejectAllPending(t.getMessage());
                notifyStatus("error");
                if (!disposed) scheduleReconnect();
            }
        });
    }

    public void disconnect() {
        disposed = true;
        mainHandler.removeCallbacksAndMessages(null);
        if (webSocket != null) {
            webSocket.close(NORMAL_CLOSE, "Client disconnect");
            webSocket = null;
        }
        rejectAllPending("Client disconnected");
    }

    public boolean isConnected() {
        return webSocket != null;
    }

    // ── RPC Methods ─────────────────────────────────────────────

    public void chatSend(String message, ResultCallback callback) {
        try {
            String idempotencyKey = UUID.randomUUID().toString();
            JSONObject params = GatewayProtocol.chatSendParams(message, "floating", idempotencyKey);
            sendRequest("chat.send", params, callback);
        } catch (JSONException e) {
            callback.onError("Failed to build request: " + e.getMessage());
        }
    }

    /**
     * Fetch chat history for the floating session.
     */
    public void chatHistory(ResultCallback callback) {
        try {
            JSONObject params = new JSONObject();
            params.put("sessionKey", "floating");
            sendRequest("chat.history", params, callback);
        } catch (JSONException e) {
            callback.onError("Failed to build request: " + e.getMessage());
        }
    }

    public void chatAbort(String runId) {
        try {
            JSONObject params = GatewayProtocol.chatAbortParams("floating", runId);
            sendRequest("chat.abort", params, new ResultCallback() {
                @Override public void onResult(JSONObject payload) {}
                @Override public void onError(String message) {
                    Log.w(TAG, "chat.abort failed: " + message);
                }
            });
        } catch (JSONException e) {
            Log.e(TAG, "Failed to build abort request", e);
        }
    }

    // ── Internal ────────────────────────────────────────────────

    private void sendHandshake() {
        if (handshakeSent) return;
        handshakeSent = true;
        Log.i(TAG, "Sending connect handshake");

        try {
            JSONObject params = GatewayProtocol.connectParams(token);
            sendRequest("connect", params, new ResultCallback() {
                @Override
                public void onResult(JSONObject payload) {
                    Log.i(TAG, "Gateway handshake OK");
                    notifyStatus("connected");
                }
                @Override
                public void onError(String message) {
                    Log.e(TAG, "Handshake failed: " + message);
                    notifyStatus("error");
                    if (webSocket != null) {
                        webSocket.close(NORMAL_CLOSE, "Handshake failed");
                    }
                }
            });
        } catch (JSONException e) {
            Log.e(TAG, "Failed to build handshake", e);
        }
    }

    private void sendRequest(String method, JSONObject params, ResultCallback callback) {
        if (webSocket == null) {
            callback.onError("Not connected");
            return;
        }
        try {
            String id = UUID.randomUUID().toString();
            JSONObject frame = GatewayProtocol.request(id, method, params);
            pendingRequests.put(id, new PendingRequest(callback));
            webSocket.send(frame.toString());

            // Timeout after 30s
            mainHandler.postDelayed(() -> {
                PendingRequest pending = pendingRequests.remove(id);
                if (pending != null) {
                    pending.callback.onError("Request " + method + " timed out");
                }
            }, 30000);
        } catch (JSONException e) {
            callback.onError("JSON error: " + e.getMessage());
        }
    }

    private void handleFrame(JSONObject frame) {
        String type = frame.optString("type", "");
        switch (type) {
            case "res":
                handleResponse(frame);
                break;
            case "event":
                handleEvent(frame);
                break;
            default:
                Log.w(TAG, "Unknown frame type: " + type);
        }
    }

    private void handleResponse(JSONObject frame) {
        String id = frame.optString("id", "");
        PendingRequest pending = pendingRequests.remove(id);
        if (pending == null) return;

        if (GatewayProtocol.isOkResponse(frame)) {
            pending.callback.onResult(frame.optJSONObject("payload"));
        } else {
            pending.callback.onError(GatewayProtocol.getErrorMessage(frame));
        }
    }

    private void handleEvent(JSONObject frame) {
        String event = GatewayProtocol.getEventName(frame);
        JSONObject payload = GatewayProtocol.getEventPayload(frame);

        switch (event) {
            case "connect.challenge":
                Log.i(TAG, "Received connect.challenge");
                sendHandshake();
                break;

            case "chat":
                if (chatListener != null && payload != null) {
                    String state = GatewayProtocol.getChatState(payload);
                    String runId = GatewayProtocol.getRunId(payload);
                    String text = GatewayProtocol.extractTextContent(payload);
                    String errorMsg = payload.optString("errorMessage", null);
                    chatListener.onChatEvent(state, runId, text, errorMsg);
                }
                break;

            case "agent":
                if (agentListener != null && payload != null) {
                    String stream = GatewayProtocol.getAgentStream(payload);
                    String runId = GatewayProtocol.getRunId(payload);
                    JSONObject data = GatewayProtocol.getAgentData(payload);
                    agentListener.onAgentEvent(stream, runId, data);
                }
                break;

            case "tick":
                // Keepalive, ignore
                break;

            default:
                Log.d(TAG, "Unhandled event: " + event);
        }
    }

    private void scheduleReconnect() {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            Log.e(TAG, "Max reconnect attempts reached");
            notifyStatus("error");
            return;
        }
        // Start with 3s delay, exponential backoff up to 60s
        long delay = Math.min(3000L * (1L << reconnectAttempts), 60000L);
        reconnectAttempts++;
        Log.i(TAG, "Reconnecting in " + delay + "ms (attempt " + reconnectAttempts + ")");
        mainHandler.postDelayed(this::connect, delay);
    }

    private void rejectAllPending(String reason) {
        for (PendingRequest pending : pendingRequests.values()) {
            pending.callback.onError(reason);
        }
        pendingRequests.clear();
    }

    private void notifyStatus(String status) {
        if (statusListener != null) {
            mainHandler.post(() -> statusListener.onStatusChanged(status));
        }
    }

    // ── Config loading helper ───────────────────────────────────

    /**
     * Try to read the gateway config from multiple locations.
     * Search order matches ClawOSBridge.readGatewayConfig():
     *   1. App files dir (copied by start-gateway.sh at boot)
     *   2. System config dir (/data/local/tmp/clawos/)
     *   3. ROM default config (/product/etc/clawos/)
     */
    public static String[] loadConfig(File filesDir) {
        File[] candidates = new File[] {
            new File(filesDir, "openclaw.json"),
            new File("/data/local/tmp/clawos/openclaw.json"),
            new File("/product/etc/clawos/openclaw-default.json"),
        };

        for (File configFile : candidates) {
            if (!configFile.exists() || !configFile.canRead()) continue;
            try {
                java.io.FileInputStream fis = new java.io.FileInputStream(configFile);
                byte[] bytes = new byte[(int) configFile.length()];
                fis.read(bytes);
                fis.close();
                JSONObject config = new JSONObject(new String(bytes));
                JSONObject gateway = config.optJSONObject("gateway");
                if (gateway != null) {
                    JSONObject auth = gateway.optJSONObject("auth");
                    String token = auth != null ? auth.optString("token", null) : null;
                    int port = gateway.optInt("port", 18789);
                    if (token != null) {
                        Log.i(TAG, "Config loaded from: " + configFile.getAbsolutePath());
                        return new String[]{"ws://localhost:" + port, token};
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Failed to load config from " + configFile + ": " + e.getMessage());
            }
        }
        Log.w(TAG, "No valid gateway config found in any location");
        return null;
    }
}
