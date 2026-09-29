package com.voiceclock.vc;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

public class AlarmPreferences {

    private static final String PREF_NAME = "VoiceClockPrefs";
    private static final String KEY_ALARMS = "saved_alarms";

    public static class SavedAlarm {
        public String id;
        public long triggerTime;
        public String label;
        public String type;
        public String text;
    }

    public static synchronized void saveAlarm(Context context, String id, long triggerTime, String label, String type, String text) {
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
            newArr.put(newObj);

            prefs.edit().putString(KEY_ALARMS, newArr.toString()).apply();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static synchronized void snoozeAlarm(Context context, String id, long newTriggerTime) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            String jsonStr = prefs.getString(KEY_ALARMS, "[]");
            JSONArray arr = new JSONArray(jsonStr);

            JSONArray newArr = new JSONArray();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject obj = arr.getJSONObject(i);
                if (id.equals(obj.optString("id"))) {
                    obj.put("triggerTime", newTriggerTime);
                }
                newArr.put(obj);
            }

            prefs.edit().putString(KEY_ALARMS, newArr.toString()).apply();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static synchronized void removeAlarm(Context context, String id) {
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
            prefs.edit().putString(KEY_ALARMS, newArr.toString()).apply();
        } catch (Exception e) {
            e.printStackTrace();
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
                a.label = obj.optString("label");
                a.type = obj.optString("type");
                a.text = obj.optString("text");
                list.add(a);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return list;
    }

    private static final String KEY_VOLUME_ACTION = "volume_button_action";
    private static final String KEY_POWER_ACTION = "power_button_action";
    private static final String KEY_TIMER_VIBRATE = "timer_vibrate";
    private static final String KEY_SNOOZE_DURATION = "snooze_duration";

    public static synchronized void syncHardwareSettings(
            Context context,
            String volumeAction,
            String powerAction,
            boolean timerVibrate,
            int snoozeDuration
    ) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            SharedPreferences.Editor editor = prefs.edit();
            if (volumeAction != null) editor.putString(KEY_VOLUME_ACTION, volumeAction);
            if (powerAction != null) editor.putString(KEY_POWER_ACTION, powerAction);
            editor.putBoolean(KEY_TIMER_VIBRATE, timerVibrate);
            if (snoozeDuration > 0) editor.putInt(KEY_SNOOZE_DURATION, snoozeDuration);
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
}
