package com.voiceclock.vc;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import java.util.ArrayList;
import java.util.Locale;

/**
 * Continuous Foreground Service for Voice Clock Assistant.
 * Listens continuously and silently without default start/stop beeps.
 * Runs in background while the app is active/minimized.
 * Automatically stops when the app task is removed from tab history / recents.
 */
public class VoiceAssistantService extends Service {

    private static final String CHANNEL_ID = "voice_assistant_channel_v3";
    private static final int NOTIF_ID = 2002;
    private static final String TAG = "VOICE_ASSISTANT_SVC";

    public static volatile VoiceAssistantService activeService = null;

    private SpeechRecognizer speechRecognizer;
    private SilentSpeechAudioHelper audioHelper;
    private PowerManager.WakeLock wakeLock;
    private volatile boolean shouldRun = false;
    private volatile boolean isTtsSpeaking = false;
    private Handler mainHandler;
    private final Runnable restartRunnable = this::startListeningLoop;
    private String currentVoiceLanguage = "bilingual";

    public static boolean isRunning() {
        return activeService != null && activeService.shouldRun;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        activeService = this;
        mainHandler = new Handler(Looper.getMainLooper());
        audioHelper = SilentSpeechAudioHelper.getInstance(this);
        createNotificationChannel();
        acquireCpuWakeLock();
    }

    private void acquireCpuWakeLock() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            try {
                if (wakeLock == null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "VoiceClock:VoiceAssistantCpuWake");
                    wakeLock.setReferenceCounted(false);
                }
                if (!wakeLock.isHeld()) {
                    wakeLock.acquire();
                }
            } catch (Exception e) {
                Log.w(TAG, "Could not acquire CPU wake lock", e);
            }
        }
    }

    private void releaseCpuWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (Exception ignored) {}
        }
    }

    private void wakeScreen() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            try {
                PowerManager.WakeLock screenLock = pm.newWakeLock(
                        PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                                | PowerManager.ACQUIRE_CAUSES_WAKEUP
                                | PowerManager.ON_AFTER_RELEASE,
                        "VoiceClock:VoiceWakeScreen"
                );
                screenLock.acquire(8000);
            } catch (Exception e) {
                Log.w(TAG, "Screen wake failed", e);
            }
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "VOICE Clock Continuous Assistant",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Continuous background listening for voice commands (100% on-device & private)");
            channel.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    private Notification createNotification() {
        Intent appIntent = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(
                this, 0, appIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        Intent stopIntent = new Intent(this, VoiceAssistantService.class);
        stopIntent.setAction("STOP");
        PendingIntent stopPi = PendingIntent.getService(
                this, 1, stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        boolean isHi = "hi".equalsIgnoreCase(AlarmPreferences.getAppLanguage(this));
        String title = isHi ? "वॉयस क्लॉक सहायक सक्रिय है" : "VOICE Clock Assistant Active";
        String content = isHi ? "लगातार सुन रहा है • निर्देश बोलें (100% सुरक्षित)" : "Listening continuously • Speak any command (100% Private)";
        String stopLabel = isHi ? "बंद करें" : "Stop";

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle(title)
                .setContentText(content)
                .setContentIntent(pi)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, stopLabel, stopPi)
                .build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "STOP".equals(intent.getAction())) {
            stopListeningAndCleanup();
            stopSelf();
            return START_NOT_STICKY;
        }

        if (intent != null && intent.hasExtra("lang")) {
            String l = intent.getStringExtra("lang");
            if (l != null && !l.trim().isEmpty()) {
                currentVoiceLanguage = l;
            }
        }

        startForeground(NOTIF_ID, createNotification());
        shouldRun = true;
        activeService = this;

        if (MainActivity.activeInstance != null) {
            MainActivity.activeInstance.runOnUiThread(() -> MainActivity.activeInstance.onVoiceServiceStarted());
        }

        scheduleRestart(200);
        return START_STICKY;
    }

    private void scheduleRestart(long delayMs) {
        if (!shouldRun || isTtsSpeaking) return;
        mainHandler.removeCallbacks(restartRunnable);
        mainHandler.postDelayed(restartRunnable, Math.max(100, delayMs));
    }

    private void startListeningLoop() {
        if (!shouldRun || isTtsSpeaking) return;

        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "Audio record permission not granted, pausing loop");
            return;
        }

        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            Log.w(TAG, "SpeechRecognizer not available on device");
            scheduleRestart(4000);
            return;
        }

        mainHandler.post(() -> {
            if (!shouldRun || isTtsSpeaking) return;

            try {
                if (speechRecognizer == null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(VoiceAssistantService.this)) {
                        try {
                            speechRecognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(VoiceAssistantService.this);
                        } catch (Exception e) {
                            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(VoiceAssistantService.this);
                        }
                    } else {
                        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(VoiceAssistantService.this);
                    }
                }

                Intent recognizerIntent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                recognizerIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                recognizerIntent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                recognizerIntent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
                recognizerIntent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 10000L);
                recognizerIntent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 10000L);
                recognizerIntent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 8000L);
                recognizerIntent.putExtra("android.speech.extra.DICTATION_MODE", true);

                String primaryLang = "hi-IN";
                if ("en-US".equalsIgnoreCase(currentVoiceLanguage)) {
                    primaryLang = "en-US";
                    recognizerIntent.putExtra("android.speech.extra.EXTRA_ADDITIONAL_LANGUAGES", new String[]{"hi-IN", "en-IN"});
                } else if ("en-IN".equalsIgnoreCase(currentVoiceLanguage)) {
                    primaryLang = "en-IN";
                    recognizerIntent.putExtra("android.speech.extra.EXTRA_ADDITIONAL_LANGUAGES", new String[]{"hi-IN", "en-US"});
                } else if ("hi-IN".equalsIgnoreCase(currentVoiceLanguage) || "hi".equalsIgnoreCase(currentVoiceLanguage)) {
                    primaryLang = "hi-IN";
                    recognizerIntent.putExtra("android.speech.extra.EXTRA_ADDITIONAL_LANGUAGES", new String[]{"en-IN", "en-US"});
                } else {
                    primaryLang = "hi-IN";
                    recognizerIntent.putExtra("android.speech.extra.EXTRA_ADDITIONAL_LANGUAGES", new String[]{"hi-IN", "en-IN", "en-US"});
                }
                recognizerIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, primaryLang);
                recognizerIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, primaryLang);

                speechRecognizer.setRecognitionListener(new RecognitionListener() {
                    @Override
                    public void onReadyForSpeech(Bundle params) {
                        // After recognizer is ready, unmute music stream (start beep has passed in silence)
                        mainHandler.postDelayed(() -> {
                            if (audioHelper != null) {
                                audioHelper.unmuteMusicAfterStart();
                            }
                        }, 300);

                        if (MainActivity.activeInstance != null) {
                            MainActivity.activeInstance.runOnUiThread(() -> MainActivity.activeInstance.updateVoiceState("listening"));
                        }
                    }

                    @Override
                    public void onBeginningOfSpeech() {
                        if (MainActivity.activeInstance != null) {
                            MainActivity.activeInstance.runOnUiThread(() -> MainActivity.activeInstance.updateVoiceState("speaking"));
                        }
                    }

                    @Override
                    public void onRmsChanged(float rmsdB) {}

                    @Override
                    public void onBufferReceived(byte[] buffer) {}

                    @Override
                    public void onEndOfSpeech() {
                        if (MainActivity.activeInstance != null) {
                            MainActivity.activeInstance.runOnUiThread(() -> MainActivity.activeInstance.updateVoiceState("processing"));
                        }
                    }

                    @Override
                    public void onError(int error) {
                        if (!shouldRun || isTtsSpeaking) return;

                        if (error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT || error == SpeechRecognizer.ERROR_NO_MATCH) {
                            // Normal silence timeout; restart silently without delay
                            scheduleRestart(250);
                        } else if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY || error == SpeechRecognizer.ERROR_CLIENT) {
                            if (speechRecognizer != null) {
                                try { speechRecognizer.cancel(); } catch (Exception ignored) {}
                            }
                            scheduleRestart(500);
                        } else {
                            // Recover from unexpected recognition error
                            destroyRecognizer();
                            scheduleRestart(1200);
                        }
                    }

                    @Override
                    public void onResults(Bundle results) {
                        if (results != null) {
                            ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                            if (matches != null && !matches.isEmpty()) {
                                String chosenMatch = matches.get(0);
                                for (String m : matches) {
                                    if (m != null) {
                                        String lower = m.toLowerCase();
                                        if (lower.contains("hey vc") || lower.contains("vc") || lower.contains("alarm")
                                                || lower.contains("अलार्म") || lower.contains("task") || lower.contains("टास्क")
                                                || lower.contains("stop") || lower.contains("snooze") || lower.contains("हे वीसी")
                                                || lower.contains("band") || lower.contains("chup") || lower.contains("time")
                                                || lower.contains("समय") || lower.contains("बजे") || lower.contains("delete")
                                                || lower.contains("डिलीट") || lower.contains("hatao") || lower.contains("हटाओ")
                                                || lower.contains("dismiss") || lower.contains("डिसमिस") || lower.contains("cancel")
                                                || lower.contains("rok") || lower.contains("turn off") || lower.contains("clear")) {
                                            chosenMatch = m;
                                            break;
                                        }
                                    }
                                }

                                if (chosenMatch != null && !chosenMatch.trim().isEmpty()) {
                                    handleRecognizedSpeech(chosenMatch.trim());
                                }
                            }
                        }

                        scheduleRestart(600);
                    }

                    @Override
                    public void onPartialResults(Bundle partialResults) {
                        if (partialResults != null && MainActivity.activeInstance != null) {
                            ArrayList<String> partials = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                            if (partials != null && !partials.isEmpty()) {
                                final String text = partials.get(0);
                                MainActivity.activeInstance.runOnUiThread(() -> MainActivity.activeInstance.handleLiveTranscript(text));
                            }
                        }
                    }

                    @Override
                    public void onEvent(int eventType, Bundle params) {}
                });

                // Mute audio streams immediately before startListening so start beep is completely silent!
                audioHelper.muteBeforeStartListening();
                speechRecognizer.startListening(recognizerIntent);

            } catch (Exception e) {
                Log.e(TAG, "Error in speech listener start", e);
                destroyRecognizer();
                scheduleRestart(2000);
            }
        });
    }

    private void handleRecognizedSpeech(String raw) {
        if (raw == null || raw.trim().isEmpty()) return;
        Log.d(TAG, "Speech recognized: " + raw);

        // Restore audio completely so TTS or media can respond loudly
        audioHelper.restoreAllAudio();

        // Wake screen if off or locked
        wakeScreen();

        if (MainActivity.activeInstance != null && MainActivity.activeInstance.getWebView() != null) {
            MainActivity.activeInstance.runOnUiThread(() -> MainActivity.activeInstance.handleVoiceInput(raw));
        } else {
            // MainActivity is not currently visible or active; wake it up and deliver command
            Intent activityIntent = new Intent(this, MainActivity.class);
            activityIntent.setAction("com.voiceclock.vc.WAKE_VOICE");
            activityIntent.putExtra("command", raw);
            activityIntent.addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK
                            | Intent.FLAG_ACTIVITY_SINGLE_TOP
                            | Intent.FLAG_ACTIVITY_CLEAR_TOP
                            | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
            );
            try {
                startActivity(activityIntent);
            } catch (Exception e) {
                Log.e(TAG, "Failed to start MainActivity for voice wake", e);
            }

            Intent broadcast = new Intent("com.voiceclock.vc.VOICE_COMMAND");
            broadcast.setPackage(getPackageName());
            broadcast.putExtra("command", raw);
            sendBroadcast(broadcast);
        }
    }

    public void pauseListeningForTTS() {
        isTtsSpeaking = true;
        mainHandler.removeCallbacks(restartRunnable);
        if (speechRecognizer != null) {
            try { speechRecognizer.cancel(); } catch (Exception ignored) {}
        }
        if (audioHelper != null) {
            audioHelper.restoreAllAudio();
        }
    }

    public void resumeListeningAfterTTS() {
        isTtsSpeaking = false;
        if (shouldRun) {
            scheduleRestart(400);
        }
    }

    public void setVoiceLanguage(String lang) {
        if (lang != null && !lang.trim().isEmpty()) {
            this.currentVoiceLanguage = lang;
            if (shouldRun && !isTtsSpeaking) {
                if (speechRecognizer != null) {
                    try { speechRecognizer.cancel(); } catch (Exception ignored) {}
                }
                scheduleRestart(250);
            }
        }
    }

    private void destroyRecognizer() {
        if (speechRecognizer != null) {
            try {
                speechRecognizer.cancel();
                speechRecognizer.destroy();
            } catch (Exception ignored) {}
            speechRecognizer = null;
        }
    }

    private void stopListeningAndCleanup() {
        shouldRun = false;
        mainHandler.removeCallbacks(restartRunnable);
        destroyRecognizer();
        if (audioHelper != null) {
            audioHelper.restoreAllAudio();
        }
        releaseCpuWakeLock();
        stopForeground(true);
        activeService = null;

        if (MainActivity.activeInstance != null) {
            MainActivity.activeInstance.runOnUiThread(() -> MainActivity.activeInstance.onVoiceServiceStopped());
        }
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        Log.d(TAG, "App task removed from recents / all tab history. Automatically stopping VoiceAssistantService.");
        stopListeningAndCleanup();
        stopSelf();
    }

    @Override
    public void onDestroy() {
        stopListeningAndCleanup();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
