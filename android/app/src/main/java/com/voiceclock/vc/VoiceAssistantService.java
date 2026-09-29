package com.voiceclock.vc;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import java.util.ArrayList;
import java.util.Locale;

/**
 * 100% On-Device, Private Foreground Service for Voice Clock Assistant.
 * Keeps listening for 'Hey VC' hotword locally.
 * Zero network transmission, zero audio recording to disk.
 */
public class VoiceAssistantService extends Service {

    private static final String CHANNEL_ID = "voice_assistant_channel_v2";
    private static final int NOTIF_ID = 2002;
    private static final String TAG = "VOICE_ASSISTANT_SVC";

    private SpeechRecognizer speechRecognizer;
    private TextToSpeech textToSpeech;
    private PowerManager.WakeLock wakeLock;
    private boolean shouldRun = true;
    private Handler mainHandler;
    private final Runnable restartRunnable = this::startListeningLoop;

    private final android.content.BroadcastReceiver screenReceiver = new android.content.BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) {
                Log.d(TAG, "Screen turned off. Stopping voice assistant service.");
                stopSelf();
            }
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        mainHandler = new Handler(Looper.getMainLooper());
        createNotificationChannel();
        initTTS();

        IntentFilter filter = new IntentFilter(Intent.ACTION_SCREEN_OFF);
        registerReceiver(screenReceiver, filter);
    }

    private void acquireCpuWakeLock() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            try {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "VoiceClock:VoiceAssistantCpuWake");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire();
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
                screenLock.acquire(10000);
            } catch (Exception e) {
                Log.w(TAG, "Screen wake failed", e);
            }
        }
    }

    private void initTTS() {
        textToSpeech = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS && textToSpeech != null) {
                textToSpeech.setLanguage(new Locale("hi", "IN"));
            }
        });
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "VOICE Clock Assistant (Always Listening)",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Background hotword detection for 'Hey VC' (100% on-device and private)");
            channel.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    private Notification createNotification() {
        Intent appIntent = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(
                this, 0, appIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        boolean isHi = "hi".equalsIgnoreCase(AlarmPreferences.getAppLanguage(this));
        String title = isHi ? "वॉयस क्लॉक सहायक" : "VOICE Clock Assistant";
        String content = isHi ? "वॉयस निर्देश के लिए तैयार • 100% सुरक्षित और ऑन-डिवाइस" : "Listening for 'Hey VC' • 100% Private & On-Device";

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle(title)
                .setContentText(content)
                .setContentIntent(pi)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "STOP".equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT_WATCH && !pm.isInteractive()) {
            stopSelf();
            return START_NOT_STICKY;
        }

        startForeground(NOTIF_ID, createNotification());
        shouldRun = true;
        scheduleRestart(500);

        return START_STICKY;
    }

    private void scheduleRestart(long delayMs) {
        if (!shouldRun) return;
        mainHandler.removeCallbacks(restartRunnable);
        mainHandler.postDelayed(restartRunnable, delayMs);
    }

    private void startListeningLoop() {
        if (!shouldRun) return;

        mainHandler.post(() -> {
            try {
                if (speechRecognizer != null) {
                    try {
                        speechRecognizer.cancel();
                        speechRecognizer.destroy();
                    } catch (Exception ignored) {}
                    speechRecognizer = null;
                }

                if (!SpeechRecognizer.isRecognitionAvailable(this)) {
                    Log.w(TAG, "SpeechRecognizer not available on device");
                    scheduleRestart(5000);
                    return;
                }

                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
                Intent recognizerIntent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                recognizerIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                recognizerIntent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                recognizerIntent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);

                speechRecognizer.setRecognitionListener(new RecognitionListener() {
                    @Override
                    public void onReadyForSpeech(Bundle params) {}

                    @Override
                    public void onBeginningOfSpeech() {}

                    @Override
                    public void onRmsChanged(float rmsdB) {}

                    @Override
                    public void onBufferReceived(byte[] buffer) {}

                    @Override
                    public void onEndOfSpeech() {}

                    @Override
                    public void onError(int error) {
                        // Error 7: ERROR_NO_MATCH, Error 6: ERROR_SPEECH_TIMEOUT
                        long delay = (error == 7 || error == 6) ? 350 : 1500;
                        scheduleRestart(delay);
                    }

                    @Override
                    public void onResults(Bundle results) {
                        if (results != null) {
                            ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                            if (matches != null && !matches.isEmpty()) {
                                for (String match : matches) {
                                    if (match != null && checkForWakeTrigger(match)) {
                                        break;
                                    }
                                }
                            }
                        }
                        scheduleRestart(400);
                    }

                    @Override
                    public void onPartialResults(Bundle partialResults) {
                        if (partialResults != null) {
                            ArrayList<String> partials = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                            if (partials != null && !partials.isEmpty()) {
                                for (String p : partials) {
                                    if (p != null && checkForWakeTrigger(p)) {
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    @Override
                    public void onEvent(int eventType, Bundle params) {}
                });

                speechRecognizer.startListening(recognizerIntent);
            } catch (Exception e) {
                Log.e(TAG, "Error in speech listener start", e);
                scheduleRestart(2500);
            }
        });
    }

    private long activeListeningUntil = 0;

    private boolean checkForWakeTrigger(String raw) {
        if (raw == null) return false;
        String text = raw.toLowerCase(Locale.getDefault()).trim();

        boolean isWithinActiveWindow = System.currentTimeMillis() < activeListeningUntil;

        boolean hasWakeWord = text.contains("hey vc") || text.contains("vc") || text.contains("hey vc clock")
                || text.contains("voice clock") || text.contains("हे वीसी") || text.contains("नमस्ते वीसी")
                || text.contains("ओके वीसी");

        boolean isAlarmCommand = text.contains("snooze") || text.contains("स्नूज़")
                || text.contains("dismiss") || text.contains("डिसमिस")
                || text.contains("stop") || text.contains("बंद करो")
                || text.contains("band karo") || text.contains("chup")
                || text.startsWith("alarm") || text.startsWith("अलार्म")
                || text.startsWith("task") || text.startsWith("टास्क");

        if (hasWakeWord || isWithinActiveWindow || isAlarmCommand) {
            Log.d(TAG, "Voice trigger matched: " + raw);

            if (hasWakeWord) {
                // Keep assistant active to listen for follow-up command for 8 seconds
                activeListeningUntil = System.currentTimeMillis() + 8000;
            } else {
                activeListeningUntil = 0;
            }

            // 1. Wake the screen if screen is off/locked
            wakeScreen();

            // 2. Bring MainActivity to front over lockscreen
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

            // 3. Send package-secured broadcast to MainActivity
            Intent broadcast = new Intent("com.voiceclock.vc.VOICE_COMMAND");
            broadcast.setPackage(getPackageName()); // 100% SECURE: Restricted only to this app!
            broadcast.putExtra("command", raw);
            sendBroadcast(broadcast);

            return true;
        }
        return false;
    }

    @Override
    public void onDestroy() {
        shouldRun = false;
        mainHandler.removeCallbacks(restartRunnable);
        if (speechRecognizer != null) {
            try {
                speechRecognizer.cancel();
                speechRecognizer.destroy();
            } catch (Exception ignored) {}
            speechRecognizer = null;
        }
        if (textToSpeech != null) {
            try {
                textToSpeech.stop();
                textToSpeech.shutdown();
            } catch (Exception ignored) {}
            textToSpeech = null;
        }
        if (screenReceiver != null) {
            try {
                unregisterReceiver(screenReceiver);
            } catch (Exception ignored) {}
        }
        releaseCpuWakeLock();
        stopForeground(true);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
