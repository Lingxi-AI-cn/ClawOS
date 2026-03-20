package com.clawos.audio;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Log;

import com.k2fsa.sherpa.onnx.*;

import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Standalone STT engine based on Sherpa-ONNX.
 * Extracted from ClawOSVoice for reuse by both the Capacitor plugin
 * and the floating AI assistant.
 *
 * Usage:
 *   SherpaSTTEngine engine = new SherpaSTTEngine(listener);
 *   if (engine.init()) {
 *       engine.startListening();
 *       // ... partial/final results via listener
 *       engine.stopListening();
 *   }
 *   engine.release();
 */
public class SherpaSTTEngine {

    private static final String TAG = "SherpaSTT";
    private static final int SAMPLE_RATE = 16000;

    // Model base paths
    private static final String MODEL_BASE_ROM = "/product/etc/clawos/models";
    private static final String MODEL_BASE_DEV = "/data/local/tmp/clawos/models";

    public interface STTListener {
        /** Called on background thread with partial recognition text. */
        void onPartialResult(String text);
        /** Called on background thread with final recognition text (endpoint detected or stopped). */
        void onFinalResult(String text);
        /** Called on background thread when an error occurs. */
        void onError(String error);
    }

    private final STTListener listener;
    private OnlineRecognizer recognizer;
    private Vad vad;
    private AudioRecord audioRecord;
    private final AtomicBoolean isRecording = new AtomicBoolean(false);
    private volatile boolean freshRecognizer = false;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private String modelBase;

    public SherpaSTTEngine(STTListener listener) {
        this.listener = listener;
    }

    /**
     * Resolve model base path, preferring ROM path.
     */
    public static String resolveModelBase() {
        File romPath = new File(MODEL_BASE_ROM);
        if (romPath.exists() && romPath.isDirectory()) {
            return MODEL_BASE_ROM;
        }
        File devPath = new File(MODEL_BASE_DEV);
        if (devPath.exists() && devPath.isDirectory()) {
            return MODEL_BASE_DEV;
        }
        return null;
    }

    /**
     * Check if STT models are available.
     */
    public static boolean isAvailable() {
        String base = resolveModelBase();
        if (base == null) return false;
        return new File(base + "/stt/encoder-epoch-99-avg-1.int8.onnx").exists();
    }

    /**
     * Initialize the STT recognizer, VAD, and persistent AudioRecord.
     * The AudioRecord is created once and kept alive across sessions because
     * the Android emulator's virtual mic goes silent after release().
     *
     * @return true if initialization succeeded
     */
    public boolean init() {
        if (recognizer != null) return true;

        modelBase = resolveModelBase();
        if (modelBase == null) {
            Log.e(TAG, "No model directory found");
            return false;
        }

        try {
            initRecognizer();
            if (recognizer == null) return false;
            freshRecognizer = true;

            // Init VAD
            String vadModel = modelBase + "/vad/silero_vad.onnx";
            if (new File(vadModel).exists()) {
                SileroVadModelConfig sileroConfig = new SileroVadModelConfig(
                    vadModel, 0.5f, 0.5f, 0.25f, 512, 5.0f
                );
                VadModelConfig vadConfig = new VadModelConfig();
                vadConfig.setSileroVadModelConfig(sileroConfig);
                vadConfig.setSampleRate(SAMPLE_RATE);
                vadConfig.setNumThreads(1);
                vadConfig.setProvider("cpu");

                vad = new Vad(null, vadConfig);
                Log.i(TAG, "VAD initialized");
            }

            // Create persistent AudioRecord (kept alive to avoid emulator mic silence bug)
            int bufferSize = AudioRecord.getMinBufferSize(
                SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
            );
            if (bufferSize <= 0) bufferSize = SAMPLE_RATE * 2;
            audioRecord = createAudioRecord(bufferSize);
            if (audioRecord == null) {
                Log.w(TAG, "Could not create persistent AudioRecord (will try per-session)");
            } else {
                Log.i(TAG, "Persistent AudioRecord created");
            }

            return true;
        } catch (Exception e) {
            Log.e(TAG, "Failed to init STT", e);
            return false;
        }
    }

    private void initRecognizer() {
        try {
            String sttDir = modelBase + "/stt";
            String encoderPath = sttDir + "/encoder-epoch-99-avg-1.int8.onnx";
            String decoderPath = sttDir + "/decoder-epoch-99-avg-1.onnx";
            String joinerPath = sttDir + "/joiner-epoch-99-avg-1.int8.onnx";
            String tokensPath = sttDir + "/tokens.txt";

            if (!new File(decoderPath).exists()) {
                decoderPath = sttDir + "/decoder-epoch-99-avg-1.int8.onnx";
            }

            if (!new File(encoderPath).exists()) {
                Log.e(TAG, "STT encoder not found at " + encoderPath);
                return;
            }

            OnlineTransducerModelConfig transducer = new OnlineTransducerModelConfig(
                encoderPath, decoderPath, joinerPath
            );

            OnlineModelConfig modelConfig = new OnlineModelConfig();
            modelConfig.setTransducer(transducer);
            modelConfig.setTokens(tokensPath);
            modelConfig.setNumThreads(2);
            modelConfig.setDebug(false);
            modelConfig.setProvider("cpu");
            modelConfig.setModelType("zipformer");

            // BPE model for bilingual zh-en tokenization
            String bpePath = sttDir + "/bpe.model";
            if (new File(bpePath).exists()) {
                modelConfig.setModelingUnit("bpe");
                modelConfig.setBpeVocab(bpePath);
                Log.i(TAG, "BPE model loaded for bilingual STT");
            }

            OnlineRecognizerConfig config = new OnlineRecognizerConfig();
            config.setFeatConfig(new FeatureConfig(SAMPLE_RATE, 80, 0.0f));
            config.setModelConfig(modelConfig);
            config.setEndpointConfig(new EndpointConfig(
                new EndpointRule(false, 2.4f, 0.0f),
                new EndpointRule(true, 1.4f, 0.0f),
                new EndpointRule(false, 0.0f, 20.0f)
            ));
            config.setEnableEndpoint(true);
            config.setDecodingMethod("greedy_search");

            recognizer = new OnlineRecognizer(null, config);
            Log.i(TAG, "STT recognizer initialized (bilingual zh-en)");
        } catch (Exception e) {
            Log.e(TAG, "Failed to init recognizer", e);
        }
    }

    public boolean isListening() {
        return isRecording.get();
    }

    /**
     * Release and re-create the OnlineRecognizer to ensure clean state.
     * Sherpa-ONNX's recognizer can accumulate internal state (especially after
     * stream.inputFinished()) that prevents subsequent streams from working.
     */
    private void reinitRecognizer() {
        if (recognizer != null) {
            try { recognizer.release(); } catch (Exception ignored) {}
            recognizer = null;
        }
        // Re-use the same init logic (takes ~0.5s, acceptable for per-session cost)
        initRecognizer();
        if (recognizer != null) {
            Log.i(TAG, "STT recognizer re-initialized for new session");
        }
    }

    /**
     * Start recording audio and running the recognition loop.
     * Results are delivered via the STTListener callback.
     *
     * Uses the persistent AudioRecord created in init(). Only starts/stops
     * recording – never releases the AudioRecord between sessions (emulator
     * virtual mic goes silent after release).
     */
    public void startListening() {
        if (isRecording.get()) {
            Log.w(TAG, "Already recording, ignoring startListening");
            return;
        }

        if (recognizer == null) {
            if (listener != null) listener.onError("STT not initialized");
            return;
        }

        // Use persistent AudioRecord, or create one if not available
        if (audioRecord == null || audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
            int bufferSize = AudioRecord.getMinBufferSize(
                SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
            );
            if (bufferSize <= 0) bufferSize = SAMPLE_RATE * 2;
            audioRecord = createAudioRecord(bufferSize);
        }

        if (audioRecord == null) {
            if (listener != null) listener.onError("Failed to create AudioRecord");
            return;
        }

        isRecording.set(true);

        // Stop if currently recording (shouldn't happen, but be safe)
        if (audioRecord.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
            audioRecord.stop();
        }
        audioRecord.startRecording();
        Log.i(TAG, "Recording started, state=" + audioRecord.getRecordingState());

        final OnlineStream stream = recognizer.createStream("");
        final AudioRecord localRecord = audioRecord;
        executor.execute(() -> recognitionLoop(stream, localRecord));
    }

    /**
     * Stop recording and flush any remaining recognition results.
     */
    public void stopListening() {
        isRecording.set(false);
    }

    /**
     * Release all native resources. After this, the engine cannot be reused.
     */
    public void release() {
        isRecording.set(false);
        try { if (audioRecord != null) { audioRecord.stop(); audioRecord.release(); } } catch (Exception ignored) {}
        audioRecord = null;
        if (recognizer != null) { recognizer.release(); recognizer = null; }
        if (vad != null) { vad.release(); vad = null; }
        executor.shutdownNow();
    }

    // ── Internal ─────────────────────────────────────────────────

    private void recognitionLoop(OnlineStream stream, AudioRecord record) {
        short[] buffer = new short[SAMPLE_RATE / 10]; // 100ms chunks
        String lastText = "";
        int loopCount = 0;

        Log.i(TAG, "Recognition loop started, state=" + record.getState()
                + " recording=" + record.getRecordingState());

        while (isRecording.get()) {
            int read = record.read(buffer, 0, buffer.length);
            loopCount++;

            // Log audio energy to detect silence
            if (loopCount <= 5 || loopCount % 50 == 0) {
                long energy = 0;
                for (int i = 0; i < Math.min(read, buffer.length); i++) {
                    energy += Math.abs(buffer[i]);
                }
                Log.d(TAG, "Loop #" + loopCount + " read=" + read
                        + " energy=" + (read > 0 ? energy / read : 0));
            }
            if (read <= 0) continue;

            float[] samples = new float[read];
            for (int i = 0; i < read; i++) {
                samples[i] = buffer[i] / 32768.0f;
            }

            stream.acceptWaveform(samples, SAMPLE_RATE);

            while (recognizer.isReady(stream)) {
                recognizer.decode(stream);
            }

            OnlineRecognizerResult result = recognizer.getResult(stream);
            String text = normalizeText(result.getText().trim());

            if (!text.isEmpty() && !text.equals(lastText)) {
                lastText = text;
                if (listener != null) listener.onPartialResult(text);
            }

            if (recognizer.isEndpoint(stream)) {
                if (!lastText.isEmpty()) {
                    if (listener != null) listener.onFinalResult(lastText);
                }
                recognizer.reset(stream);
                lastText = "";
            }
        }

        // Emit any remaining text as final result.
        if (!lastText.isEmpty()) {
            if (listener != null) listener.onFinalResult(lastText);
        }

        try { record.stop(); } catch (Exception ignored) {}

        if (vad != null) vad.reset();
        Log.i(TAG, "Recognition loop ended after " + loopCount + " iterations");

        reinitRecognizer();
    }

    /**
     * Normalize text output from the bilingual model.
     * The model outputs English in UPPERCASE; convert to natural casing.
     * Chinese characters are unaffected.
     */
    private static String normalizeText(String text) {
        if (text == null || text.isEmpty()) return text;

        // Check if text contains any uppercase Latin letter
        boolean hasUpper = false;
        boolean hasLower = false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c >= 'A' && c <= 'Z') hasUpper = true;
            if (c >= 'a' && c <= 'z') hasLower = true;
        }

        // If there are uppercase letters but no lowercase, the model likely output
        // all-caps English — convert to lowercase with sentence-initial capitalization
        if (hasUpper && !hasLower) {
            StringBuilder sb = new StringBuilder(text.length());
            boolean capitalizeNext = true;
            for (int i = 0; i < text.length(); i++) {
                char c = text.charAt(i);
                if (c >= 'A' && c <= 'Z') {
                    if (capitalizeNext) {
                        sb.append(c);
                        capitalizeNext = false;
                    } else {
                        sb.append((char) (c + 32)); // to lowercase
                    }
                } else {
                    sb.append(c);
                    if (c == '.' || c == '!' || c == '?') {
                        capitalizeNext = true;
                    } else if (c != ' ') {
                        capitalizeNext = false;
                    }
                }
            }
            return sb.toString();
        }

        return text;
    }

    private AudioRecord createAudioRecord(int bufferSize) {
        int[] sources = {
            MediaRecorder.AudioSource.VOICE_RECOGNITION,
            MediaRecorder.AudioSource.MIC,
            MediaRecorder.AudioSource.DEFAULT,
            MediaRecorder.AudioSource.UNPROCESSED,
        };

        for (int source : sources) {
            try {
                AudioRecord record = new AudioRecord(
                    source, SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufferSize
                );
                if (record.getState() == AudioRecord.STATE_INITIALIZED) {
                    Log.i(TAG, "AudioRecord created with source=" + source);
                    return record;
                }
                record.release();
            } catch (Exception e) {
                Log.d(TAG, "AudioSource " + source + " failed: " + e.getMessage());
            }
        }
        return null;
    }
}
