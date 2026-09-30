package com.voiceclock.vc;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;
import java.util.List;

public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "VOICE_CLOCK_BOOT";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        Log.d(TAG, "Boot event received: " + action);

        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action)) {

            List<AlarmPreferences.SavedAlarm> alarms = AlarmPreferences.getAlarms(context);
            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (alarmManager == null) return;

            long now = System.currentTimeMillis();

            for (AlarmPreferences.SavedAlarm al : alarms) {
                if (al.triggerTime > now) {
                    Intent alarmIntent = new Intent(context, AlarmReceiver.class);
                    alarmIntent.putExtra("alarmId", al.id);
                    alarmIntent.putExtra("label", al.label);
                    alarmIntent.putExtra("type", al.type);
                    alarmIntent.putExtra("voice", al.voice != null ? al.voice : "female_1");
                    alarmIntent.putExtra("mode", "task".equals(al.type) ? "task" : "alarm");

                    PendingIntent pi = PendingIntent.getBroadcast(
                            context,
                            al.id.hashCode(),
                            alarmIntent,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    );

                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            Intent showIntent = new Intent(context, AlarmActivity.class);
                            showIntent.putExtra("alarmId", al.id);
                            showIntent.putExtra("label", al.label);
                            showIntent.putExtra("type", al.type);
                            showIntent.putExtra("text", al.text);
                            showIntent.putExtra("voice", al.voice != null ? al.voice : "female_1");
                            showIntent.putExtra("mode", "task".equals(al.type) ? "task" : "alarm");
                            showIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

                            android.os.Bundle optionsBundle = null;
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                                android.app.ActivityOptions options = android.app.ActivityOptions.makeBasic();
                                options.setPendingIntentBackgroundActivityStartMode(android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
                                optionsBundle = options.toBundle();
                            }

                            PendingIntent showPi = PendingIntent.getActivity(
                                    context,
                                    al.id.hashCode() + 100000,
                                    showIntent,
                                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE,
                                    optionsBundle
                            );

                            AlarmManager.AlarmClockInfo clockInfo = new AlarmManager.AlarmClockInfo(al.triggerTime, showPi);
                            alarmManager.setAlarmClock(clockInfo, pi);
                        } else {
                            alarmManager.setExact(AlarmManager.RTC_WAKEUP, al.triggerTime, pi);
                        }
                        Log.d(TAG, "Rescheduled alarm " + al.id + " for: " + al.triggerTime);
                    } catch (Exception e) {
                        try {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, al.triggerTime, pi);
                            } else {
                                alarmManager.set(AlarmManager.RTC_WAKEUP, al.triggerTime, pi);
                            }
                        } catch (Exception ex) {
                            Log.e(TAG, "Failed to reschedule alarm fallback " + al.id, ex);
                        }
                    }
                }
            }
        }
    }
}
