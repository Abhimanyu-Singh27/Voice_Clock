package com.voiceclock.vc;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationCompat;

public class AlarmNotificationHelper {

    public static final String CHANNEL_ID = "voice_clock_alarm_channel_v10";
    public static final int NOTIFICATION_ID = 1001;

    public static void createNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager =
                    (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) return;

            // Delete obsolete cached channels from previous builds so OS registers the new alerting channel
            for (int i = 1; i <= 9; i++) {
                try {
                    manager.deleteNotificationChannel("voice_clock_alarm_channel_v" + i);
                } catch (Exception ignored) {}
            }

            NotificationChannel channel =
                    new NotificationChannel(
                            CHANNEL_ID,
                            "Voice Clock Alarm",
                            NotificationManager.IMPORTANCE_HIGH
                    );
            channel.setDescription("Critical alarm notifications that show over lock screen");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{ 0, 600, 400, 600, 400 });
            channel.setBypassDnd(true);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

            // Use system alarm sound with USAGE_ALARM so Android & OEMs strictly recognize it as an Alerting Alarm Channel
            // This guarantees fullScreenIntent triggers over the lock screen even when screen is off
            try {
                Uri alarmSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
                if (alarmSoundUri == null) {
                    alarmSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                }
                if (alarmSoundUri == null) {
                    alarmSoundUri = Settings.System.DEFAULT_ALARM_ALERT_URI;
                }
                AudioAttributes audioAttributes = new AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .build();
                channel.setSound(alarmSoundUri, audioAttributes);
            } catch (Exception ignored) {}

            manager.createNotificationChannel(channel);
        }
    }

    public static Notification createNotification(Context context, Intent alarmIntent) {
        createNotificationChannel(context);

        String label = alarmIntent.getStringExtra("label");
        String type = alarmIntent.getStringExtra("type");
        boolean isHi = "hi".equalsIgnoreCase(AlarmPreferences.getAppLanguage(context));

        if (label == null || label.trim().isEmpty() || label.equalsIgnoreCase("Alarm") || label.equalsIgnoreCase("अलार्म") || label.equalsIgnoreCase("Task") || label.equalsIgnoreCase("कार्य")) {
            label = "task".equalsIgnoreCase(type) ? (isHi ? "कार्य" : "Task") : (isHi ? "अलार्म" : "Alarm");
        }
        String text = alarmIntent.getStringExtra("text");
        if (text == null || text.trim().isEmpty()) {
            text = "task".equalsIgnoreCase(type) ? (isHi ? "कार्य समय हो गया" : "Task reminder is active") : (isHi ? "अलार्म बज रहा है" : "Alarm is ringing");
        }
        String alarmId = alarmIntent.getStringExtra("alarmId");

        // Intent to open full AlarmActivity
        Intent openIntent = new Intent(context, AlarmActivity.class);
        openIntent.setAction("com.voiceclock.vc.ACTION_ALARM_RING_" + ((alarmId != null) ? alarmId : ""));
        openIntent.setPackage(context.getPackageName());
        if (alarmIntent.getExtras() != null) {
            openIntent.putExtras(alarmIntent.getExtras());
        }
        openIntent.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP
                        | Intent.FLAG_ACTIVITY_CLEAR_TOP
                        | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
        );

        android.os.Bundle optionsBundle = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            android.app.ActivityOptions options = android.app.ActivityOptions.makeBasic();
            options.setPendingIntentCreatorBackgroundActivityStartMode(android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
            options.setPendingIntentBackgroundActivityStartMode(android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
            optionsBundle = options.toBundle();
        }

        int reqCode = (alarmId != null) ? alarmId.hashCode() : 1001;

        PendingIntent fullScreenPendingIntent =
                PendingIntent.getActivity(
                        context,
                        reqCode + 50000,
                        openIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE,
                        optionsBundle
                );

        // Action: Dismiss
        Intent dismissIntent = new Intent(context, AlarmService.class);
        dismissIntent.setAction("STOP_ALARM");
        dismissIntent.setPackage(context.getPackageName());
        if (alarmId != null) {
            dismissIntent.putExtra("alarmId", alarmId);
        }
        PendingIntent dismissPendingIntent = PendingIntent.getService(
                context,
                reqCode + 2000,
                dismissIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Action: Snooze (schedules dynamically based on intervalMs, or default)
        long intervalMs = alarmIntent.getLongExtra("intervalMs", 0);
        if (intervalMs <= 0 && alarmId != null) {
            AlarmPreferences.SavedAlarm sa = AlarmPreferences.getAlarm(context, alarmId);
            if (sa != null && sa.intervalMs > 0) {
                intervalMs = sa.intervalMs;
            }
        }
        int snoozeMins = 10;
        if (intervalMs > 0) {
            snoozeMins = (int) Math.max(1, Math.round((double) intervalMs / 60000.0));
        } else {
            int defMins = AlarmPreferences.getSnoozeDuration(context);
            if (defMins > 0) snoozeMins = defMins;
        }

        Intent snoozeIntent = new Intent(context, AlarmReceiver.class);
        snoozeIntent.setAction("com.voiceclock.vc.ACTION_SNOOZE_" + ((alarmId != null) ? alarmId : ""));
        snoozeIntent.setPackage(context.getPackageName());
        if (alarmIntent.getExtras() != null) {
            snoozeIntent.putExtras(alarmIntent.getExtras());
        }
        snoozeIntent.putExtra("intervalMs", intervalMs);
        snoozeIntent.putExtra("snoozeTrigger", System.currentTimeMillis() + (snoozeMins * 60 * 1000L));
        PendingIntent snoozePendingIntent = PendingIntent.getBroadcast(
                context,
                reqCode + 3000,
                snoozeIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String dismissTitle = isHi ? "बंद करें" : "Dismiss";
        String snoozeTitle = isHi ? (snoozeMins + " मिनट स्नूज़") : ("Snooze " + snoozeMins + "m");

        Uri alarmSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (alarmSoundUri == null) {
            alarmSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        }
        if (alarmSoundUri == null) {
            alarmSoundUri = Settings.System.DEFAULT_ALARM_ALERT_URI;
        }

        return new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(label)
                .setContentText(text)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setSound(alarmSoundUri)
                .setVibrate(new long[]{ 0, 600, 400, 600, 400 })
                .setContentIntent(fullScreenPendingIntent)
                .setFullScreenIntent(fullScreenPendingIntent, true)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, dismissTitle, dismissPendingIntent)
                .addAction(android.R.drawable.ic_popup_reminder, snoozeTitle, snoozePendingIntent)
                .build();
    }
}
