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
            boolean manualEnabled = AlarmPreferences.isManualTimeEnabled(context);
            long manualOffset = AlarmPreferences.getManualTimeOffset(context);

            for (AlarmPreferences.SavedAlarm al : alarms) {
                if (al == null || al.id == null || !AlarmPreferences.isAlarmActive(context, al.id)) {
                    continue;
                }
                long physicalTrigger = manualEnabled ? (al.triggerTime - manualOffset) : al.triggerTime;
                if (physicalTrigger > now) {
                    int reqCode = al.id.hashCode();

                    Intent showIntent = new Intent(context, AlarmActivity.class);
                    showIntent.setAction("com.voiceclock.vc.ACTION_ALARM_SHOW_" + al.id);
                    showIntent.putExtra("alarmId", al.id);
                    showIntent.putExtra("label", al.label);
                    showIntent.putExtra("type", al.type);
                    showIntent.putExtra("text", al.text);
                    showIntent.putExtra("voice", al.voice != null ? al.voice : "female_1");
                    showIntent.putExtra("mode", "task".equals(al.type) ? "task" : "alarm");
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
                            reqCode,
                            showIntent,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE,
                            optionsBundle
                    );

                    Intent broadcastIntent = new Intent(context, AlarmReceiver.class);
                    broadcastIntent.setAction("com.voiceclock.vc.ACTION_ALARM_TRIGGER_" + al.id);
                    broadcastIntent.setPackage(context.getPackageName());
                    broadcastIntent.putExtra("alarmId", al.id);
                    broadcastIntent.putExtra("label", al.label);
                    broadcastIntent.putExtra("type", al.type);
                    broadcastIntent.putExtra("text", al.text);
                    broadcastIntent.putExtra("voice", al.voice != null ? al.voice : "female_1");
                    broadcastIntent.putExtra("mode", "task".equals(al.type) ? "task" : "alarm");

                    PendingIntent broadcastPi = PendingIntent.getBroadcast(
                            context,
                            reqCode,
                            broadcastIntent,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    );

                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            AlarmManager.AlarmClockInfo clockInfo = new AlarmManager.AlarmClockInfo(physicalTrigger, showPi);
                            alarmManager.setAlarmClock(clockInfo, broadcastPi);
                        } else {
                            alarmManager.setExact(AlarmManager.RTC_WAKEUP, physicalTrigger, broadcastPi);
                        }
                        Log.d(TAG, "Rescheduled alarm " + al.id + " for: " + physicalTrigger);
                    } catch (Exception e) {
                        try {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, physicalTrigger, broadcastPi);
                            } else {
                                alarmManager.set(AlarmManager.RTC_WAKEUP, physicalTrigger, broadcastPi);
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
