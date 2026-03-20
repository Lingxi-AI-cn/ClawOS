package com.clawos.audio;

import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.util.Log;

import com.k2fsa.sherpa.onnx.*;

import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Bilingual TTS engine based on Sherpa-ONNX.
 * Supports both Chinese (Matcha zh-baker) and English (Matcha en-ljspeech).
 *
 * Automatically detects the dominant language of the text and routes to
 * the appropriate TTS model. Mixed-language text is split into segments.
 *
 * Usage:
 *   SherpaTTSEngine engine = new SherpaTTSEngine(listener);
 *   if (engine.init()) {
 *       engine.speak("你好世界");      // → Chinese TTS
 *       engine.speak("Hello world");   // → English TTS
 *       engine.speak("这是一个test");   // → split & speak both
 *   }
 *   engine.release();
 */
public class SherpaTTSEngine {

    private static final String TAG = "SherpaTTS";

    public interface TTSListener {
        void onSpeakStart();
        void onSpeakEnd();
        void onSpeakError(String error);
    }

    private final TTSListener listener;
    private OfflineTts ttsZh;
    private OfflineTts ttsEn;
    private AudioTrack audioTrack;
    private final AtomicBoolean isSpeaking = new AtomicBoolean(false);
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    public SherpaTTSEngine(TTSListener listener) {
        this.listener = listener;
    }

    /**
     * Check if at least Chinese TTS models are available.
     */
    public static boolean isAvailable() {
        String base = SherpaSTTEngine.resolveModelBase();
        if (base == null) return false;
        return new File(base + "/tts/model-steps-3.onnx").exists();
    }

    /**
     * Check if English TTS models are available.
     */
    public static boolean isEnglishAvailable() {
        String base = SherpaSTTEngine.resolveModelBase();
        if (base == null) return false;
        return new File(base + "/tts-en/model-steps-3.onnx").exists();
    }

    /**
     * Initialize the TTS engines. Must be called before speak().
     * Initializes Chinese TTS (required) and English TTS (optional).
     * @return true if at least Chinese TTS initialization succeeded
     */
    public boolean init() {
        if (ttsZh != null) return true;

        String base = SherpaSTTEngine.resolveModelBase();
        if (base == null) {
            Log.e(TAG, "No model directory found");
            return false;
        }

        boolean zhOk = initChineseTts(base);
        boolean enOk = initEnglishTts(base);

        Log.i(TAG, "TTS init: zh=" + zhOk + " en=" + enOk);
        return zhOk;
    }

    private boolean initChineseTts(String base) {
        try {
            String ttsDir = base + "/tts";
            if (!new File(ttsDir + "/model-steps-3.onnx").exists()) {
                Log.e(TAG, "Chinese TTS model not found at " + ttsDir);
                return false;
            }

            String ruleFsts = "";
            String dateFst = ttsDir + "/date.fst";
            String numberFst = ttsDir + "/number.fst";
            String phoneFst = ttsDir + "/phone.fst";
            if (new File(dateFst).exists() && new File(numberFst).exists() && new File(phoneFst).exists()) {
                ruleFsts = dateFst + "," + numberFst + "," + phoneFst;
            }

            OfflineTtsMatchaModelConfig matcha = new OfflineTtsMatchaModelConfig(
                ttsDir + "/model-steps-3.onnx",
                ttsDir + "/hifigan_v2.onnx",
                ttsDir + "/lexicon.txt",
                ttsDir + "/tokens.txt",
                "",
                ttsDir + "/dict",
                1.0f,
                1.0f
            );

            OfflineTtsModelConfig modelConfig = new OfflineTtsModelConfig();
            modelConfig.setMatcha(matcha);
            modelConfig.setNumThreads(2);
            modelConfig.setDebug(false);
            modelConfig.setProvider("cpu");

            OfflineTtsConfig config = new OfflineTtsConfig();
            config.setModel(modelConfig);
            config.setRuleFsts(ruleFsts);
            config.setMaxNumSentences(1);
            config.setSilenceScale(0.2f);

            ttsZh = new OfflineTts(null, config);
            Log.i(TAG, "Chinese TTS initialized, sampleRate=" + ttsZh.sampleRate());
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Failed to init Chinese TTS", e);
            return false;
        }
    }

    private boolean initEnglishTts(String base) {
        try {
            String ttsEnDir = base + "/tts-en";
            if (!new File(ttsEnDir + "/model-steps-3.onnx").exists()) {
                Log.w(TAG, "English TTS model not found at " + ttsEnDir + ", English TTS disabled");
                return false;
            }

            // English Matcha uses espeak-ng-data for phoneme conversion
            // and shares hifigan_v2 vocoder with Chinese TTS
            String vocoderPath = ttsEnDir + "/hifigan_v2.onnx";
            if (!new File(vocoderPath).exists()) {
                // Fall back to shared vocoder from Chinese TTS dir
                vocoderPath = base + "/tts/hifigan_v2.onnx";
            }

            OfflineTtsMatchaModelConfig matcha = new OfflineTtsMatchaModelConfig(
                ttsEnDir + "/model-steps-3.onnx",
                vocoderPath,
                "",
                ttsEnDir + "/tokens.txt",
                ttsEnDir + "/espeak-ng-data",
                "",
                1.0f,
                1.0f
            );

            OfflineTtsModelConfig modelConfig = new OfflineTtsModelConfig();
            modelConfig.setMatcha(matcha);
            modelConfig.setNumThreads(2);
            modelConfig.setDebug(false);
            modelConfig.setProvider("cpu");

            OfflineTtsConfig config = new OfflineTtsConfig();
            config.setModel(modelConfig);
            config.setMaxNumSentences(1);
            config.setSilenceScale(0.2f);

            ttsEn = new OfflineTts(null, config);
            Log.i(TAG, "English TTS initialized, sampleRate=" + ttsEn.sampleRate());
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Failed to init English TTS", e);
            return false;
        }
    }

    public boolean isSpeaking() {
        return isSpeaking.get();
    }

    /**
     * Speak the given text asynchronously with automatic language detection.
     */
    public void speak(String text) {
        speak(text, 0, 1.0f);
    }

    /**
     * Speak the given text with specified speaker ID and speed.
     * Automatically detects language and uses the appropriate TTS engine.
     * For mixed Chinese/English text, splits into segments and speaks sequentially.
     */
    public void speak(String text, int speakerId, float speed) {
        if (text == null || text.isEmpty()) return;
        if (ttsZh == null && ttsEn == null) {
            if (listener != null) listener.onSpeakError("TTS not initialized");
            return;
        }

        if (isSpeaking.get()) {
            stopSpeaking();
        }

        isSpeaking.set(true);
        if (listener != null) listener.onSpeakStart();

        executor.execute(() -> {
            try {
                speakInternal(text, speakerId, speed);
                if (isSpeaking.get()) {
                    isSpeaking.set(false);
                    if (listener != null) listener.onSpeakEnd();
                }
            } catch (Exception e) {
                Log.e(TAG, "TTS playback error", e);
                isSpeaking.set(false);
                if (listener != null) listener.onSpeakError(e.getMessage());
            } finally {
                cleanupAudioTrack();
            }
        });
    }

    private void speakInternal(String text, int speakerId, float speed) throws Exception {
        // Split text into language segments for mixed content
        String[][] segments = splitByLanguage(text);

        for (String[] seg : segments) {
            if (!isSpeaking.get()) break;

            String lang = seg[0];
            String content = seg[1].trim();
            if (content.isEmpty()) continue;

            OfflineTts engine;
            if ("en".equals(lang) && ttsEn != null) {
                engine = ttsEn;
            } else if (ttsZh != null) {
                engine = ttsZh;
            } else if (ttsEn != null) {
                engine = ttsEn;
            } else {
                continue;
            }

            Log.d(TAG, "Speaking [" + lang + "]: " + content.substring(0, Math.min(50, content.length())));
            GeneratedAudio audio = engine.generate(content, speakerId, speed);
            if (!isSpeaking.get()) return;

            playAudio(audio);
        }
    }

    private void playAudio(GeneratedAudio audio) throws Exception {
        int sampleRate = audio.getSampleRate();
        float[] samples = audio.getSamples();
        if (samples.length == 0) return;

        short[] pcm = new short[samples.length];
        for (int i = 0; i < samples.length; i++) {
            float v = Math.max(-1.0f, Math.min(1.0f, samples[i]));
            pcm[i] = (short) (v * 32767);
        }

        int bufSize = AudioTrack.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        );

        cleanupAudioTrack();

        audioTrack = new AudioTrack(
            AudioManager.STREAM_MUSIC,
            sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            Math.max(bufSize, pcm.length * 2),
            AudioTrack.MODE_STATIC
        );

        audioTrack.write(pcm, 0, pcm.length);
        audioTrack.play();

        int durationMs = (int) ((float) pcm.length / sampleRate * 1000);
        Thread.sleep(durationMs + 100);
    }

    /**
     * Split text into segments by language (Chinese vs English).
     * Returns array of [lang, text] pairs where lang is "zh" or "en".
     *
     * Strategy:
     * - CJK characters (U+4E00..U+9FFF, U+3400..U+4DBF, etc.) → "zh"
     * - Latin letters, digits, punctuation → "en"
     * - Adjacent same-language chars are grouped
     * - Short segments (< 2 chars) are merged with neighbors
     */
    static String[][] splitByLanguage(String text) {
        if (text == null || text.isEmpty()) return new String[0][];

        // Detect dominant language first for simple cases
        int zhCount = 0, enCount = 0;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (isCJK(c)) zhCount++;
            else if (isLatin(c)) enCount++;
        }

        // If text is predominantly one language (>90%), treat as single segment
        int total = zhCount + enCount;
        if (total > 0) {
            if (zhCount > total * 0.9) return new String[][] {{"zh", text}};
            if (enCount > total * 0.9) return new String[][] {{"en", text}};
        }

        // Split into segments for mixed text
        java.util.List<String[]> segments = new java.util.ArrayList<>();
        StringBuilder current = new StringBuilder();
        String currentLang = null;

        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            String charLang;

            if (isCJK(c)) {
                charLang = "zh";
            } else if (isLatin(c)) {
                charLang = "en";
            } else {
                // Whitespace, punctuation, numbers: inherit current language
                current.append(c);
                continue;
            }

            if (currentLang == null) {
                currentLang = charLang;
            }

            if (!charLang.equals(currentLang)) {
                if (current.length() > 0) {
                    segments.add(new String[]{currentLang, current.toString()});
                    current = new StringBuilder();
                }
                currentLang = charLang;
            }

            current.append(c);
        }

        if (current.length() > 0 && currentLang != null) {
            segments.add(new String[]{currentLang, current.toString()});
        }

        // Merge very short segments with neighbors
        if (segments.size() > 1) {
            java.util.List<String[]> merged = new java.util.ArrayList<>();
            for (String[] seg : segments) {
                if (merged.isEmpty()) {
                    merged.add(seg);
                } else {
                    String[] prev = merged.get(merged.size() - 1);
                    // Merge if segment text is too short (< 3 meaningful chars)
                    int meaningfulChars = countMeaningful(seg[1]);
                    if (meaningfulChars < 3 && prev[0].equals(seg[0])) {
                        prev[1] = prev[1] + seg[1];
                    } else if (meaningfulChars < 2) {
                        prev[1] = prev[1] + seg[1];
                    } else {
                        merged.add(seg);
                    }
                }
            }
            return merged.toArray(new String[0][]);
        }

        return segments.toArray(new String[0][]);
    }

    private static boolean isCJK(char c) {
        return (c >= '\u4E00' && c <= '\u9FFF')     // CJK Unified Ideographs
            || (c >= '\u3400' && c <= '\u4DBF')      // CJK Unified Ideographs Extension A
            || (c >= '\u3000' && c <= '\u303F')      // CJK Symbols and Punctuation
            || (c >= '\uFF00' && c <= '\uFFEF')      // Fullwidth Forms
            || (c >= '\u2E80' && c <= '\u2EFF')      // CJK Radicals Supplement
            || (c >= '\u31C0' && c <= '\u31EF');     // CJK Strokes
    }

    private static boolean isLatin(char c) {
        return (c >= 'A' && c <= 'Z')
            || (c >= 'a' && c <= 'z');
    }

    private static int countMeaningful(String s) {
        int count = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (isCJK(c) || isLatin(c)) count++;
        }
        return count;
    }

    /**
     * Stop any ongoing TTS playback.
     */
    public void stopSpeaking() {
        isSpeaking.set(false);
        cleanupAudioTrack();
    }

    /**
     * Release all native resources.
     */
    public void release() {
        isSpeaking.set(false);
        cleanupAudioTrack();
        if (ttsZh != null) { ttsZh.release(); ttsZh = null; }
        if (ttsEn != null) { ttsEn.release(); ttsEn = null; }
        executor.shutdownNow();
    }

    private void cleanupAudioTrack() {
        try {
            if (audioTrack != null) {
                audioTrack.stop();
                audioTrack.release();
                audioTrack = null;
            }
        } catch (Exception ignored) {}
    }
}
