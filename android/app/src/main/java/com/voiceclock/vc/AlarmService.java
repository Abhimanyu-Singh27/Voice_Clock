package com.voiceclock.vc;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import android.util.Log;
import java.util.Locale;
import java.util.Set;

public class AlarmService extends Service {

    private static final String CHANNEL_ID = AlarmNotificationHelper.CHANNEL_ID;
    private static final String WAKELOCK_TAG = "VoiceClock:AlarmWakeLock";

    private MediaPlayer mediaPlayer;
    private TextToSpeech textToSpeech;
    private PowerManager.WakeLock cpuWakeLock;
    private PowerManager.WakeLock screenWakeLock;
    private String currentAlarmId;
    private volatile boolean isRinging = false;
    private final android.os.Handler ttsHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private Runnable ttsRepeatRunnable = null;

    @Override
    public void onCreate() {
        super.onCreate();

        createNotificationChannel();
        createWakeLocks();
    }

    private void createWakeLocks() {
        PowerManager powerManager =
                (PowerManager) getSystemService(POWER_SERVICE);

        if (powerManager != null) {
            // CPU lock to ensure processing continues
            cpuWakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    WAKELOCK_TAG + ":CPU"
            );
            cpuWakeLock.setReferenceCounted(false);

            // Screen lock to forcibly wake up and turn on the display
            try {
                screenWakeLock = powerManager.newWakeLock(
                        PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                                | PowerManager.ACQUIRE_CAUSES_WAKEUP
                                | PowerManager.ON_AFTER_RELEASE,
                        WAKELOCK_TAG + ":Screen"
                );
                screenWakeLock.setReferenceCounted(false);
            } catch (Exception e) {
                Log.w("VOICE_CLOCK", "Could not create screen wake lock", e);
            }
        }
    }

    private void acquireWakeLocks() {
        if (cpuWakeLock != null && !cpuWakeLock.isHeld()) {
            cpuWakeLock.acquire(10 * 60 * 1000L);
        }
        if (screenWakeLock != null && !screenWakeLock.isHeld()) {
            try {
                screenWakeLock.acquire(45 * 1000L); // Keep screen actively awake for 45s or until dismissed
            } catch (Exception ignored) {}
        }
    }

    private void releaseWakeLocks() {
        if (cpuWakeLock != null && cpuWakeLock.isHeld()) {
            cpuWakeLock.release();
        }
        if (screenWakeLock != null && screenWakeLock.isHeld()) {
            try {
                screenWakeLock.release();
            } catch (Exception ignored) {}
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel =
                    new NotificationChannel(
                            CHANNEL_ID,
                            "Voice Clock Alarm",
                            NotificationManager.IMPORTANCE_HIGH
                    );

            channel.setDescription("Critical alarm notifications that show over lock screen");
            channel.enableVibration(true);
            channel.setBypassDnd(true);
            channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);

            Uri defaultSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .build();
            channel.setSound(defaultSoundUri, audioAttributes);

            NotificationManager manager =
                    getSystemService(NotificationManager.class);

            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d("VOICE_CLOCK", "AlarmService started");

        if (intent == null || intent.getAction() == null) {
            stopSelf();
            return START_NOT_STICKY;
        }

        String action = intent.getAction();

        if ("STOP_ALARM".equals(action)) {
            stopAlarm();
            return START_NOT_STICKY;
        }

        if (!"START_ALARM".equals(action)) {
            return START_NOT_STICKY;
        }

        isRinging = true;
        currentAlarmId = intent.getStringExtra("alarmId");

        // Immediately wake CPU and display
        acquireWakeLocks();

        // Start foreground notification with full screen intent
        startForeground(
                AlarmNotificationHelper.NOTIFICATION_ID,
                AlarmNotificationHelper.createNotification(this, intent)
        );

        // Open alarm screen activity
        Intent alarmIntent = new Intent(this, AlarmActivity.class);
        if (intent.getExtras() != null) {
            alarmIntent.putExtras(intent.getExtras());
        }

        alarmIntent.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_CLEAR_TOP
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP
                        | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
        );

        try {
            android.os.Bundle options = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                android.app.ActivityOptions actOpt = android.app.ActivityOptions.makeBasic();
                actOpt.setPendingIntentBackgroundActivityStartMode(android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
                options = actOpt.toBundle();
            }
            if (options != null) {
                startActivity(alarmIntent, options);
            } else {
                startActivity(alarmIntent);
            }
        } catch (Exception e) {
            Log.e("VOICE_CLOCK", "Failed to launch AlarmActivity", e);
        }

        String type = intent.getStringExtra("type");
        String label = intent.getStringExtra("label");
        String text = intent.getStringExtra("text");
        String voice = intent.getStringExtra("voice");
        final String selectedVoice = (voice != null && !voice.trim().isEmpty()) ? voice : "female_1";

        if ("tts".equals(type) || "task".equals(type)) {

            String speakText =
                    (text == null || text.trim().isEmpty())
                            ? label
                            : text;

            textToSpeech = new TextToSpeech(this, status -> {

                if (status == TextToSpeech.SUCCESS && textToSpeech != null) {

                    configureTtsVoice(textToSpeech, selectedVoice, speakText);

                    textToSpeech.setOnUtteranceProgressListener(new android.speech.tts.UtteranceProgressListener() {
                        @Override
                        public void onStart(String utteranceId) {}

                        @Override
                        public void onDone(String utteranceId) {
                            if (!isRinging) return;
                            ttsRepeatRunnable = () -> {
                                if (!isRinging || textToSpeech == null) return;
                                try {
                                    configureTtsVoice(textToSpeech, selectedVoice, speakText);
                                    textToSpeech.speak(
                                            speakText,
                                            TextToSpeech.QUEUE_FLUSH,
                                            null,
                                            "VOICE_CLOCK"
                                    );
                                } catch (Exception ignored) {}
                            };
                            ttsHandler.postDelayed(ttsRepeatRunnable, 2000);
                        }

                        @Override
                        public void onError(String utteranceId) {}
                    });

                    textToSpeech.speak(
                            speakText,
                            TextToSpeech.QUEUE_FLUSH,
                            null,
                            "VOICE_CLOCK"
                    );
                }

            });

        } else if ("file".equals(type)) {

            try {
                String uri = intent.getStringExtra("uri");
                if (uri != null) {
                    mediaPlayer = new MediaPlayer();
                    mediaPlayer.setDataSource(this, android.net.Uri.parse(uri));
                    mediaPlayer.setLooping(true);
                    mediaPlayer.prepare();
                    mediaPlayer.start();
                }
            } catch (Exception e) {
                e.printStackTrace();
            }

        } else {

            // Default alarm ringtone playback
            try {
                Uri alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
                if (alarmSound == null) alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                mediaPlayer = MediaPlayer.create(this, alarmSound);
                if (mediaPlayer != null) {
                    mediaPlayer.setLooping(true);
                    mediaPlayer.start();
                }
            } catch (Exception e) {
                e.printStackTrace();
            }

        }

        return START_STICKY;
    }

    private synchronized void stopAlarm() {
        isRinging = false;

        if (ttsRepeatRunnable != null) {
            ttsHandler.removeCallbacks(ttsRepeatRunnable);
            ttsRepeatRunnable = null;
        }
        ttsHandler.removeCallbacksAndMessages(null);

        if (mediaPlayer != null) {
            try {
                mediaPlayer.stop();
                mediaPlayer.release();
            } catch (Exception ignored) {}
            mediaPlayer = null;
        }

        if (textToSpeech != null) {
            try {
                textToSpeech.stop();
                textToSpeech.shutdown();
            } catch (Exception ignored) {}
            textToSpeech = null;
        }

        try {
            android.app.NotificationManager nm = (android.app.NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(AlarmNotificationHelper.NOTIFICATION_ID);
            }
        } catch (Exception ignored) {}

        try {
            stopForeground(true);
        } catch (Exception ignored) {}

        releaseWakeLocks();
        stopSelf();
    }

    private void configureTtsVoice(TextToSpeech tts, String voiceId, String text) {
        if (tts == null) return;

        boolean isHindi = isTextHindi(text) || "hi".equalsIgnoreCase(AlarmPreferences.getAppLanguage(this));
        Locale targetLocale = isHindi ? new Locale("hi", "IN") : Locale.US;

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
            tts.setLanguage(targetLocale);
        } catch (Exception ignored) {}

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            try {
                Set<Voice> voices = tts.getVoices();
                if (voices != null && !voices.isEmpty()) {
                    Voice bestMatch = null;
                    for (Voice v : voices) {
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
                        tts.setVoice(bestMatch);
                    }
                }
            } catch (Exception e) {
                Log.w("VOICE_CLOCK", "Could not set custom system Voice object", e);
            }
        }

        // Apply pitch & speech rate AFTER setVoice to ensure engine preserves custom pitch
        tts.setPitch(pitch);
        tts.setSpeechRate(rate);
    }

    private boolean isTextHindi(String text) {
        if (text == null) return false;
        for (char c : text.toCharArray()) {
            if (c >= 0x0900 && c <= 0x097F) return true;
        }
        return false;
    }

    @Override
    public void onDestroy() {
        stopAlarm();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}