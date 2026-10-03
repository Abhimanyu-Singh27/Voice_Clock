package com.voiceclock.vc;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

public class AlarmPreferences {

    private static final String PREF_NAME = "VoiceClockPrefs";
    private static final String KEY_ALARMS = "saved_alarms";
    private static final String KEY_DELETED_ALARMS = "deleted_alarm_ids";

    public static class SavedAlarm {
        public String id;
        public long triggerTime;
        public long snoozedUntil;
        public String label;
        public String type;
        public String text;
        public String voice;
        public long intervalMs;
    }

    public static synchronized void saveAlarm(Context context, String id, long triggerTime, String label, String type, String text) {
        saveAlarm(context, id, triggerTime, label, type, text, "female_1", 0L);
    }

    public static synchronized void saveAlarm(Context context, String id, long triggerTime, String label, String type, String text, String voice) {
        saveAlarm(context, id, triggerTime, label, type, text, voice, 0L);
    }

    public static synchronized void saveAlarm(Context context, String id, long triggerTime, String label, String type, String text, String voice, long intervalMs) {
        if (context == null || id == null || id.trim().isEmpty()) return;
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            String jsonStr = prefs.getString(KEY_ALARMS, "[]");
            JSONArray arr = new JSONArray(jsonStr);

            JSONArray newArr = new JSONArray();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject obj = arr.getJSONObject(i);
                if (!id.equals(obj.optString("id"))) {
                    newArr.put(obj);
                }
            }

            JSONObject newObj = new JSONObject();
            newObj.put("id", id);
            newObj.put("triggerTime", triggerTime);
            newObj.put("label", label);
            newObj.put("type", type);
            newObj.put("text", text);
            newObj.put("voice", (voice != null && !voice.trim().isEmpty()) ? voice : "female_1");
            newObj.put("intervalMs", intervalMs);
            newArr.put(newObj);

            // If this ID was previously marked as deleted, un-blacklist it now that user explicitly recreated it
            String deletedJson = prefs.getString(KEY_DELETED_ALARMS, "[]");
            JSONArray delArr = new JSONArray(deletedJson);
            JSONArray newDelArr = new JSONArray();
            for (int i = 0; i < delArr.length(); i++) {
                String dId = delArr.optString(i);
                if (!id.equals(dId)) {
                    newDelArr.put(dId);
                }
            }

            prefs.edit()
                    .putString(KEY_ALARMS, newArr.toString())
                    .putString(KEY_DELETED_ALARMS, newDelArr.toString())
                    .apply();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static synchronized void snoozeAlarm(Context context, String id, long newTriggerTime) {
        if (context == null || id == null) return;
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            String jsonStr = prefs.getString(KEY_ALARMS, "[]");
            JSONArray arr = new JSONArray(jsonStr);

            JSONArray newArr = new JSONArray();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject obj = arr.getJSONObject(i);
                if (id.equals(obj.optString("id"))) {
                    // Do NOT overwrite triggerTime! Preserve the original set time.
                    obj.put("snoozedUntil", newTriggerTime);
                }
                newArr.put(obj);
            }

            // Un-blacklist if present in deleted list so snooze trigger is guaranteed active
            String deletedJson = prefs.getString(KEY_DELETED_ALARMS, "[]");
            JSONArray delArr = new JSONArray(deletedJson);
            JSONArray newDelArr = new JSONArray();
            for (int i = 0; i < delArr.length(); i++) {
                String dId = delArr.optString(i);
                if (!id.equals(dId)) {
                    newDelArr.put(dId);
                }
            }

            prefs.edit()
                    .putString(KEY_ALARMS, newArr.toString())
                    .putString(KEY_DELETED_ALARMS, newDelArr.toString())
                    .apply();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static synchronized void updateAlarmTrigger(Context context, String id, long nextTriggerTime) {
        if (context == null || id == null) return;
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            String jsonStr = prefs.getString(KEY_ALARMS, "[]");
            JSONArray arr = new JSONArray(jsonStr);

            JSONArray newArr = new JSONArray();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject obj = arr.getJSONObject(i);
                if (id.equals(obj.optString("id"))) {
                    obj.put("triggerTime", nextTriggerTime);
                    obj.remove("snoozedUntil");
                }
                newArr.put(obj);
            }

            // Un-blacklist if present in deleted list
            String deletedJson = prefs.getString(KEY_DELETED_ALARMS, "[]");
            JSONArray delArr = new JSONArray(deletedJson);
            JSONArray newDelArr = new JSONArray();
            for (int i = 0; i < delArr.length(); i++) {
                String dId = delArr.optString(i);
                if (!id.equals(dId)) {
                    newDelArr.put(dId);
                }
            }

            prefs.edit()
                    .putString(KEY_ALARMS, newArr.toString())
                    .putString(KEY_DELETED_ALARMS, newDelArr.toString())
                    .apply();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static synchronized void permanentlyDeleteAlarm(Context context, String id) {
        if (context == null || id == null || id.trim().isEmpty()) return;
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);

            // 1. Remove from active saved alarms
            String jsonStr = prefs.getString(KEY_ALARMS, "[]");
            JSONArray arr = new JSONArray(jsonStr);
            JSONArray newArr = new JSONArray();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject obj = arr.getJSONObject(i);
                if (!id.equals(obj.optString("id"))) {
                    newArr.put(obj);
                }
            }

            // 2. Add to deleted blacklist (keep up to 300 entries to prevent infinite memory growth)
            String deletedJson = prefs.getString(KEY_DELETED_ALARMS, "[]");
            JSONArray delArr = new JSONArray(deletedJson);
            JSONArray newDelArr = new JSONArray();
            newDelArr.put(id);
            for (int i = 0; i < delArr.length() && newDelArr.length() < 300; i++) {
                String oldId = delArr.optString(i);
                if (!id.equals(oldId)) {
                    newDelArr.put(oldId);
                }
            }

            SharedPreferences.Editor editor = prefs.edit();
            editor.putString(KEY_ALARMS, newArr.toString());
            editor.putString(KEY_DELETED_ALARMS, newDelArr.toString());

            // 3. Clear pending action if it corresponds to this alarm
            String pendingActionStr = prefs.getString(KEY_PENDING_ACTION, null);
            if (pendingActionStr != null && pendingActionStr.contains(id)) {
                editor.remove(KEY_PENDING_ACTION);
            }

            editor.apply();
            Log.d("VOICE_CLOCK", "Permanently deleted and blacklisted alarm: " + id);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static synchronized void removeAlarm(Context context, String id) {
        permanentlyDeleteAlarm(context, id);
    }

    public static synchronized boolean isAlarmActive(Context context, String id) {
        if (context == null || id == null || id.trim().isEmpty()) return false;
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);

            // 1. Check if ID is in deleted blacklist
            String deletedJson = prefs.getString(KEY_DELETED_ALARMS, "[]");
            JSONArray delArr = new JSONArray(deletedJson);
            for (int i = 0; i < delArr.length(); i++) {
                if (id.equals(delArr.optString(i))) {
                    return false;
                }
            }

            // 2. Check if ID exists in saved_alarms
            String jsonStr = prefs.getString(KEY_ALARMS, "[]");
            JSONArray arr = new JSONArray(jsonStr);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject obj = arr.getJSONObject(i);
                if (id.equals(obj.optString("id"))) {
                    return true;
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return false;
    }

    public static void cancelAllAlarmIntents(Context context, String alarmId) {
        if (context == null || alarmId == null || alarmId.trim().isEmpty()) return;
        try {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            int reqCode = alarmId.hashCode();

            int[] codes = new int[]{ reqCode, reqCode + 3000, reqCode + 2000, reqCode + 50000, 1001 };
            String[] actions = new String[]{
                    "com.voiceclock.vc.ACTION_ALARM_SHOW_" + alarmId,
                    "com.voiceclock.vc.ACTION_ALARM_TRIGGER_" + alarmId,
                    "com.voiceclock.vc.ACTION_SNOOZE_" + alarmId,
                    "com.voiceclock.vc.ACTION_ALARM_RING_" + alarmId,
                    null
            };

            if (am != null) {
                // Cancel all Activity PendingIntents
                for (int code : codes) {
                    for (String act : actions) {
                        try {
                            Intent showIntent = new Intent(context, AlarmActivity.class);
                            if (act != null) showIntent.setAction(act);
                            PendingIntent pi = PendingIntent.getActivity(
                                    context,
                                    code,
                                    showIntent,
                                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                            );
                            am.cancel(pi);
                            pi.cancel();
                        } catch (Exception ignored) {}
                    }
                }

                // Cancel all Broadcast PendingIntents
                for (int code : codes) {
                    for (String act : actions) {
                        try {
                            Intent bIntent = new Intent(context, AlarmReceiver.class);
                            if (act != null) bIntent.setAction(act);
                            bIntent.setPackage(context.getPackageName());
                            PendingIntent pi = PendingIntent.getBroadcast(
                                    context,
                                    code,
                                    bIntent,
                                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                            );
                            am.cancel(pi);
                            pi.cancel();
                        } catch (Exception ignored) {}
                    }
                }

                // Cancel all Service PendingIntents
                for (int code : codes) {
                    try {
                        Intent sIntent = new Intent(context, AlarmService.class);
                        sIntent.setAction("START_ALARM");
                        PendingIntent pi = PendingIntent.getService(
                                context,
                                code,
                                sIntent,
                                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                        );
                        am.cancel(pi);
                        pi.cancel();
                    } catch (Exception ignored) {}
                }
            }

            // Cancel any system notifications for this alarm
            try {
                NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    nm.cancel(AlarmNotificationHelper.NOTIFICATION_ID);
                    nm.cancel(reqCode);
                    nm.cancel(reqCode + 50000);
                }
            } catch (Exception ignored) {}

            // Stop AlarmService if it is currently ringing for this alarm
            try {
                Intent stop = new Intent(context, AlarmService.class);
                stop.setAction("STOP_ALARM");
                stop.putExtra("alarmId", alarmId);
                context.startService(stop);
                context.stopService(stop);
            } catch (Exception ignored) {}

            // Broadcast to dismiss AlarmActivity if currently visible
            try {
                Intent dismissAct = new Intent("com.voiceclock.vc.ACTION_DISMISS_ALARM_ACTIVITY");
                dismissAct.putExtra("alarmId", alarmId);
                dismissAct.setPackage(context.getPackageName());
                context.sendBroadcast(dismissAct);
            } catch (Exception ignored) {}

            Log.d("VOICE_CLOCK", "Exhaustively canceled all AlarmManager intents and notifications for " + alarmId);
        } catch (Exception e) {
            Log.e("VOICE_CLOCK", "Error in cancelAllAlarmIntents for " + alarmId, e);
        }
    }

    public static void scheduleAlarmClock(
            Context context,
            String alarmId,
            long triggerAtMillis,
            String label,
            String type,
            String text,
            String voice,
            long intervalMs
    ) {
        if (context == null || alarmId == null || alarmId.trim().isEmpty()) return;
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;

        long physicalTrigger = triggerAtMillis;
        if (isManualTimeEnabled(context)) {
            physicalTrigger -= getManualTimeOffset(context);
        }

        final String selectedVoice = (voice != null && !voice.trim().isEmpty()) ? voice : "female_1";
        int reqCode = alarmId.hashCode();

        Intent showIntent = new Intent(context, AlarmActivity.class);
        showIntent.setAction("com.voiceclock.vc.ACTION_ALARM_SHOW_" + alarmId);
        showIntent.putExtra("alarmId", alarmId);
        showIntent.putExtra("label", label);
        showIntent.putExtra("type", type);
        showIntent.putExtra("text", text);
        showIntent.putExtra("voice", selectedVoice);
        showIntent.putExtra("mode", "task".equals(type) ? "task" : "alarm");
        showIntent.putExtra("intervalMs", intervalMs);
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
            options.setPendingIntentBackgroundActivityStartMode(android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
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
        broadcastIntent.setAction("com.voiceclock.vc.ACTION_ALARM_TRIGGER_" + alarmId);
        broadcastIntent.setPackage(context.getPackageName());
        broadcastIntent.putExtra("alarmId", alarmId);
        broadcastIntent.putExtra("label", label);
        broadcastIntent.putExtra("type", type);
        broadcastIntent.putExtra("text", text);
        broadcastIntent.putExtra("voice", selectedVoice);
        broadcastIntent.putExtra("mode", "task".equals(type) ? "task" : "alarm");
        broadcastIntent.putExtra("intervalMs", intervalMs);

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
        } catch (SecurityException se) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, physicalTrigger, broadcastPi);
                } else {
                    alarmManager.setExact(AlarmManager.RTC_WAKEUP, physicalTrigger, broadcastPi);
                }
            } catch (Exception e1) {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, physicalTrigger, broadcastPi);
                    } else {
                        alarmManager.set(AlarmManager.RTC_WAKEUP, physicalTrigger, broadcastPi);
                    }
                } catch (Exception e2) {
                    alarmManager.set(AlarmManager.RTC_WAKEUP, physicalTrigger, broadcastPi);
                }
            }
        }
    }

    public static synchronized String getAlarmsJson(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        return prefs.getString(KEY_ALARMS, "[]");
    }

    private static final String KEY_PENDING_ACTION = "pending_alarm_action";

    public static synchronized void recordPendingAction(Context context, String alarmId, String action) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            JSONObject obj = new JSONObject();
            obj.put("alarmId", alarmId);
            obj.put("action", action);
            obj.put("timestamp", System.currentTimeMillis());
            prefs.edit().putString(KEY_PENDING_ACTION, obj.toString()).apply();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static synchronized String consumePendingAction(Context context) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            String actionStr = prefs.getString(KEY_PENDING_ACTION, null);
            if (actionStr != null) {
                prefs.edit().remove(KEY_PENDING_ACTION).apply();
                return actionStr;
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return null;
    }

    public static synchronized List<SavedAlarm> getAlarms(Context context) {
        List<SavedAlarm> list = new ArrayList<>();
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            String jsonStr = prefs.getString(KEY_ALARMS, "[]");
            JSONArray arr = new JSONArray(jsonStr);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject obj = arr.getJSONObject(i);
                SavedAlarm a = new SavedAlarm();
                a.id = obj.optString("id");
                a.triggerTime = obj.optLong("triggerTime");
                a.snoozedUntil = obj.optLong("snoozedUntil", 0);
                a.label = obj.optString("label");
                a.type = obj.optString("type");
                a.text = obj.optString("text");
                a.voice = obj.optString("voice", "female_1");
                a.intervalMs = obj.optLong("intervalMs", 0);
                list.add(a);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return list;
    }

    public static synchronized SavedAlarm getAlarm(Context context, String id) {
        if (id == null) return null;
        List<SavedAlarm> alarms = getAlarms(context);
        for (SavedAlarm sa : alarms) {
            if (id.equals(sa.id)) return sa;
        }
        return null;
    }

    private static final String KEY_VOLUME_ACTION = "volume_button_action";
    private static final String KEY_POWER_ACTION = "power_button_action";
    private static final String KEY_TIMER_VIBRATE = "timer_vibrate";
    private static final String KEY_SNOOZE_DURATION = "snooze_duration";
    private static final String KEY_SILENCE_AFTER = "silence_after";
    private static final String KEY_ALARM_VOLUME = "alarm_volume";
    private static final String KEY_GRADUAL_VOLUME = "gradual_volume";
    private static final String KEY_TIMER_SOUND = "timer_sound";
    private static final String KEY_TIMEZONE_IANA = "timezone_iana";
    private static final String KEY_MANUAL_TIME_OFFSET = "manual_time_offset";
    private static final String KEY_MANUAL_TIME_ENABLED = "manual_time_enabled";

    public static synchronized void syncHardwareSettings(
            Context context,
            String volumeAction,
            String powerAction,
            boolean timerVibrate,
            int snoozeDuration
    ) {
        syncAllSettings(context, volumeAction, powerAction, timerVibrate, snoozeDuration, -1, -1, -1, null, null, 0, false);
    }

    public static synchronized void syncAllSettings(
            Context context,
            String volumeAction,
            String powerAction,
            boolean timerVibrate,
            int snoozeDuration,
            int silenceAfterSeconds,
            int alarmVolume,
            int gradualVolumeSeconds,
            String timerSound,
            String timezoneIana,
            long manualTimeOffset,
            boolean manualTimeEnabled
    ) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            SharedPreferences.Editor editor = prefs.edit();
            if (volumeAction != null) editor.putString(KEY_VOLUME_ACTION, volumeAction);
            if (powerAction != null) editor.putString(KEY_POWER_ACTION, powerAction);
            editor.putBoolean(KEY_TIMER_VIBRATE, timerVibrate);
            if (snoozeDuration > 0) editor.putInt(KEY_SNOOZE_DURATION, snoozeDuration);
            if (silenceAfterSeconds >= 0 || silenceAfterSeconds == -1) editor.putInt(KEY_SILENCE_AFTER, silenceAfterSeconds);
            if (alarmVolume >= 0) editor.putInt(KEY_ALARM_VOLUME, alarmVolume);
            if (gradualVolumeSeconds >= 0) editor.putInt(KEY_GRADUAL_VOLUME, gradualVolumeSeconds);
            if (timerSound != null) editor.putString(KEY_TIMER_SOUND, timerSound);
            if (timezoneIana != null) editor.putString(KEY_TIMEZONE_IANA, timezoneIana);
            editor.putLong(KEY_MANUAL_TIME_OFFSET, manualTimeOffset);
            editor.putBoolean(KEY_MANUAL_TIME_ENABLED, manualTimeEnabled);
            editor.apply();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static synchronized String getVolumeButtonAction(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        return prefs.getString(KEY_VOLUME_ACTION, "Remind me later");
    }

    public static synchronized String getPowerButtonAction(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        return prefs.getString(KEY_POWER_ACTION, "Dismiss");
    }

    public static synchronized boolean isTimerVibrate(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        return prefs.getBoolean(KEY_TIMER_VIBRATE, false);
    }

    public static synchronized int getSnoozeDuration(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        return prefs.getInt(KEY_SNOOZE_DURATION, 10);
    }

    public static synchronized int getSilenceAfter(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        return prefs.getInt(KEY_SILENCE_AFTER, 60); // default 1 minute (60s)
    }

    public static synchronized int getAlarmVolume(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        return prefs.getInt(KEY_ALARM_VOLUME, 80); // default 80%
    }

    public static synchronized int getGradualVolumeSeconds(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        return prefs.getInt(KEY_GRADUAL_VOLUME, 0); // default 0 (Off)
    }

    public static synchronized String getTimerSound(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        return prefs.getString(KEY_TIMER_SOUND, "Om Namo Bhagavate Vasudevaya _ Mahavatar Narsimha Ringtone Download - MobCup.Com.Co");
    }

    public static synchronized String getTimezoneIana(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        return prefs.getString(KEY_TIMEZONE_IANA, "Asia/Kolkata");
    }

    public static synchronized long getManualTimeOffset(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        return prefs.getLong(KEY_MANUAL_TIME_OFFSET, 0L);
    }

    public static synchronized boolean isManualTimeEnabled(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        return prefs.getBoolean(KEY_MANUAL_TIME_ENABLED, false);
    }

    public static synchronized String getAppLanguage(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        return prefs.getString("app_language", "en");
    }

    public static synchronized void setAppLanguage(Context context, String lang) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            prefs.edit().putString("app_language", lang != null ? lang : "en").apply();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static synchronized boolean isBatteryOptimizationAllowed(Context context) {
        if (context == null) return false;
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        return prefs.getBoolean("battery_optimization_allowed", false);
    }

    public static synchronized void setBatteryOptimizationAllowed(Context context, boolean allowed) {
        if (context == null) return;
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            prefs.edit().putBoolean("battery_optimization_allowed", allowed).apply();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static synchronized void saveBrevoConfig(Context context, String apiKey, String senderEmail, String senderName) {
        if (context == null) return;
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            prefs.edit()
                    .putString("brevo_api_key", apiKey != null ? apiKey.trim() : "")
                    .putString("brevo_sender_email", senderEmail != null ? senderEmail.trim() : "")
                    .putString("brevo_sender_name", senderName != null ? senderName.trim() : "")
                    .apply();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static synchronized String getBrevoApiKey(Context context) {
        if (context == null) return "";
        return context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE).getString("brevo_api_key", "");
    }

    public static synchronized String getBrevoSenderEmail(Context context) {
        if (context == null) return "myadminss.businessss@gmail.com";
        return context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE).getString("brevo_sender_email", "myadminss.businessss@gmail.com");
    }

    public static synchronized String getBrevoSenderName(Context context) {
        if (context == null) return "SevasSetus";
        return context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE).getString("brevo_sender_name", "SevasSetus");
    }

    public static synchronized void saveVcAccount(Context context, String accountJson) {
        if (context == null) return;
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            if (accountJson != null && !accountJson.trim().isEmpty()) {
                prefs.edit().putString("vc_account_json", accountJson.trim()).apply();
            } else {
                prefs.edit().remove("vc_account_json").apply();
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static synchronized String getVcAccount(Context context) {
        if (context == null) return "";
        try {
            return context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE).getString("vc_account_json", "");
        } catch (Exception e) {
            return "";
        }
    }
}
