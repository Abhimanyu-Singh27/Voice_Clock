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

    private static PowerManager.WakeLock sWakeLock;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;

        // Forcefully wake up CPU and turn screen on immediately
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            try {
                if (sWakeLock != null && sWakeLock.isHeld()) {
                    try { sWakeLock.release(); } catch (Exception ignored) {}
                }
                sWakeLock = pm.newWakeLock(
                        PowerManager.PARTIAL_WAKE_LOCK,
                        "VoiceClock:AlarmReceiverCpuWake"
                );
                sWakeLock.acquire(60000);
            } catch (Exception ignored) {}

            try {
                @SuppressWarnings("deprecation")
                PowerManager.WakeLock screenLock = pm.newWakeLock(
                        PowerManager.FULL_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE,
                        "VoiceClock:AlarmReceiverScreenBright"
                );
                screenLock.acquire(30000);
            } catch (Exception e1) {
                try {
                    @SuppressWarnings("deprecation")
                    PowerManager.WakeLock screenLock2 = pm.newWakeLock(
                            PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE,
                            "VoiceClock:AlarmReceiverScreenBright2"
                    );
                    screenLock2.acquire(30000);
                } catch (Exception ignored) {}
            }
        }

        // If this is a Snooze trigger action from notification
        long snoozeTrigger = intent.getLongExtra("snoozeTrigger", 0);
        if (snoozeTrigger > System.currentTimeMillis()) {
            // Stop active alarm service first
            Intent stop = new Intent(context, AlarmService.class);
            stop.setAction("STOP_ALARM");
            context.startService(stop);

            String alarmId = intent.getStringExtra("alarmId");

            // Update AlarmPreferences so native state reflects the snoozed future time
            if (alarmId != null) {
                AlarmPreferences.snoozeAlarm(context, alarmId, snoozeTrigger);
                AlarmPreferences.recordPendingAction(context, alarmId, "snooze");
            }

            // Re-schedule alarm in AlarmManager with setAlarmClock so it wakes screen later
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (am != null) {
                Intent rescheduled = new Intent(context, AlarmReceiver.class);
                if (intent.getExtras() != null) {
                    rescheduled.putExtras(intent.getExtras());
                }
                rescheduled.removeExtra("snoozeTrigger");

                int requestCode = (alarmId != null) ? alarmId.hashCode() : 1001;

                PendingIntent pi = PendingIntent.getBroadcast(
                        context,
                        requestCode,
                        rescheduled,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    Intent showIntent = new Intent(context, AlarmActivity.class);
                    if (intent.getExtras() != null) {
                        showIntent.putExtras(intent.getExtras());
                    }
                    showIntent.removeExtra("snoozeTrigger");
                    showIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

                    android.os.Bundle optionsBundle = null;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                        android.app.ActivityOptions options = android.app.ActivityOptions.makeBasic();
                        options.setPendingIntentBackgroundActivityStartMode(android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
                        optionsBundle = options.toBundle();
                    }

                    PendingIntent showPi = PendingIntent.getActivity(
                            context,
                            requestCode + 100000,
                            showIntent,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE,
                            optionsBundle
                    );
                    AlarmManager.AlarmClockInfo clockInfo = new AlarmManager.AlarmClockInfo(snoozeTrigger, showPi);
                    try {
                        am.setAlarmClock(clockInfo, pi);
                    } catch (SecurityException se) {
                        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, snoozeTrigger, pi);
                    }
                } else {
                    am.setExact(AlarmManager.RTC_WAKEUP, snoozeTrigger, pi);
                }
            }
            return;
        }

        // 1. Post notification immediately with full-screen intent so Android OS wakes the display
        try {
            android.app.Notification notification = AlarmNotificationHelper.createNotification(context, intent);
            android.app.NotificationManager nm = (android.app.NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.notify(AlarmNotificationHelper.NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            Log.e("VOICE_CLOCK", "Failed to post alarm notification directly", e);
        }

        // 2. Start foreground alarm service for continuous audio / TTS
        Intent serviceIntent = new Intent(context, AlarmService.class);
        serviceIntent.setAction("START_ALARM");
        if (intent.getExtras() != null) {
            serviceIntent.putExtras(intent.getExtras());
        }
        ContextCompat.startForegroundService(context, serviceIntent);

        // 3. Directly launch full-screen AlarmActivity to turn on screen and show Snooze/Dismiss UI
        Intent alarmIntent = new Intent(context, AlarmActivity.class);
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
                context.startActivity(alarmIntent, options);
            } else {
                context.startActivity(alarmIntent);
            }
        } catch (Exception e) {
            Log.w("VOICE_CLOCK", "Direct startActivity from AlarmReceiver blocked or failed (handled by fullScreenIntent)", e);
        }

        // 4. Notify MainActivity so the in-app modal also wakes up and prepares Snooze/Dismiss UI
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