package com.voiceclock.vc;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Log;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public class AppTtsManager implements TextToSpeech.OnInitListener {
    private static final String TAG = "AppTtsManager";
    private static volatile AppTtsManager sInstance;

    private final Context appContext;
    private TextToSpeech textToSpeech;
    private volatile boolean isInitialized = false;
    private volatile boolean isInitializing = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private OnInitCallback pendingInitCallback;

    // Cache voices to avoid repeated slow IPC Binder calls
    private Set<Voice> cachedVoices = null;
    private final Map<String, Voice> resolvedVoiceCache = new HashMap<>();
    private String lastConfiguredVoiceKey = null;

    public interface OnInitCallback {
        void onReady();
        void onError();
    }

    private AppTtsManager(Context context) {
        this.appContext = context.getApplicationContext();
        init();
    }

    public static AppTtsManager getInstance(Context context) {
        if (sInstance == null) {
            synchronized (AppTtsManager.class) {
                if (sInstance == null) {
                    sInstance = new AppTtsManager(context);
                }
            }
        }
        return sInstance;
    }

    public synchronized void init() {
        if (isInitialized || isInitializing) return;
        isInitializing = true;
        try {
            textToSpeech = new TextToSpeech(appContext, this);
        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize TextToSpeech", e);
            isInitializing = false;
        }
    }

    @Override
    public void onInit(int status) {
        synchronized (this) {
            isInitializing = false;
            if (status == TextToSpeech.SUCCESS && textToSpeech != null) {
                isInitialized = true;
                Log.d(TAG, "TextToSpeech successfully pre-warmed and ready!");
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        AudioAttributes audioAttributes = new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_ALARM)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                .build();
                        textToSpeech.setAudioAttributes(audioAttributes);
                    }
                } catch (Exception ignored) {}

                // Pre-cache voices asynchronously so getVoices() never blocks alarm audio playback
                new Thread(() -> {
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP && textToSpeech != null) {
                            cachedVoices = textToSpeech.getVoices();
                        }
                    } catch (Exception ignored) {}
                }).start();

                if (pendingInitCallback != null) {
                    OnInitCallback cb = pendingInitCallback;
                    pendingInitCallback = null;
                    mainHandler.post(cb::onReady);
                }
            } else {
                isInitialized = false;
                Log.e(TAG, "TextToSpeech initialization failed with status: " + status);
                if (pendingInitCallback != null) {
                    OnInitCallback cb = pendingInitCallback;
                    pendingInitCallback = null;
                    mainHandler.post(cb::onError);
                }
            }
        }
    }

    public boolean isReady() {
        return isInitialized && textToSpeech != null;
    }

    public synchronized void waitForReady(OnInitCallback callback) {
        if (isReady()) {
            if (callback != null) callback.onReady();
            return;
        }
        this.pendingInitCallback = callback;
        init();
    }

    public void configureVoice(String voiceId, String text) {
        if (!isReady()) return;

        boolean isHindi = isTextHindi(text) || "hi".equalsIgnoreCase(AlarmPreferences.getAppLanguage(appContext));
        Locale targetLocale = isHindi ? new Locale("hi", "IN") : Locale.US;

        String configKey = voiceId + "_" + (isHindi ? "hi" : "en");
        if (configKey.equals(lastConfiguredVoiceKey)) {
            return; // Already configured, avoid redundant Binder calls
        }
        lastConfiguredVoiceKey = configKey;

        float pitch = 1.0f;
        float rate = 1.0f;
        boolean preferFemale = true;

        if ("male_1".equals(voiceId)) {
            pitch = 0.65f;
            rate = 0.95f;
            preferFemale = false;
        } else if ("female_2".equals(voiceId)) {
            pitch = 1.30f;
            rate = 1.05f;
            preferFemale = true;
        } else if ("male_2".equals(voiceId)) {
            pitch = 0.76f;
            rate = 0.92f;
            preferFemale = false;
        } else if ("female_in".equals(voiceId)) {
            targetLocale = isHindi ? new Locale("hi", "IN") : new Locale("en", "IN");
            pitch = 1.12f;
            rate = 1.0f;
            preferFemale = true;
        } else if ("male_in".equals(voiceId)) {
            targetLocale = isHindi ? new Locale("hi", "IN") : new Locale("en", "IN");
            pitch = 0.72f;
            rate = 0.95f;
            preferFemale = false;
        } else { // "female_1"
            pitch = 1.15f;
            rate = 1.0f;
            preferFemale = true;
        }

        try {
            textToSpeech.setLanguage(targetLocale);
        } catch (Exception ignored) {}

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            try {
                Voice cachedVoice = resolvedVoiceCache.get(configKey);
                if (cachedVoice != null) {
                    textToSpeech.setVoice(cachedVoice);
                } else {
                    if (cachedVoices == null) {
                        cachedVoices = textToSpeech.getVoices();
                    }
                    if (cachedVoices != null && !cachedVoices.isEmpty()) {
                        Voice bestMatch = null;
                        for (Voice v : cachedVoices) {
                            if (v == null || v.getName() == null) continue;
                            String vName = v.getName().toLowerCase(Locale.ROOT);
                            Locale vLoc = v.getLocale();
                            if (vLoc != null && vLoc.getLanguage().equalsIgnoreCase(targetLocale.getLanguage())) {
                                boolean isFem = vName.contains("female") || vName.contains("#female") || vName.contains("-fem") || vName.contains("f0") || vName.contains("f1") || vName.contains("hia") || vName.contains("hic") || vName.contains("enc") || vName.contains("enf") || vName.contains("iol");
                                boolean isMal = vName.contains("male") || vName.contains("#male") || vName.contains("-mal") || vName.contains("m0") || vName.contains("m1") || vName.contains("hie") || vName.contains("hid") || vName.contains("iom") || vName.contains("end") || vName.contains("ene") || vName.contains("sfg");
                                if (preferFemale && isFem) {
                                    bestMatch = v;
                                    break;
                                } else if (!preferFemale && isMal) {
                                    bestMatch = v;
                                    break;
                                } else if (bestMatch == null) {
                                    bestMatch = v;
                                }
                            }
                        }
                        if (bestMatch != null) {
                            resolvedVoiceCache.put(configKey, bestMatch);
                            textToSpeech.setVoice(bestMatch);
                        }
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Could not set custom Voice object", e);
            }
        }

        textToSpeech.setPitch(pitch);
        textToSpeech.setSpeechRate(rate);
    }

    public void speak(String text, float volume, String utteranceId, UtteranceProgressListener listener) {
        if (!isReady()) return;
        try {
            if (listener != null) {
                textToSpeech.setOnUtteranceProgressListener(listener);
            }
            Bundle params = new Bundle();
            params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volume);
            params.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_ALARM);
            textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId);
        } catch (Exception e) {
            Log.e(TAG, "speak failed", e);
        }
    }

    public void stop() {
        if (isReady()) {
            try {
                textToSpeech.stop();
            } catch (Exception ignored) {}
        }
    }

    private boolean isTextHindi(String text) {
        if (text == null) return false;
        for (char c : text.toCharArray()) {
            if (c >= 0x0900 && c <= 0x097F) return true;
        }
        return false;
    }
}
