package com.voiceclock.vc;

import android.app.AlarmManager;
import android.app.KeyguardManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class AlarmActivity extends AppCompatActivity {

    private String alarmId;
    private String label;
    private String type;
    private String text;
    private String voice;
    private Handler timeHandler;
    private Runnable timeRunnable;
    private TextView clockView;
    private Vibrator vibrator;
    private BroadcastReceiver screenOffReceiver;
    private BroadcastReceiver dismissReceiver;
    private boolean isScreenOffReceiverRegistered = false;
    private boolean isDismissReceiverRegistered = false;
    private PowerManager.WakeLock activityWakeLock;
    private long createTimestamp = 0;
    private long intervalMs = 0;
    private boolean hasGainedFocus = false;

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hasGainedFocus = true;
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        createTimestamp = System.currentTimeMillis();

        // 1. Forcefully wake up screen and show over keyguard/lockscreen
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }

        getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                        | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
        );

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            try {
                activityWakeLock = pm.newWakeLock(
                        PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                                | PowerManager.ACQUIRE_CAUSES_WAKEUP
                                | PowerManager.ON_AFTER_RELEASE,
                        "VoiceClock:AlarmActivityWake"
                );
                activityWakeLock.setReferenceCounted(false);
                activityWakeLock.acquire(120000); // Keep screen actively awake for 2 mins while ringing
            } catch (Exception ignored) {}
        }

        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_alarm);

        alarmId = getIntent().getStringExtra("alarmId");
        if (alarmId != null && !AlarmPreferences.isAlarmActive(this, alarmId)) {
            Log.w("VOICE_CLOCK", "AlarmActivity: Alarm " + alarmId + " is not active or has been deleted. Dismissing immediately!");
            AlarmPreferences.cancelAllAlarmIntents(this, alarmId);
            finishAlarmActivitySilently();
            return;
        }

        label = getIntent().getStringExtra("label");
        type = getIntent().getStringExtra("type");
        text = getIntent().getStringExtra("text");
        voice = getIntent().getStringExtra("voice");
        intervalMs = getIntent().getLongExtra("intervalMs", 0);
        if (intervalMs <= 0 && alarmId != null) {
            AlarmPreferences.SavedAlarm sa = AlarmPreferences.getAlarm(this, alarmId);
            if (sa != null && sa.intervalMs > 0) {
                intervalMs = sa.intervalMs;
            }
        }

        // 2. Ensure AlarmService is running to play voice TTS / audio loop and maintain foreground notification
        try {
            Intent serviceIntent = new Intent(this, AlarmService.class);
            serviceIntent.setAction("START_ALARM");
            if (getIntent().getExtras() != null) {
                serviceIntent.putExtras(getIntent().getExtras());
            }
            ContextCompat.startForegroundService(this, serviceIntent);
        } catch (Exception e) {
            e.printStackTrace();
        }

        // 3. Start repeating vibration if enabled in user settings
        if (AlarmPreferences.isTimerVibrate(this)) {
            try {
                vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (vibrator != null) {
                    long[] pattern = { 0, 800, 800 };
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        vibrator.vibrate(VibrationEffect.createWaveform(pattern, 1));
                    } else {
                        vibrator.vibrate(pattern, 1);
                    }
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        // 4. Intercept physical power button (screen off) while ringing
        screenOffReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent != null && Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) {
                    if (System.currentTimeMillis() - createTimestamp < 5000 || !hasGainedFocus) {
                        return; // Ignore screen-off broadcast during initial wake transition
                    }
                    String powerAction = AlarmPreferences.getPowerButtonAction(AlarmActivity.this);
                    if ("Dismiss".equalsIgnoreCase(powerAction)) {
                        performDismiss();
                    } else if ("Remind me later".equalsIgnoreCase(powerAction) || "Snooze".equalsIgnoreCase(powerAction)) {
                        performSnooze();
                    }
                }
            }
        };

        // Fast receiver registration so power button reacts promptly without false triggers
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            try {
                if (!isFinishing() && !isDestroyed()) {
                    registerReceiver(screenOffReceiver, new IntentFilter(Intent.ACTION_SCREEN_OFF));
                    isScreenOffReceiverRegistered = true;
                }
            } catch (Exception ignored) {}
        }, 800);

        // 5. Listen for external dismiss broadcast (e.g. from notification actions)
        dismissReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent != null && "com.voiceclock.vc.ACTION_DISMISS_ALARM_ACTIVITY".equals(intent.getAction())) {
                    finishAlarmActivitySilently();
                }
            }
        };
        IntentFilter dismissFilter = new IntentFilter("com.voiceclock.vc.ACTION_DISMISS_ALARM_ACTIVITY");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(dismissReceiver, dismissFilter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(dismissReceiver, dismissFilter);
        }
        isDismissReceiverRegistered = true;

        clockView = findViewById(R.id.alarmClock);
        View btnSnooze = findViewById(R.id.btnSnooze);
        View btnCenter = findViewById(R.id.btnCenterAlarm);
        View btnDismiss = findViewById(R.id.btnDismiss);

        updateSwipeHintText();

        updateAlarmData(getIntent());

        // Update time display HH:mm
        updateTimeDisplay();
        timeHandler = new Handler(Looper.getMainLooper());
        timeRunnable = new Runnable() {
            @Override
            public void run() {
                updateTimeDisplay();
                timeHandler.postDelayed(this, 1000);
            }
        };
        timeHandler.postDelayed(timeRunnable, 1000);

        // Click and Drag/Swipe gesture listeners
        btnSnooze.setOnClickListener(v -> performSnooze());
        btnDismiss.setOnClickListener(v -> performDismiss());

        btnCenter.setOnTouchListener(new View.OnTouchListener() {
            private float startX = 0f;
            private float currentX = 0f;
            private boolean isDragging = false;
            private final float thresholdDp = 55f;
            private final float maxDragDp = 95f;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                float density = getResources().getDisplayMetrics().density;
                float threshold = thresholdDp * density;
                float maxDrag = maxDragDp * density;

                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        startX = event.getRawX();
                        currentX = startX;
                        isDragging = true;
                        v.animate().cancel();
                        return true;

                    case MotionEvent.ACTION_MOVE:
                        if (!isDragging) return false;
                        currentX = event.getRawX();
                        float deltaX = currentX - startX;
                        if (deltaX < -maxDrag) deltaX = -maxDrag;
                        if (deltaX > maxDrag) deltaX = maxDrag;

                        v.setTranslationX(deltaX);

                        if (deltaX < 0) {
                            float progress = Math.min(1f, Math.abs(deltaX) / threshold);
                            btnSnooze.setScaleX(1f + progress * 0.3f);
                            btnSnooze.setScaleY(1f + progress * 0.3f);
                            btnDismiss.setScaleX(Math.max(0.7f, 1f - progress * 0.3f));
                            btnDismiss.setAlpha(Math.max(0.2f, 1f - progress * 0.8f));
                        } else if (deltaX > 0) {
                            float progress = Math.min(1f, deltaX / threshold);
                            btnDismiss.setScaleX(1f + progress * 0.3f);
                            btnDismiss.setScaleY(1f + progress * 0.3f);
                            btnSnooze.setScaleX(Math.max(0.7f, 1f - progress * 0.3f));
                            btnSnooze.setAlpha(Math.max(0.2f, 1f - progress * 0.8f));
                        } else {
                            btnSnooze.setScaleX(1f);
                            btnSnooze.setScaleY(1f);
                            btnSnooze.setAlpha(1f);
                            btnDismiss.setScaleX(1f);
                            btnDismiss.setScaleY(1f);
                            btnDismiss.setAlpha(1f);
                        }
                        return true;

                    case MotionEvent.ACTION_UP:
                    case MotionEvent.ACTION_CANCEL:
                        if (!isDragging) return false;
                        isDragging = false;
                        float finalDelta = currentX - startX;

                        if (finalDelta <= -threshold) {
                            performSnooze();
                        } else if (finalDelta >= threshold) {
                            performDismiss();
                        } else {
                            v.animate().translationX(0f).setDuration(220).start();
                            btnSnooze.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(220).start();
                            btnDismiss.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(220).start();
                        }
                        return true;
                }
                return false;
            }
        });
    }

    @Override
    public void onAttachedToWindow() {
        super.onAttachedToWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                        | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
        );
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                        | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
        );
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String newId = intent != null ? intent.getStringExtra("alarmId") : null;
        if (newId != null && !AlarmPreferences.isAlarmActive(this, newId)) {
            Log.w("VOICE_CLOCK", "AlarmActivity onNewIntent: Alarm " + newId + " is deleted or inactive. Finishing!");
            AlarmPreferences.cancelAllAlarmIntents(this, newId);
            finishAlarmActivitySilently();
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                        | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
        );
        updateAlarmData(intent);
    }

    private void updateAlarmData(Intent intent) {
        if (intent == null) return;
        alarmId = intent.getStringExtra("alarmId");
        label = intent.getStringExtra("label");
        type = intent.getStringExtra("type");
        text = intent.getStringExtra("text");
        voice = intent.getStringExtra("voice");

        long extraInterval = intent.getLongExtra("intervalMs", 0);
        if (extraInterval > 0) {
            intervalMs = extraInterval;
        } else if (intervalMs <= 0 && alarmId != null) {
            AlarmPreferences.SavedAlarm sa = AlarmPreferences.getAlarm(this, alarmId);
            if (sa != null && sa.intervalMs > 0) {
                intervalMs = sa.intervalMs;
            }
        }
        updateSwipeHintText();

        TextView titleView = findViewById(R.id.alarmTitle);
        TextView messageView = findViewById(R.id.alarmMessage);
        boolean isHi = "hi".equalsIgnoreCase(AlarmPreferences.getAppLanguage(this));

        if (titleView != null) {
            if (label != null && !label.trim().isEmpty() && !label.equalsIgnoreCase("Alarm") && !label.equalsIgnoreCase("अलार्म") && !label.equalsIgnoreCase("Task") && !label.equalsIgnoreCase("कार्य")) {
                titleView.setText(label);
            } else if ("task".equalsIgnoreCase(type)) {
                titleView.setText(isHi ? "कार्य" : "Task");
            } else {
                titleView.setText(isHi ? "अलार्म" : "Alarm");
            }
        }

        if (messageView != null) {
            if (text != null && !text.trim().isEmpty() && !text.equalsIgnoreCase(label)) {
                messageView.setText(text);
                messageView.setVisibility(View.VISIBLE);
            } else {
                messageView.setVisibility(View.GONE);
            }
        }
    }

    private void updateSwipeHintText() {
        TextView swipeHint = findViewById(R.id.swipeHintText);
        if (swipeHint != null) {
            boolean isHi = "hi".equalsIgnoreCase(AlarmPreferences.getAppLanguage(this));
            int snoozeMinutes = 10;
            if (intervalMs > 0) {
                snoozeMinutes = (int) Math.max(1, Math.round((double) intervalMs / 60000.0));
            } else {
                int defMins = AlarmPreferences.getSnoozeDuration(this);
                if (defMins > 0) snoozeMinutes = defMins;
            }
            if (isHi) {
                swipeHint.setText("◂ स्नूज़ (" + snoozeMinutes + " मिनट)      बंद करने के लिए स्लाइड करें ▸");
            } else {
                swipeHint.setText("◂ Slide left to Snooze (" + snoozeMinutes + "m)      Slide right to Dismiss ▸");
            }
        }
    }

    private void updateTimeDisplay() {
        if (clockView != null) {
            SimpleDateFormat sdf = new SimpleDateFormat("hh:mm", Locale.getDefault());
            clockView.setText(sdf.format(new Date()));
        }
    }

    private void finishAlarmActivitySilently() {
        if (vibrator != null) {
            try { vibrator.cancel(); } catch (Exception ignored) {}
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            finishAndRemoveTask();
        } else {
            finish();
        }
    }

    private void performDismiss() {
        if (vibrator != null) {
            try { vibrator.cancel(); } catch (Exception ignored) {}
        }

        if (alarmId != null) {
            AlarmPreferences.recordPendingAction(this, alarmId, "dismiss");
            AlarmPreferences.permanentlyDeleteAlarm(this, alarmId);
            AlarmPreferences.cancelAllAlarmIntents(this, alarmId);
        }

        // Instantly stop ringing service and cut off audio
        try {
            Intent stopIntent = new Intent(this, AlarmService.class);
            stopIntent.setAction("STOP_ALARM");
            if (alarmId != null) stopIntent.putExtra("alarmId", alarmId);
            startService(stopIntent);
            stopService(stopIntent);
        } catch (Exception ignored) {}

        // Inform MainActivity via broadcast so in-app state updates
        try {
            Intent bIntent = new Intent("com.voiceclock.vc.ACTION_ALARM_EVENT");
            bIntent.putExtra("action", "dismiss");
            bIntent.putExtra("alarmId", alarmId);
            bIntent.setPackage(getPackageName());
            sendBroadcast(bIntent);
        } catch (Exception ignored) {}

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            finishAndRemoveTask();
        } else {
            finish();
        }
    }

    private void performSnooze() {
        if (vibrator != null) {
            try { vibrator.cancel(); } catch (Exception ignored) {}
        }

        if (alarmId != null && !AlarmPreferences.isAlarmActive(this, alarmId)) {
            Log.w("VOICE_CLOCK", "AlarmActivity performSnooze: Alarm " + alarmId + " is deleted or inactive. Aborting.");
            AlarmPreferences.cancelAllAlarmIntents(this, alarmId);
            finishAlarmActivitySilently();
            return;
        }

        int snoozeMins = 10;
        if (intervalMs > 0) {
            snoozeMins = (int) Math.max(1, Math.round((double) intervalMs / 60000.0));
        } else {
            int defMins = AlarmPreferences.getSnoozeDuration(this);
            if (defMins > 0) snoozeMins = defMins;
        }
        long trigger = System.currentTimeMillis() + (snoozeMins * 60 * 1000L);

        if (alarmId != null) {
            AlarmPreferences.snoozeAlarm(this, alarmId, trigger);
            AlarmPreferences.recordPendingAction(this, alarmId, "snooze");
        }

        // Schedule next trigger directly targeting AlarmActivity so UI will guaranteed show again
        AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
        if (am != null) {
            int reqCode = (alarmId != null) ? alarmId.hashCode() : 1001;

            Intent showIntent = new Intent(this, AlarmActivity.class);
            showIntent.setAction("com.voiceclock.vc.ACTION_ALARM_SHOW_" + (alarmId != null ? alarmId : "snooze"));
            showIntent.putExtra("alarmId", alarmId);
            showIntent.putExtra("label", label);
            showIntent.putExtra("type", type);
            showIntent.putExtra("text", text);
            showIntent.putExtra("voice", voice);
            showIntent.putExtra("intervalMs", intervalMs);
            showIntent.putExtra("mode", "task".equals(type) ? "task" : "alarm");
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
                    this,
                    reqCode,
                    showIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE,
                    optionsBundle
            );

            Intent broadcastIntent = new Intent(this, AlarmReceiver.class);
            broadcastIntent.setAction("com.voiceclock.vc.ACTION_ALARM_TRIGGER_" + (alarmId != null ? alarmId : "snooze"));
            broadcastIntent.setPackage(getPackageName());
            if (getIntent().getExtras() != null) {
                broadcastIntent.putExtras(getIntent().getExtras());
            }
            broadcastIntent.putExtra("intervalMs", intervalMs);

            PendingIntent broadcastPi = PendingIntent.getBroadcast(
                    this,
                    reqCode,
                    broadcastIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    AlarmManager.AlarmClockInfo clockInfo = new AlarmManager.AlarmClockInfo(trigger, showPi);
                    am.setAlarmClock(clockInfo, broadcastPi);
                } else {
                    am.setExact(AlarmManager.RTC_WAKEUP, trigger, broadcastPi);
                }
            } catch (SecurityException se) {
                try {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, broadcastPi);
                } catch (Exception ex) {
                    am.set(AlarmManager.RTC_WAKEUP, trigger, broadcastPi);
                }
            }
        }

        // Instantly stop current ringing service audio
        try {
            Intent stopIntent = new Intent(this, AlarmService.class);
            stopIntent.setAction("STOP_ALARM");
            if (alarmId != null) stopIntent.putExtra("alarmId", alarmId);
            startService(stopIntent);
            stopService(stopIntent);
        } catch (Exception ignored) {}

        // Inform MainActivity via broadcast
        try {
            Intent bIntent = new Intent("com.voiceclock.vc.ACTION_ALARM_EVENT");
            bIntent.putExtra("action", "snooze");
            bIntent.putExtra("alarmId", alarmId);
            bIntent.putExtra("intervalMs", intervalMs);
            bIntent.putExtra("snoozeMins", snoozeMins);
            bIntent.setPackage(getPackageName());
            sendBroadcast(bIntent);
        } catch (Exception ignored) {}

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            finishAndRemoveTask();
        } else {
            finish();
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            int keyCode = event.getKeyCode();
            if (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
                String volAction = AlarmPreferences.getVolumeButtonAction(this);
                if ("Remind me later".equalsIgnoreCase(volAction) || "Snooze".equalsIgnoreCase(volAction)) {
                    performSnooze();
                    return true;
                } else if ("Dismiss".equalsIgnoreCase(volAction)) {
                    performDismiss();
                    return true;
                } else if ("Do nothing".equalsIgnoreCase(volAction)) {
                    return true;
                }
                // Else "Control volume" -> let system handle volume
            } else if (keyCode == KeyEvent.KEYCODE_BACK) {
                performSnooze();
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    protected void onDestroy() {
        if (activityWakeLock != null && activityWakeLock.isHeld()) {
            try { activityWakeLock.release(); } catch (Exception ignored) {}
        }
        if (vibrator != null) {
            try { vibrator.cancel(); } catch (Exception ignored) {}
        }
        if (isScreenOffReceiverRegistered && screenOffReceiver != null) {
            try { unregisterReceiver(screenOffReceiver); } catch (Exception ignored) {}
            isScreenOffReceiverRegistered = false;
        }
        if (isDismissReceiverRegistered && dismissReceiver != null) {
            try { unregisterReceiver(dismissReceiver); } catch (Exception ignored) {}
            isDismissReceiverRegistered = false;
        }
        if (timeHandler != null && timeRunnable != null) {
            timeHandler.removeCallbacks(timeRunnable);
        }
        super.onDestroy();
    }
}
