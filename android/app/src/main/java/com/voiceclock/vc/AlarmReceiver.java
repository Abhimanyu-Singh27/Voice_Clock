package com.voiceclock.vc;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;
import androidx.core.content.ContextCompat;

public class AlarmReceiver extends BroadcastReceiver {

    private static PowerManager.WakeLock sCpuWakeLock;
    private static PowerManager.WakeLock sScreenWakeLock;

    public static synchronized void acquireStaticWakeLocks(Context context) {
        if (context == null) return;
        PowerManager pm = (PowerManager) context.getApplicationContext().getSystemService(Context.POWER_SERVICE);
        if (pm == null) return;

        // 1. Partial CPU wakelock guarantees CPU stays awake to process receiver, service and activity launch
        try {
            if (sCpuWakeLock == null) {
                sCpuWakeLock = pm.newWakeLock(
                        PowerManager.PARTIAL_WAKE_LOCK,
                        "VoiceClock:AlarmReceiverCpuWake"
                );
                sCpuWakeLock.setReferenceCounted(false);
            }
            if (!sCpuWakeLock.isHeld()) {
                sCpuWakeLock.acquire(120000); // 2 minutes
            }
        } catch (Exception e) {
            Log.w("VOICE_CLOCK", "Could not acquire CPU wakelock in AlarmReceiver", e);
        }

        // 2. Screen bright wakelock with ACQUIRE_CAUSES_WAKEUP physically illuminates the screen from deep sleep
        try {
            if (sScreenWakeLock == null) {
                sScreenWakeLock = pm.newWakeLock(
                        PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                                | PowerManager.ACQUIRE_CAUSES_WAKEUP
                                | PowerManager.ON_AFTER_RELEASE,
                        "VoiceClock:AlarmReceiverScreenWake"
                );
                sScreenWakeLock.setReferenceCounted(false);
            }
            if (!sScreenWakeLock.isHeld()) {
                sScreenWakeLock.acquire(45000); // 45 seconds
            }
        } catch (Exception e) {
            Log.w("VOICE_CLOCK", "Could not acquire screen wakelock in AlarmReceiver", e);
        }
    }

    public static synchronized void releaseStaticWakeLocks() {
        try {
            if (sCpuWakeLock != null && sCpuWakeLock.isHeld()) {
                sCpuWakeLock.release();
            }
        } catch (Exception ignored) {}
        try {
            if (sScreenWakeLock != null && sScreenWakeLock.isHeld()) {
                sScreenWakeLock.release();
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;

        String alarmId = intent.getStringExtra("alarmId");
        if (alarmId != null && !AlarmPreferences.isAlarmActive(context, alarmId)) {
            Log.w("VOICE_CLOCK", "AlarmReceiver: Alarm " + alarmId + " is deleted or inactive. Canceling residual intents and ignoring.");
            AlarmPreferences.cancelAllAlarmIntents(context, alarmId);
            releaseStaticWakeLocks();
            return;
        }

        // Guarantee CPU & screen hardware wake up instantly even if device is in deep Doze mode
        acquireStaticWakeLocks(context);

        // If this is a Snooze trigger action from notification
        long snoozeTrigger = intent.getLongExtra("snoozeTrigger", 0);
        if (snoozeTrigger > System.currentTimeMillis()) {
            if (alarmId != null && !AlarmPreferences.isAlarmActive(context, alarmId)) {
                Log.w("VOICE_CLOCK", "AlarmReceiver snooze: Alarm " + alarmId + " is deleted or inactive. Aborting.");
                AlarmPreferences.cancelAllAlarmIntents(context, alarmId);
                releaseStaticWakeLocks();
                return;
            }

            // Stop active alarm service first
            Intent stop = new Intent(context, AlarmService.class);
            stop.setAction("STOP_ALARM");
            context.startService(stop);

            // Close any open AlarmActivity
            try {
                Intent dismissAct = new Intent("com.voiceclock.vc.ACTION_DISMISS_ALARM_ACTIVITY");
                dismissAct.setPackage(context.getPackageName());
                context.sendBroadcast(dismissAct);
            } catch (Exception ignored) {}

            // Update AlarmPreferences so native state reflects the snoozed future time
            if (alarmId != null) {
                AlarmPreferences.snoozeAlarm(context, alarmId, snoozeTrigger);
                AlarmPreferences.recordPendingAction(context, alarmId, "snooze");
            }

            // Re-schedule alarm directly targeting AlarmReceiver so UI & sound will guaranteed fire
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (am != null) {
                int requestCode = (alarmId != null) ? alarmId.hashCode() : 1001;

                Intent showIntent = new Intent(context, AlarmActivity.class);
                showIntent.setAction("com.voiceclock.vc.ACTION_ALARM_SHOW_" + (alarmId != null ? alarmId : "snooze"));
                if (intent.getExtras() != null) {
                    showIntent.putExtras(intent.getExtras());
                }
                showIntent.removeExtra("snoozeTrigger");
                showIntent.addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK
                                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                                | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                );

                android.os.Bundle optionsBundle = null;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    android.app.ActivityOptions options = android.app.ActivityOptions.makeBasic();
                    options.setPendingIntentCreatorBackgroundActivityStartMode(android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
                    optionsBundle = options.toBundle();
                }

                PendingIntent showPi = PendingIntent.getActivity(
                        context,
                        requestCode,
                        showIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE,
                        optionsBundle
                );

                Intent broadcastIntent = new Intent(context, AlarmReceiver.class);
                broadcastIntent.setAction("com.voiceclock.vc.ACTION_ALARM_TRIGGER_" + (alarmId != null ? alarmId : "snooze"));
                broadcastIntent.setPackage(context.getPackageName());
                if (intent.getExtras() != null) {
                    broadcastIntent.putExtras(intent.getExtras());
                }
                broadcastIntent.removeExtra("snoozeTrigger");

                PendingIntent broadcastPi = PendingIntent.getBroadcast(
                        context,
                        requestCode,
                        broadcastIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );

                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        AlarmManager.AlarmClockInfo clockInfo = new AlarmManager.AlarmClockInfo(snoozeTrigger, showPi);
                        am.setAlarmClock(clockInfo, broadcastPi);
                    } else {
                        am.setExact(AlarmManager.RTC_WAKEUP, snoozeTrigger, broadcastPi);
                    }
                } catch (SecurityException se) {
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, snoozeTrigger, broadcastPi);
                        } else {
                            am.setExact(AlarmManager.RTC_WAKEUP, snoozeTrigger, broadcastPi);
                        }
                    } catch (Exception ex) {
                        try {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                                // setAndAllowWhileIdle does not require SCHEDULE_EXACT_ALARM and wakes device from Doze
                                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, snoozeTrigger, broadcastPi);
                            } else {
                                am.set(AlarmManager.RTC_WAKEUP, snoozeTrigger, broadcastPi);
                            }
                        } catch (Exception e3) {
                            am.set(AlarmManager.RTC_WAKEUP, snoozeTrigger, broadcastPi);
                        }
                    }
                }
            }
            return;
        }

        // Final check before ringing
        if (alarmId != null && !AlarmPreferences.isAlarmActive(context, alarmId)) {
            Log.w("VOICE_CLOCK", "AlarmReceiver pre-ring: Alarm " + alarmId + " is deleted or inactive. Aborting.");
            AlarmPreferences.cancelAllAlarmIntents(context, alarmId);
            releaseStaticWakeLocks();
            return;
        }

        // Restore any muted audio streams immediately so alarm is 100% audible
        SilentSpeechAudioHelper.restoreGlobalAudio(context);

        // Pre-warm TTS engine in background so speech latency is eliminated
        AppTtsManager.getInstance(context).init();

        // 1. Start foreground alarm service for continuous audio / TTS and full-screen notification
        Intent serviceIntent = new Intent(context, AlarmService.class);
        serviceIntent.setAction("START_ALARM");
        if (intent.getExtras() != null) {
            serviceIntent.putExtras(intent.getExtras());
        }
        ContextCompat.startForegroundService(context, serviceIntent);

        // 2. Launch full-screen AlarmActivity to turn on screen and display Snooze/Dismiss UI
        // Since this receiver is triggered by AlarmManager.setAlarmClock, Android grants background start exemption
        Intent alarmIntent = new Intent(context, AlarmActivity.class);
        alarmIntent.setAction("com.voiceclock.vc.ACTION_ALARM_RING_" + ((alarmId != null) ? alarmId : System.currentTimeMillis()));
        if (intent.getExtras() != null) {
            alarmIntent.putExtras(intent.getExtras());
        }
        alarmIntent.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_CLEAR_TOP
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP
                        | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
        );

        int reqCode = (alarmId != null) ? alarmId.hashCode() : 1001;

        try {
            android.os.Bundle optionsBundle = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                android.app.ActivityOptions options = android.app.ActivityOptions.makeBasic();
                options.setPendingIntentBackgroundActivityStartMode(android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
                optionsBundle = options.toBundle();
            }
            if (optionsBundle != null) {
                context.startActivity(alarmIntent, optionsBundle);
            } else {
                context.startActivity(alarmIntent);
            }
        } catch (Exception e) {
            Log.w("VOICE_CLOCK", "Direct startActivity from AlarmReceiver threw exception: " + e.getMessage());
        }

        // 4. Notify MainActivity so the in-app modal also wakes up if in foreground
        try {
            Intent mainAlarmIntent = new Intent("com.voiceclock.vc.ALARM_TRIGGER");
            mainAlarmIntent.setPackage(context.getPackageName());
            if (intent.getExtras() != null) {
                mainAlarmIntent.putExtras(intent.getExtras());
            }
            context.sendBroadcast(mainAlarmIntent);
        } catch (Exception ignored) {}
    }
}
