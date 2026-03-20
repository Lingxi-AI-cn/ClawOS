package com.clawos.gateway;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * OpenClaw Gateway Protocol v3 – Java data types.
 *
 * Mirrors the TypeScript definitions in ui/src/gateway/protocol.ts.
 * Frames are JSON objects with a "type" field: "req", "res", or "event".
 */
public final class GatewayProtocol {

    private GatewayProtocol() {}

    // ── Frame constructors ──────────────────────────────────────

    /** Build a request frame. */
    public static JSONObject request(String id, String method, JSONObject params) throws JSONException {
        JSONObject frame = new JSONObject();
        frame.put("type", "req");
        frame.put("id", id);
        frame.put("method", method);
        if (params != null) {
            frame.put("params", params);
        }
        return frame;
    }

    /** Build connect handshake params. */
    public static JSONObject connectParams(String token) throws JSONException {
        JSONObject params = new JSONObject();
        params.put("minProtocol", 3);
        params.put("maxProtocol", 3);

        JSONObject client = new JSONObject();
        // Gateway validates client.id against a fixed schema –
        // must use "webchat-ui" to match the expected constant.
        client.put("id", "webchat-ui");
        client.put("version", "0.1.0");
        client.put("platform", "android-overlay");
        client.put("mode", "webchat");
        params.put("client", client);

        params.put("caps", new JSONArray());

        JSONObject auth = new JSONObject();
        auth.put("token", token);
        params.put("auth", auth);

        JSONArray scopes = new JSONArray();
        scopes.put("operator.admin");
        params.put("scopes", scopes);

        params.put("locale", "zh-CN");
        params.put("userAgent", "ClawOS-FloatingAssistant/0.1.0");

        return params;
    }

    /** Build chat.send params. */
    public static JSONObject chatSendParams(String message, String sessionKey, String idempotencyKey) throws JSONException {
        JSONObject params = new JSONObject();
        params.put("sessionKey", sessionKey);
        params.put("message", message);
        params.put("idempotencyKey", idempotencyKey);
        params.put("timeoutMs", 120000);
        return params;
    }

    /** Build chat.abort params. */
    public static JSONObject chatAbortParams(String sessionKey, String runId) throws JSONException {
        JSONObject params = new JSONObject();
        params.put("sessionKey", sessionKey);
        if (runId != null) {
            params.put("runId", runId);
        }
        return params;
    }

    // ── Response parsing helpers ─────────────────────────────────

    /** Check if a frame is an "ok" response. */
    public static boolean isOkResponse(JSONObject frame) {
        return "res".equals(frame.optString("type")) && frame.optBoolean("ok", false);
    }

    /** Check if a frame is an error response. */
    public static boolean isErrorResponse(JSONObject frame) {
        return "res".equals(frame.optString("type")) && !frame.optBoolean("ok", true);
    }

    /** Extract error message from an error response. */
    public static String getErrorMessage(JSONObject frame) {
        JSONObject err = frame.optJSONObject("error");
        if (err != null) {
            return err.optString("message", "Unknown error");
        }
        return "Unknown error";
    }

    /** Check if a frame is an event. */
    public static boolean isEvent(JSONObject frame) {
        return "event".equals(frame.optString("type"));
    }

    /** Get event name from an event frame. */
    public static String getEventName(JSONObject frame) {
        return frame.optString("event", "");
    }

    /** Get payload from an event frame. */
    public static JSONObject getEventPayload(JSONObject frame) {
        return frame.optJSONObject("payload");
    }

    // ── Chat event payload parsing ──────────────────────────────

    /** Extract text content from a chat message payload. */
    public static String extractTextContent(JSONObject payload) {
        if (payload == null) return "";
        JSONObject message = payload.optJSONObject("message");
        if (message == null) return "";
        JSONArray content = message.optJSONArray("content");
        if (content == null) return "";

        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < content.length(); i++) {
            JSONObject part = content.optJSONObject(i);
            if (part != null && "text".equals(part.optString("type"))) {
                sb.append(part.optString("text", ""));
            }
        }
        return sb.toString();
    }

    /** Get the "state" field from a chat event payload. */
    public static String getChatState(JSONObject payload) {
        return payload != null ? payload.optString("state", "") : "";
    }

    /** Get the "runId" field from a chat/agent event payload. */
    public static String getRunId(JSONObject payload) {
        return payload != null ? payload.optString("runId", "") : "";
    }

    // ── Agent event payload parsing ─────────────────────────────

    /** Get agent event stream type ("tool" or "lifecycle"). */
    public static String getAgentStream(JSONObject payload) {
        return payload != null ? payload.optString("stream", "") : "";
    }

    /** Get agent event data object. */
    public static JSONObject getAgentData(JSONObject payload) {
        return payload != null ? payload.optJSONObject("data") : null;
    }
}
