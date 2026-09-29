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
import androidx.core.app.NotificationCompat;

public class AlarmNotificationHelper {

    public static final String CHANNEL_ID = "voice_clock_alarm_channel_v3";
    public static final int NOTIFICATION_ID = 1001;

    public static Notification createNotification(Context context, Intent alarmIntent) {

        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);

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
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

            Uri defaultSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .build();
            channel.setSound(defaultSoundUri, audioAttributes);

            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }

        String label = alarmIntent.getStringExtra("label");
        if (label == null || label.trim().isEmpty()) label = "Alarm";
        String text = alarmIntent.getStringExtra("text");
        if (text == null || text.trim().isEmpty()) text = "Alarm is ringing";
        String alarmId = alarmIntent.getStringExtra("alarmId");

        // Intent to open full AlarmActivity
        Intent openIntent = new Intent(context, AlarmActivity.class);
        if (alarmIntent.getExtras() != null) {
            openIntent.putExtras(alarmIntent.getExtras());
        }
        openIntent.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP
                        | Intent.FLAG_ACTIVITY_CLEAR_TOP
                        | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
        );

        PendingIntent fullScreenPendingIntent =
                PendingIntent.getActivity(
                        context,
                        1001,
                        openIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );

        // Action: Dismiss
        Intent dismissIntent = new Intent(context, AlarmService.class);
        dismissIntent.setAction("STOP_ALARM");
        if (alarmId != null) {
            dismissIntent.putExtra("alarmId", alarmId);
        }
        PendingIntent dismissPendingIntent = PendingIntent.getService(
                context,
                1002,
                dismissIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Action: Snooze (schedules 10 mins later)
        Intent snoozeIntent = new Intent(context, AlarmReceiver.class);
        if (alarmIntent.getExtras() != null) {
            snoozeIntent.putExtras(alarmIntent.getExtras());
        }
        snoozeIntent.putExtra("snoozeTrigger", System.currentTimeMillis() + 10 * 60 * 1000L);
        PendingIntent snoozePendingIntent = PendingIntent.getBroadcast(
                context,
                1003,
                snoozeIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        boolean isHi = "hi".equalsIgnoreCase(AlarmPreferences.getAppLanguage(context));
        String dismissTitle = isHi ? "बंद करें" : "Dismiss";
        String snoozeTitle = isHi ? "10 मिनट स्नूज़" : "Snooze 10m";

        return new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(label)
                .setContentText(text)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(fullScreenPendingIntent)
                .setFullScreenIntent(fullScreenPendingIntent, true)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, dismissTitle, dismissPendingIntent)
                .addAction(android.R.drawable.ic_popup_reminder, snoozeTitle, snoozePendingIntent)
                .build();
    }
}