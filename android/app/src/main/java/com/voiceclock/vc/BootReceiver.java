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
                    alarmIntent.putExtra("text", al.text);
                    alarmIntent.putExtra("mode", "task".equals(al.type) ? "task" : "alarm");

                    PendingIntent pi = PendingIntent.getBroadcast(
                            context,
                            al.id.hashCode(),
                            alarmIntent,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    );

                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            if (!alarmManager.canScheduleExactAlarms()) {
                                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, al.triggerTime, pi);
                                continue;
                            }
                        }
                        alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, al.triggerTime, pi);
                        Log.d(TAG, "Rescheduled alarm " + al.id + " for: " + al.triggerTime);
                    } catch (Exception e) {
                        Log.e(TAG, "Failed to reschedule alarm " + al.id, e);
                    }
                }
            }
        }
    }
}
