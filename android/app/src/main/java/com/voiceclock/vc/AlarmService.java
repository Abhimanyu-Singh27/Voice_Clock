package com.voiceclock.vc;

import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.Vibrator;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;

public class AlarmService extends Service {

    private static final String WAKELOCK_TAG = "VoiceClock:AlarmWakeLock";

    private MediaPlayer mediaPlayer;
    private PowerManager.WakeLock cpuWakeLock;
    private PowerManager.WakeLock screenWakeLock;
    private String currentAlarmId;
    private final Handler ttsHandler = new Handler(Looper.getMainLooper());
    private Runnable ttsRepeatRunnable = null;
    private final Handler silenceHandler = new Handler(Looper.getMainLooper());
    private Runnable autoSilenceRunnable = null;
    private final Handler gradualHandler = new Handler(Looper.getMainLooper());
    private Runnable gradualRunnable = null;
    private Vibrator vibrator = null;
    private float currentVolume = 1.0f;
    private float targetVolume = 1.0f;
    private volatile boolean isRinging = false;
    private volatile boolean isTtsActive = false;

    @Override
    public void onCreate() {
        super.onCreate();
        AlarmNotificationHelper.createNotificationChannel(this);
        createWakeLocks();
        acquireWakeLocks();
    }

    private void createWakeLocks() {
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        if (powerManager != null) {
            // CPU lock ensures background processing and audio continue
            cpuWakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    WAKELOCK_TAG + ":CPU"
            );
            cpuWakeLock.setReferenceCounted(false);

            // Screen lock physically illuminates and keeps the display on
            try {
                screenWakeLock = powerManager.newWakeLock(
                        PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                                | PowerManager.ACQUIRE_CAUSES_WAKEUP
                                | PowerManager.ON_AFTER_RELEASE,
                        WAKELOCK_TAG + ":Screen"
                );
                screenWakeLock.setReferenceCounted(false);
            } catch (Exception e) {
                Log.w("VOICE_CLOCK", "Could not create screen wake lock in AlarmService", e);
            }
        }
    }

    private void acquireWakeLocks() {
        if (cpuWakeLock != null && !cpuWakeLock.isHeld()) {
            try {
                cpuWakeLock.acquire(10 * 60 * 1000L); // 10 minutes
            } catch (Exception ignored) {}
        }
        if (screenWakeLock != null && !screenWakeLock.isHeld()) {
            try {
                screenWakeLock.acquire(60 * 1000L); // 60 seconds
            } catch (Exception ignored) {}
        }
    }

    private void releaseWakeLocks() {
        if (cpuWakeLock != null && cpuWakeLock.isHeld()) {
            try {
                cpuWakeLock.release();
            } catch (Exception ignored) {}
        }
        if (screenWakeLock != null && screenWakeLock.isHeld()) {
            try {
                screenWakeLock.release();
            } catch (Exception ignored) {}
        }
        AlarmReceiver.releaseStaticWakeLocks();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d("VOICE_CLOCK", "AlarmService onStartCommand");

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

        String newAlarmId = intent.getStringExtra("alarmId");
        if (newAlarmId != null && !AlarmPreferences.isAlarmActive(this, newAlarmId)) {
            Log.w("VOICE_CLOCK", "AlarmService: Alarm " + newAlarmId + " is deleted or inactive. Stopping service!");
            AlarmPreferences.cancelAllAlarmIntents(this, newAlarmId);
            stopAlarm();
            return START_NOT_STICKY;
        }

        if (isRinging && currentAlarmId != null && currentAlarmId.equals(newAlarmId)) {
            Log.d("VOICE_CLOCK", "AlarmService already actively ringing for " + currentAlarmId);
            return START_STICKY;
        }

        isRinging = true;
        currentAlarmId = newAlarmId;

        // Restore all audio streams immediately so alarm sound is completely audible
        SilentSpeechAudioHelper.restoreGlobalAudio(this);
        if (VoiceAssistantService.activeService != null) {
            VoiceAssistantService.activeService.pauseListeningForTTS();
        }

        // Immediately wake CPU and display hardware
        acquireWakeLocks();

        // Start foreground notification with full-screen intent
        startForeground(
                AlarmNotificationHelper.NOTIFICATION_ID,
                AlarmNotificationHelper.createNotification(this, intent)
        );

        // Open full-screen AlarmActivity to turn on screen and show Snooze/Dismiss UI
        Intent alarmIntent = new Intent(this, AlarmActivity.class);
        alarmIntent.setAction("com.voiceclock.vc.ACTION_ALARM_RING_" + ((currentAlarmId != null) ? currentAlarmId : System.currentTimeMillis()));
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
            android.os.Bundle optionsBundle = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                android.app.ActivityOptions options = android.app.ActivityOptions.makeBasic();
                options.setPendingIntentBackgroundActivityStartMode(android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
                optionsBundle = options.toBundle();
            }
            if (optionsBundle != null) {
                startActivity(alarmIntent, optionsBundle);
            } else {
                startActivity(alarmIntent);
            }
        } catch (Exception e) {
            Log.w("VOICE_CLOCK", "Direct startActivity from AlarmService threw exception: " + e.getMessage());
        }

        // 1. Auto-silence setup
        final int silenceSecs = AlarmPreferences.getSilenceAfter(this);
        if (autoSilenceRunnable != null) {
            silenceHandler.removeCallbacks(autoSilenceRunnable);
            autoSilenceRunnable = null;
        }
        if (silenceSecs > 0) {
            autoSilenceRunnable = () -> {
                Log.d("VOICE_CLOCK", "Auto-silence duration reached: " + silenceSecs + "s. Stopping alarm.");
                stopAlarm();
            };
            silenceHandler.postDelayed(autoSilenceRunnable, silenceSecs * 1000L);
        }

        // 2. Volume and gradual increase setup
        final int alarmVol = AlarmPreferences.getAlarmVolume(this);
        targetVolume = Math.max(0.05f, Math.min(1.0f, alarmVol / 100.0f));
        final int gradualSecs = AlarmPreferences.getGradualVolumeSeconds(this);

        if (gradualRunnable != null) {
            gradualHandler.removeCallbacks(gradualRunnable);
            gradualRunnable = null;
        }

        if (gradualSecs > 0) {
            currentVolume = 0.05f;
            final long intervalMs = 250L;
            final float totalSteps = (gradualSecs * 1000f) / intervalMs;
            final float stepVolume = (targetVolume - 0.05f) / Math.max(1f, totalSteps);

            gradualRunnable = new Runnable() {
                @Override
                public void run() {
                    if (!isRinging) return;
                    currentVolume = Math.min(targetVolume, currentVolume + stepVolume);
                    if (mediaPlayer != null) {
                        try {
                            float vol = isTtsActive ? currentVolume * 0.15f : currentVolume;
                            mediaPlayer.setVolume(vol, vol);
                        } catch (Exception ignored) {}
                    }
                    if (currentVolume < targetVolume) {
                        gradualHandler.postDelayed(this, intervalMs);
                    }
                }
            };
            gradualHandler.postDelayed(gradualRunnable, intervalMs);
        } else {
            currentVolume = targetVolume;
        }

        // 3. Vibration setup
        if (AlarmPreferences.isTimerVibrate(this)) {
            try {
                vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (vibrator != null && vibrator.hasVibrator()) {
                    long[] pattern = {0, 600, 400, 600, 400};
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        vibrator.vibrate(android.os.VibrationEffect.createWaveform(pattern, 0));
                    } else {
                        vibrator.vibrate(pattern, 0);
                    }
                }
            } catch (Exception ignored) {}
        }

        String type = intent.getStringExtra("type");
        String label = intent.getStringExtra("label");
        String text = intent.getStringExtra("text");
        String voice = intent.getStringExtra("voice");
        String uri = intent.getStringExtra("uri");
        final String selectedVoice = (voice != null && !voice.trim().isEmpty()) ? voice : "female_1";

        boolean hasChosenAudioFile = ("file".equals(type) || "upload".equals(type)) && (uri != null && !uri.trim().isEmpty());

        if (hasChosenAudioFile) {
            // ONLY if user explicitly chose an audio file to play
            try {
                mediaPlayer = new MediaPlayer();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    mediaPlayer.setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build());
                }
                mediaPlayer.setDataSource(this, Uri.parse(uri));
                mediaPlayer.setLooping(true);
                mediaPlayer.prepare();
                mediaPlayer.setVolume(currentVolume, currentVolume);
                mediaPlayer.start();
            } catch (Exception e) {
                Log.e("VOICE_CLOCK", "Failed to play chosen audio file", e);
            }
        } else {
            // Voice / TTS / Default alarm: speak directly with clean TTS without pre-roll chime/audio overlap
            mediaPlayer = null;

            final String speakText =
                    (text == null || text.trim().isEmpty())
                            ? ((label == null || label.trim().isEmpty()) ? "Alarm" : label)
                            : text;

            AppTtsManager ttsMgr = AppTtsManager.getInstance(this);
            if (ttsMgr.isReady()) {
                speakTtsWithDucking(speakText, selectedVoice);
            } else {
                ttsMgr.waitForReady(new AppTtsManager.OnInitCallback() {
                    @Override
                    public void onReady() {
                        if (!isRinging) return;
                        speakTtsWithDucking(speakText, selectedVoice);
                    }

                    @Override
                    public void onError() {
                        Log.e("VOICE_CLOCK", "TTS failed to initialize for alarm");
                    }
                });
            }
        }

        return START_STICKY;
    }

    private void speakTtsWithDucking(final String speakText, final String selectedVoice) {
        if (!isRinging) return;
        AppTtsManager ttsMgr = AppTtsManager.getInstance(this);
        ttsMgr.configureVoice(selectedVoice, speakText);

        isTtsActive = true;
        // Duck background ringtone so spoken voice is clear and crisp
        if (mediaPlayer != null && isRinging) {
            try {
                mediaPlayer.setVolume(currentVolume * 0.15f, currentVolume * 0.15f);
            } catch (Exception ignored) {}
        }

        ttsMgr.speak(speakText, currentVolume, "VOICE_CLOCK", new UtteranceProgressListener() {
            @Override
            public void onStart(String utteranceId) {
                isTtsActive = true;
                if (mediaPlayer != null && isRinging) {
                    try {
                        mediaPlayer.setVolume(currentVolume * 0.15f, currentVolume * 0.15f);
                    } catch (Exception ignored) {}
                }
            }

            @Override
            public void onDone(String utteranceId) {
                if (!isRinging) return;
                isTtsActive = false;
                // Restore ringtone volume between voice repeats
                if (mediaPlayer != null) {
                    try {
                        mediaPlayer.setVolume(currentVolume, currentVolume);
                    } catch (Exception ignored) {}
                }
                ttsRepeatRunnable = () -> {
                    if (!isRinging) return;
                    speakTtsWithDucking(speakText, selectedVoice);
                };
                ttsHandler.postDelayed(ttsRepeatRunnable, 2500);
            }

            @Override
            public void onError(String utteranceId) {
                if (!isRinging) return;
                isTtsActive = false;
                if (mediaPlayer != null) {
                    try {
                        mediaPlayer.setVolume(currentVolume, currentVolume);
                    } catch (Exception ignored) {}
                }
                ttsRepeatRunnable = () -> {
                    if (!isRinging) return;
                    speakTtsWithDucking(speakText, selectedVoice);
                };
                ttsHandler.postDelayed(ttsRepeatRunnable, 2500);
            }
        });
    }

    private synchronized void stopAlarm() {
        isRinging = false;
        isTtsActive = false;

        if (autoSilenceRunnable != null) {
            silenceHandler.removeCallbacks(autoSilenceRunnable);
            autoSilenceRunnable = null;
        }
        silenceHandler.removeCallbacksAndMessages(null);

        if (gradualRunnable != null) {
            gradualHandler.removeCallbacks(gradualRunnable);
            gradualRunnable = null;
        }
        gradualHandler.removeCallbacksAndMessages(null);

        if (vibrator != null) {
            try {
                vibrator.cancel();
            } catch (Exception ignored) {}
            vibrator = null;
        }

        if (ttsRepeatRunnable != null) {
            ttsHandler.removeCallbacks(ttsRepeatRunnable);
            ttsRepeatRunnable = null;
        }
        ttsHandler.removeCallbacksAndMessages(null);

        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) {
                    mediaPlayer.stop();
                }
                mediaPlayer.reset();
                mediaPlayer.release();
            } catch (Exception ignored) {}
            mediaPlayer = null;
        }

        AppTtsManager.getInstance(this).stop();

        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(AlarmNotificationHelper.NOTIFICATION_ID);
            }
        } catch (Exception ignored) {}

        try {
            stopForeground(true);
        } catch (Exception ignored) {}

        // Broadcast to close AlarmActivity if it's currently showing
        try {
            Intent dismissAct = new Intent("com.voiceclock.vc.ACTION_DISMISS_ALARM_ACTIVITY");
            dismissAct.setPackage(getPackageName());
            sendBroadcast(dismissAct);
        } catch (Exception ignored) {}

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
