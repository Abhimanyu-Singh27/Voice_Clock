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
import android.util.Log;
import java.util.Locale;

public class AlarmService extends Service {

    private static final String CHANNEL_ID = AlarmNotificationHelper.CHANNEL_ID;
    private static final String WAKELOCK_TAG = "VoiceClock:AlarmWakeLock";

    private MediaPlayer mediaPlayer;
    private TextToSpeech textToSpeech;
    private PowerManager.WakeLock cpuWakeLock;
    private PowerManager.WakeLock screenWakeLock;
    private String currentAlarmId;

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
            String alarmId = intent.getStringExtra("alarmId");
            if (alarmId == null && currentAlarmId != null) {
                alarmId = currentAlarmId;
            }
            if (alarmId != null) {
                AlarmPreferences.removeAlarm(this, alarmId);
                AlarmPreferences.recordPendingAction(this, alarmId, "dismiss");
            }
            stopAlarm();
            return START_NOT_STICKY;
        }

        if (!"START_ALARM".equals(action)) {
            return START_NOT_STICKY;
        }

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
            startActivity(alarmIntent);
        } catch (Exception e) {
            Log.e("VOICE_CLOCK", "Failed to launch AlarmActivity", e);
        }

        String type = intent.getStringExtra("type");
        String label = intent.getStringExtra("label");
        String text = intent.getStringExtra("text");

        if ("tts".equals(type) || "task".equals(type)) {

            // Immediate audio chime while TTS initializes so device rings instantly
            try {
                Uri chimeUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                if (chimeUri == null) chimeUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
                MediaPlayer introBeep = MediaPlayer.create(this, chimeUri);
                if (introBeep != null) {
                    introBeep.setOnCompletionListener(MediaPlayer::release);
                    introBeep.start();
                }
            } catch (Exception ignored) {}

            String speakText =
                    (text == null || text.trim().isEmpty())
                            ? label
                            : text;

            textToSpeech = new TextToSpeech(this, status -> {

                if (status == TextToSpeech.SUCCESS && textToSpeech != null) {

                    textToSpeech.setLanguage(Locale.getDefault());

                    textToSpeech.setOnUtteranceProgressListener(new android.speech.tts.UtteranceProgressListener() {
                        @Override
                        public void onStart(String utteranceId) {}

                        @Override
                        public void onDone(String utteranceId) {
                            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                                if (textToSpeech != null) {
                                    textToSpeech.speak(
                                            speakText,
                                            TextToSpeech.QUEUE_FLUSH,
                                            null,
                                            "VOICE_CLOCK"
                                    );
                                }
                            }, 2000);
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

    private void stopAlarm() {
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

        stopForeground(true);
        releaseWakeLocks();
        stopSelf();
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