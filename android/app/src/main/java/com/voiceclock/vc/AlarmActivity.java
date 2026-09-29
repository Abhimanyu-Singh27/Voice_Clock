package com.voiceclock.vc;

import android.app.Activity;
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
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class AlarmActivity extends Activity {

    private String alarmId;
    private String label;
    private String type;
    private String text;
    private Handler timeHandler;
    private Runnable timeRunnable;
    private TextView clockView;
    private Vibrator vibrator;
    private BroadcastReceiver screenOffReceiver;
    private PowerManager.WakeLock activityWakeLock;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            try {
                activityWakeLock = pm.newWakeLock(
                        PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE,
                        "VoiceClock:AlarmActivityWake"
                );
                activityWakeLock.acquire(45000);
            } catch (Exception ignored) {}
        }

        // Essential lock screen & wake screen settings
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
            if (km != null) {
                km.requestDismissKeyguard(this, null);
            }
        }

        getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                        | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                        | WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
        );

        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_alarm);

        alarmId = getIntent().getStringExtra("alarmId");
        label = getIntent().getStringExtra("label");
        type = getIntent().getStringExtra("type");
        text = getIntent().getStringExtra("text");

        // Start repeating vibration if enabled in user settings
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

        // Intercept physical power button (screen off) while ringing
        screenOffReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent != null && Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) {
                    String powerAction = AlarmPreferences.getPowerButtonAction(AlarmActivity.this);
                    if ("Dismiss".equalsIgnoreCase(powerAction)) {
                        performDismiss();
                    }
                }
            }
        };

        // Delay receiver registration by 2.5 seconds so initial wake-up doesn't trigger accidental dismiss
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            try {
                if (!isFinishing() && !isDestroyed()) {
                    registerReceiver(screenOffReceiver, new IntentFilter(Intent.ACTION_SCREEN_OFF));
                }
            } catch (Exception ignored) {}
        }, 2500);

        clockView = findViewById(R.id.alarmClock);
        TextView titleView = findViewById(R.id.alarmTitle);
        TextView messageView = findViewById(R.id.alarmMessage);

        View btnSnooze = findViewById(R.id.btnSnooze);
        View btnCenter = findViewById(R.id.btnCenterAlarm);
        View btnDismiss = findViewById(R.id.btnDismiss);

        boolean isHi = "hi".equalsIgnoreCase(AlarmPreferences.getAppLanguage(this));

        TextView swipeHint = findViewById(R.id.swipeHintText);
        if (swipeHint != null) {
            swipeHint.setText(isHi ? "◂ स्नूज़ के लिए स्लाइड करें      बंद करने के लिए स्लाइड करें ▸" : "◂ Slide left to Snooze      Slide right to Dismiss ▸");
        }

        // Title format
        if (label != null && !label.trim().isEmpty() && !label.equalsIgnoreCase("Alarm") && !label.equalsIgnoreCase("अलार्म") && !label.equalsIgnoreCase("Task") && !label.equalsIgnoreCase("कार्य")) {
            titleView.setText(label);
        } else if ("task".equalsIgnoreCase(type)) {
            titleView.setText(isHi ? "कार्य" : "Task");
        } else {
            titleView.setText(isHi ? "अलार्म" : "Alarm");
        }

        // Subtitle message if present and different from label
        if (text != null && !text.trim().isEmpty() && !text.equalsIgnoreCase(label)) {
            messageView.setText(text);
            messageView.setVisibility(View.VISIBLE);
        } else {
            messageView.setVisibility(View.GONE);
        }

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

    private void updateTimeDisplay() {
        if (clockView != null) {
            SimpleDateFormat sdf = new SimpleDateFormat("hh:mm", Locale.getDefault());
            clockView.setText(sdf.format(new Date()));
        }
    }

    private void performDismiss() {
        if (vibrator != null) {
            try { vibrator.cancel(); } catch (Exception ignored) {}
        }

        if (alarmId != null) {
            AlarmPreferences.recordPendingAction(this, alarmId, "dismiss");
        }

        // Stop ringing service
        Intent stopIntent = new Intent(this, AlarmService.class);
        stopIntent.setAction("STOP_ALARM");
        startService(stopIntent);

        // Inform MainActivity
        Intent i = new Intent(this, MainActivity.class);
        i.putExtra("alarmAction", "dismiss");
        i.putExtra("alarmId", alarmId);
        i.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try {
            startActivity(i);
        } catch (Exception ignored) {}

        finish();
    }

    private void performSnooze() {
        if (vibrator != null) {
            try { vibrator.cancel(); } catch (Exception ignored) {}
        }

        int snoozeMins = AlarmPreferences.getSnoozeDuration(this);
        if (snoozeMins <= 0) snoozeMins = 10;
        long trigger = System.currentTimeMillis() + (snoozeMins * 60 * 1000L);

        if (alarmId != null) {
            AlarmPreferences.snoozeAlarm(this, alarmId, trigger);
            AlarmPreferences.recordPendingAction(this, alarmId, "snooze");
        }

        Intent i = new Intent(this, AlarmReceiver.class);
        i.putExtra("alarmId", alarmId);
        i.putExtra("label", label);
        i.putExtra("type", type);
        i.putExtra("text", text);

        AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
        if (am != null) {
            int reqCode = (alarmId != null) ? alarmId.hashCode() : 1001;
            PendingIntent pi = PendingIntent.getBroadcast(
                    this,
                    reqCode,
                    i,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    Intent showIntent = new Intent(this, AlarmActivity.class);
                    showIntent.putExtra("alarmId", alarmId);
                    showIntent.putExtra("label", label);
                    showIntent.putExtra("type", type);
                    showIntent.putExtra("text", text);
                    showIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    PendingIntent showPi = PendingIntent.getActivity(
                            this,
                            reqCode + 100000,
                            showIntent,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    );
                    AlarmManager.AlarmClockInfo clockInfo = new AlarmManager.AlarmClockInfo(trigger, showPi);
                    am.setAlarmClock(clockInfo, pi);
                } else {
                    am.setExact(AlarmManager.RTC_WAKEUP, trigger, pi);
                }
            } catch (SecurityException e) {
                e.printStackTrace();
            }
        }

        // Stop current alarm service
        Intent stopIntent = new Intent(this, AlarmService.class);
        stopIntent.setAction("STOP_ALARM");
        startService(stopIntent);

        // Tell MainActivity
        Intent open = new Intent(this, MainActivity.class);
        open.putExtra("alarmAction", "snooze");
        open.putExtra("alarmId", alarmId);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try {
            startActivity(open);
        } catch (Exception ignored) {}

        finish();
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
        if (screenOffReceiver != null) {
            try { unregisterReceiver(screenOffReceiver); } catch (Exception ignored) {}
        }
        if (timeHandler != null && timeRunnable != null) {
            timeHandler.removeCallbacks(timeRunnable);
        }
        super.onDestroy();
    }
}