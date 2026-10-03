package com.voiceclock.vc;

import android.content.Context;
import android.media.AudioManager;
import android.os.Build;
import android.util.Log;

/**
 * Helper to suppress the default system "beep" / "chime" sound triggered by
 * Android SpeechRecognizer during continuous speech listening cycles.
 * Temporarily mutes notification/system/music streams during recognizer startup
 * and restores them immediately when speech is ready, when TTS speaks,
 * or when an alarm triggers.
 */
public class SilentSpeechAudioHelper {

    private static final String TAG = "SilentSpeechHelper";
    private static volatile SilentSpeechAudioHelper sInstance;

    private final AudioManager audioManager;
    private int originalStreamMusic = -1;
    private int originalStreamNotification = -1;
    private int originalStreamSystem = -1;
    private boolean isMuted = false;

    public SilentSpeechAudioHelper(Context context) {
        this.audioManager = (AudioManager) context.getApplicationContext().getSystemService(Context.AUDIO_SERVICE);
    }

    public static synchronized SilentSpeechAudioHelper getInstance(Context context) {
        if (sInstance == null) {
            sInstance = new SilentSpeechAudioHelper(context);
        }
        return sInstance;
    }

    public static void restoreGlobalAudio(Context context) {
        if (sInstance != null) {
            sInstance.restoreAllAudio();
        } else if (context != null) {
            new SilentSpeechAudioHelper(context).restoreAllAudio();
        }
    }

    public synchronized void muteBeforeStartListening() {
        if (audioManager == null) return;
        try {
            if (!isMuted) {
                try {
                    originalStreamMusic = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
                } catch (Exception ignored) {}
                try {
                    originalStreamNotification = audioManager.getStreamVolume(AudioManager.STREAM_NOTIFICATION);
                } catch (Exception ignored) {}
                try {
                    originalStreamSystem = audioManager.getStreamVolume(AudioManager.STREAM_SYSTEM);
                } catch (Exception ignored) {}
                isMuted = true;
            }

            // 1. Mute STREAM_MUSIC to silence recognizer cue
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, 0);
                }
                audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, 0, 0);
            } catch (Exception ignored) {}

            // 2. Mute STREAM_SYSTEM & STREAM_NOTIFICATION (protected against DND SecurityException)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    audioManager.adjustStreamVolume(AudioManager.STREAM_SYSTEM, AudioManager.ADJUST_MUTE, 0);
                    audioManager.adjustStreamVolume(AudioManager.STREAM_NOTIFICATION, AudioManager.ADJUST_MUTE, 0);
                }
                audioManager.setStreamVolume(AudioManager.STREAM_SYSTEM, 0, 0);
                audioManager.setStreamVolume(AudioManager.STREAM_NOTIFICATION, 0, 0);
            } catch (SecurityException se) {
                Log.d(TAG, "Notification stream mute restricted by system policy; music stream muted.");
            } catch (Exception ignored) {}
        } catch (Exception e) {
            Log.w(TAG, "muteBeforeStartListening failed", e);
        }
    }

    public synchronized void unmuteMusicAfterStart() {
        if (audioManager == null || !isMuted) return;
        try {
            if (originalStreamMusic >= 0) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    try {
                        audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, 0);
                    } catch (Exception ignored) {}
                }
                try {
                    audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, originalStreamMusic, 0);
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
    }

    public synchronized void restoreAllAudio() {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                try { audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, 0); } catch (Exception ignored) {}
                try { audioManager.adjustStreamVolume(AudioManager.STREAM_SYSTEM, AudioManager.ADJUST_UNMUTE, 0); } catch (Exception ignored) {}
                try { audioManager.adjustStreamVolume(AudioManager.STREAM_NOTIFICATION, AudioManager.ADJUST_UNMUTE, 0); } catch (Exception ignored) {}
            }
            if (originalStreamMusic >= 0) {
                try { audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, originalStreamMusic, 0); } catch (Exception ignored) {}
            }
            if (originalStreamSystem >= 0) {
                try { audioManager.setStreamVolume(AudioManager.STREAM_SYSTEM, originalStreamSystem, 0); } catch (Exception ignored) {}
            }
            if (originalStreamNotification >= 0) {
                try { audioManager.setStreamVolume(AudioManager.STREAM_NOTIFICATION, originalStreamNotification, 0); } catch (Exception ignored) {}
            }
        } catch (Exception e) {
            Log.w(TAG, "restoreAllAudio failed", e);
        } finally {
            originalStreamMusic = -1;
            originalStreamNotification = -1;
            originalStreamSystem = -1;
            isMuted = false;
        }
    }

    public synchronized boolean isCurrentlyMuted() {
        return isMuted;
    }
}
