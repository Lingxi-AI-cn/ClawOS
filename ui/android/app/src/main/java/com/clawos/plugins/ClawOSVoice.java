package com.clawos.plugins;

import android.Manifest;
import android.util.Log;

import com.clawos.audio.SherpaSTTEngine;
import com.clawos.audio.SherpaTTSEngine;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Capacitor plugin for voice input/output (STT + TTS).
 * Delegates to SherpaSTTEngine and SherpaTTSEngine for actual processing.
 */
@CapacitorPlugin(
    name = "ClawOSVoice",
    permissions = {
        @Permission(
            alias = "microphone",
            strings = { Manifest.permission.RECORD_AUDIO }
        )
    }
)
public class ClawOSVoice extends Plugin {

    private static final String TAG = "ClawOSVoice";

    private SherpaSTTEngine sttEngine;
    private SherpaTTSEngine ttsEngine;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        String base = SherpaSTTEngine.resolveModelBase();

        JSObject ret = new JSObject();
        ret.put("stt", SherpaSTTEngine.isAvailable());
        ret.put("tts", SherpaTTSEngine.isAvailable());
        ret.put("ttsEn", SherpaTTSEngine.isEnglishAvailable());
        ret.put("vad", base != null && new java.io.File(base + "/vad/silero_vad.onnx").exists());
        ret.put("modelPath", base != null ? base : "");
        call.resolve(ret);
    }

    @PluginMethod
    public void warmup(PluginCall call) {
        Thread t = new Thread(() -> {
            if (sttEngine == null) {
                sttEngine = new SherpaSTTEngine(new SherpaSTTEngine.STTListener() {
                    @Override public void onPartialResult(String text) {
                        JSObject event = new JSObject();
                        event.put("text", text);
                        event.put("isFinal", false);
                        notifyListeners("partialResult", event);
                    }
                    @Override public void onFinalResult(String text) {
                        JSObject event = new JSObject();
                        event.put("text", text);
                        event.put("isFinal", true);
                        notifyListeners("finalResult", event);
                    }
                    @Override public void onError(String error) {
                        Log.e(TAG, "STT error: " + error);
                    }
                });
            }
            boolean ok = sttEngine.init();
            Log.i(TAG, "STT warmup " + (ok ? "OK" : "FAILED"));
        }, "stt-warmup");
        t.setPriority(Thread.MIN_PRIORITY);
        t.start();

        JSObject ret = new JSObject();
        ret.put("status", "warming_up");
        call.resolve(ret);
    }

    @PluginMethod
    public void startListening(PluginCall call) {
        if (sttEngine != null && sttEngine.isListening()) {
            call.reject("Already recording");
            return;
        }

        if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
            return;
        }

        doStartListening(call);
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            doStartListening(call);
        } else {
            call.reject("Microphone permission denied");
        }
    }

    private void doStartListening(PluginCall call) {
        if (sttEngine == null) {
            sttEngine = new SherpaSTTEngine(new SherpaSTTEngine.STTListener() {
                @Override
                public void onPartialResult(String text) {
                    JSObject event = new JSObject();
                    event.put("text", text);
                    event.put("isFinal", false);
                    notifyListeners("partialResult", event);
                }

                @Override
                public void onFinalResult(String text) {
                    JSObject event = new JSObject();
                    event.put("text", text);
                    event.put("isFinal", true);
                    notifyListeners("finalResult", event);
                }

                @Override
                public void onError(String error) {
                    Log.e(TAG, "STT error: " + error);
                }
            });
        }

        if (!sttEngine.init()) {
            call.reject("STT model not available");
            return;
        }

        sttEngine.startListening();

        JSObject ret = new JSObject();
        ret.put("status", "listening");
        call.resolve(ret);
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        if (sttEngine == null || !sttEngine.isListening()) {
            call.reject("Not recording");
            return;
        }

        sttEngine.stopListening();

        JSObject ret = new JSObject();
        ret.put("status", "stopped");
        call.resolve(ret);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.isEmpty()) {
            call.reject("Text is required");
            return;
        }

        if (ttsEngine == null) {
            ttsEngine = new SherpaTTSEngine(new SherpaTTSEngine.TTSListener() {
                @Override
                public void onSpeakStart() {}

                @Override
                public void onSpeakEnd() {
                    JSObject event = new JSObject();
                    event.put("status", "ended");
                    notifyListeners("speakEnd", event);
                }

                @Override
                public void onSpeakError(String error) {
                    JSObject event = new JSObject();
                    event.put("status", "error");
                    event.put("error", error);
                    notifyListeners("speakEnd", event);
                }
            });
        }

        if (!ttsEngine.init()) {
            call.reject("TTS model not available");
            return;
        }

        int sid = call.getInt("sid", 0);
        float speed = call.getFloat("speed", 1.0f);

        ttsEngine.speak(text, sid, speed);

        JSObject ret = new JSObject();
        ret.put("status", "speaking");
        call.resolve(ret);
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        if (ttsEngine != null) {
            ttsEngine.stopSpeaking();
        }
        JSObject ret = new JSObject();
        ret.put("status", "stopped");
        call.resolve(ret);
    }

    @Override
    protected void handleOnDestroy() {
        if (sttEngine != null) { sttEngine.release(); sttEngine = null; }
        if (ttsEngine != null) { ttsEngine.release(); ttsEngine = null; }
        super.handleOnDestroy();
    }
}
