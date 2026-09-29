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

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;

        // Forcefully wake up CPU and turn screen on immediately
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            try {
                @SuppressWarnings("deprecation")
                PowerManager.WakeLock wakeLock = pm.newWakeLock(
                        PowerManager.FULL_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE,
                        "VoiceClock:AlarmReceiverWakeFull"
                );
                wakeLock.acquire(45000);
            } catch (Exception e) {
                try {
                    PowerManager.WakeLock wakeLock = pm.newWakeLock(
                            PowerManager.PARTIAL_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP,
                            "VoiceClock:AlarmReceiverWakePartial"
                    );
                    wakeLock.acquire(45000);
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
                    PendingIntent showPi = PendingIntent.getActivity(
                            context,
                            requestCode + 100000,
                            showIntent,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    );
                    AlarmManager.AlarmClockInfo clockInfo = new AlarmManager.AlarmClockInfo(snoozeTrigger, showPi);
                    am.setAlarmClock(clockInfo, pi);
                } else {
                    am.setExact(AlarmManager.RTC_WAKEUP, snoozeTrigger, pi);
                }
            }
            return;
        }

        // 1. Start foreground alarm service for continuous audio / TTS
        Intent serviceIntent = new Intent(context, AlarmService.class);
        serviceIntent.setAction("START_ALARM");
        if (intent.getExtras() != null) {
            serviceIntent.putExtras(intent.getExtras());
        }
        ContextCompat.startForegroundService(context, serviceIntent);

        // 2. Directly launch full-screen AlarmActivity to turn on screen and show Snooze/Dismiss UI
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
            context.startActivity(alarmIntent);
        } catch (Exception e) {
            Log.e("VOICE_CLOCK", "Failed to start AlarmActivity from AlarmReceiver", e);
        }
    }
}