package com.voiceclock.vc;

import android.app.AlarmManager;
import android.app.KeyguardManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.location.Location;
import android.location.LocationManager;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.Locale;
import java.util.Set;

public class MainActivity extends BridgeActivity {

    private WebView webView;
    private BroadcastReceiver voiceReceiver;
    private BroadcastReceiver screenOffReceiver;
    private BroadcastReceiver reminderReceiver;
    private BroadcastReceiver alarmTriggerReceiver;
    private Vibrator vibrator;
    private boolean isAlarmRinging = false;
    private SpeechRecognizer activeSpeechRecognizer;
    private String pendingVoiceLang = "hi-IN";
    private TextToSpeech mainTts;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                        | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        );

        webView = bridge.getWebView();

        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, android.webkit.GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }
        });

        setupBridge();

        // Register receiver for background voice commands from VoiceAssistantService
        voiceReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent != null && "com.voiceclock.vc.VOICE_COMMAND".equals(intent.getAction())) {
                    String cmd = intent.getStringExtra("command");
                    wakeScreenAndShowAssistant(cmd);
                }
            }
        };

        IntentFilter filter = new IntentFilter("com.voiceclock.vc.VOICE_COMMAND");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(voiceReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(voiceReceiver, filter);
        }

        // Register receiver for real-time notification bar actions (Accept / Reject)
        reminderReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null) return;
                String action = intent.getAction();
                String reminderId = intent.getStringExtra("reminderId");
                int notifId = intent.getIntExtra("notifId", 0);

                if (notifId != 0) {
                    try {
                        android.app.NotificationManager nm = (android.app.NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                        if (nm != null) nm.cancel(notifId);
                    } catch (Exception ignored) {}
                }

                if ("com.voiceclock.vc.ACTION_REMINDER_ACCEPT".equals(action)) {
                    if (webView != null) {
                        String clean = (reminderId != null) ? reminderId.replace("'", "\\'") : "";
                        webView.post(() -> webView.evaluateJavascript("window.handleRemoteReminderAction && window.handleRemoteReminderAction('" + clean + "', 'accept')", null));
                    }
                } else if ("com.voiceclock.vc.ACTION_REMINDER_REJECT".equals(action)) {
                    if (webView != null) {
                        String clean = (reminderId != null) ? reminderId.replace("'", "\\'") : "";
                        webView.post(() -> webView.evaluateJavascript("window.handleRemoteReminderAction && window.handleRemoteReminderAction('" + clean + "', 'reject')", null));
                    }
                }
            }
        };
        IntentFilter remFilter = new IntentFilter();
        remFilter.addAction("com.voiceclock.vc.ACTION_REMINDER_ACCEPT");
        remFilter.addAction("com.voiceclock.vc.ACTION_REMINDER_REJECT");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(reminderReceiver, remFilter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(reminderReceiver, remFilter);
        }

        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);

        screenOffReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent != null && Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) {
                    if (isAlarmRinging) {
                        String powerAction = AlarmPreferences.getPowerButtonAction(MainActivity.this);
                        if ("Dismiss".equalsIgnoreCase(powerAction)) {
                            if (webView != null) {
                                webView.post(() -> webView.evaluateJavascript("window.handleHardwarePowerDismiss && window.handleHardwarePowerDismiss()", null));
                            }
                        }
                    }
                }
            }
        };
        registerReceiver(screenOffReceiver, new IntentFilter(Intent.ACTION_SCREEN_OFF));

        alarmTriggerReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent != null && "com.voiceclock.vc.ALARM_TRIGGER".equals(intent.getAction())) {
                    wakeScreenAndShowAlarm(intent);
                }
            }
        };
        IntentFilter alarmFilter = new IntentFilter("com.voiceclock.vc.ALARM_TRIGGER");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(alarmTriggerReceiver, alarmFilter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(alarmTriggerReceiver, alarmFilter);
        }

        handleAlarmAction(getIntent());

        if (getIntent() != null && "com.voiceclock.vc.WAKE_VOICE".equals(getIntent().getAction())) {
            wakeScreenAndShowAssistant(getIntent().getStringExtra("command"));
        } else if (getIntent() != null && "com.voiceclock.vc.ALARM_TRIGGER".equals(getIntent().getAction())) {
            wakeScreenAndShowAlarm(getIntent());
        }
    }

    private void wakeScreenAndShowAlarm(Intent intent) {
        runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                setShowWhenLocked(true);
                setTurnScreenOn(true);
            }
            getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                            | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            );

            if (webView != null && intent != null) {
                String id = intent.getStringExtra("alarmId");
                String type = intent.getStringExtra("type");
                String label = intent.getStringExtra("label");
                String safeId = (id != null) ? id.replace("'", "\\'") : "";
                String safeType = (type != null) ? type.replace("'", "\\'") : "alarm";
                String safeLabel = (label != null) ? label.replace("'", "\\'") : "";
                webView.post(() ->
                        webView.evaluateJavascript("window.handleNativeAlarmTrigger && window.handleNativeAlarmTrigger('" + safeId + "', '" + safeType + "', '" + safeLabel + "')", null)
                );
            }
        });
    }

    private void wakeScreenAndShowAssistant(String command) {
        runOnUiThread(() -> {
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
            );

            if (webView != null) {
                String clean = (command != null) ? command.replace("'", "\\'") : "";
                webView.post(() ->
                        webView.evaluateJavascript("window.handleWakeWordTrigger && window.handleWakeWordTrigger('" + clean + "')", null)
                );
            }
        });
    }

    private void setupBridge() {

        webView.addJavascriptInterface(new Object() {

            @JavascriptInterface
            public void scheduleAlarm(
                    String alarmId,
                    long triggerAtMillis,
                    String label,
                    String type,
                    String text,
                    String voice
            ) {
                final String selectedVoice = (voice != null && !voice.trim().isEmpty()) ? voice : "female_1";
                AlarmPreferences.saveAlarm(MainActivity.this, alarmId, triggerAtMillis, label, type, text, selectedVoice);

                AlarmManager alarmManager =
                        (AlarmManager) getSystemService(Context.ALARM_SERVICE);
                if (alarmManager == null) return;

                Intent intent =
                        new Intent(MainActivity.this, AlarmReceiver.class);

                intent.putExtra("alarmId", alarmId);
                intent.putExtra("label", label);
                intent.putExtra("type", type);
                intent.putExtra("text", text);
                intent.putExtra("voice", selectedVoice);
                intent.putExtra(
                        "mode",
                        "task".equals(type) ? "task" : "alarm"
                );

                int reqCode = alarmId.hashCode();
                PendingIntent pi =
                        PendingIntent.getBroadcast(
                                MainActivity.this,
                                reqCode,
                                intent,
                                PendingIntent.FLAG_UPDATE_CURRENT
                                        | PendingIntent.FLAG_IMMUTABLE
                        );

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    Intent showIntent = new Intent(MainActivity.this, AlarmActivity.class);
                    showIntent.putExtra("alarmId", alarmId);
                    showIntent.putExtra("label", label);
                    showIntent.putExtra("type", type);
                    showIntent.putExtra("text", text);
                    showIntent.putExtra("voice", selectedVoice);
                    showIntent.putExtra("mode", "task".equals(type) ? "task" : "alarm");
                    showIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

                    android.os.Bundle optionsBundle = null;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                        android.app.ActivityOptions options = android.app.ActivityOptions.makeBasic();
                        options.setPendingIntentBackgroundActivityStartMode(android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
                        optionsBundle = options.toBundle();
                    }

                    PendingIntent showPi = PendingIntent.getActivity(
                            MainActivity.this,
                            reqCode + 100000,
                            showIntent,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE,
                            optionsBundle
                    );

                    AlarmManager.AlarmClockInfo clockInfo =
                            new AlarmManager.AlarmClockInfo(triggerAtMillis, showPi);

                    try {
                        alarmManager.setAlarmClock(clockInfo, pi);
                    } catch (SecurityException se) {
                        try {
                            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi);
                        } catch (Exception e) {
                            alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi);
                        }
                    }
                } else {
                    alarmManager.setExact(
                            AlarmManager.RTC_WAKEUP,
                            triggerAtMillis,
                            pi
                    );
                }
            }

            @JavascriptInterface
            public void scheduleAlarm(
                    String alarmId,
                    long triggerAtMillis,
                    String label,
                    String type,
                    String text
            ) {
                scheduleAlarm(alarmId, triggerAtMillis, label, type, text, "female_1");
            }

            @JavascriptInterface
            public void cancelAlarm(String alarmId) {
                AlarmPreferences.removeAlarm(MainActivity.this, alarmId);

                AlarmManager alarmManager =
                        (AlarmManager) getSystemService(Context.ALARM_SERVICE);

                if (alarmManager != null && alarmId != null) {
                    Intent intent =
                            new Intent(MainActivity.this, AlarmReceiver.class);

                    PendingIntent pi =
                            PendingIntent.getBroadcast(
                                    MainActivity.this,
                                    alarmId.hashCode(),
                                    intent,
                                    PendingIntent.FLAG_UPDATE_CURRENT
                                            | PendingIntent.FLAG_IMMUTABLE
                            );

                    alarmManager.cancel(pi);
                }

                try {
                    Intent stop = new Intent(MainActivity.this, AlarmService.class);
                    stop.setAction("STOP_ALARM");
                    if (alarmId != null) stop.putExtra("alarmId", alarmId);
                    startService(stop);
                    stopService(stop);
                } catch (Exception ignored) {}

                stopAlarmVibration();
                stopNativeTTS();
            }

            @JavascriptInterface
            public void stopAlarmService() {
                try {
                    Intent stop =
                            new Intent(MainActivity.this, AlarmService.class);
                    stop.setAction("STOP_ALARM");
                    startService(stop);
                    stopService(stop);
                } catch (Exception ignored) {}

                stopAlarmVibration();
                stopNativeTTS();
            }

            @JavascriptInterface
            public void startListening(String lang) {
                runOnUiThread(() -> {
                    try {
                        String speechLang = (lang != null && !lang.trim().isEmpty()) ? lang : "hi-IN";
                        pendingVoiceLang = speechLang;

                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                                requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO}, 1002);
                                return;
                            }
                        }

                        if (!SpeechRecognizer.isRecognitionAvailable(MainActivity.this)) {
                            webView.evaluateJavascript("window.handleNativeVoiceError && window.handleNativeVoiceError('Speech recognition not available on device')", null);
                            return;
                        }

                        if (activeSpeechRecognizer != null) {
                            try {
                                activeSpeechRecognizer.cancel();
                                activeSpeechRecognizer.destroy();
                            } catch (Exception ignored) {}
                            activeSpeechRecognizer = null;
                        }

                        activeSpeechRecognizer = SpeechRecognizer.createSpeechRecognizer(MainActivity.this);
                        Intent voiceIntent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                        voiceIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                        voiceIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, speechLang);
                        voiceIntent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
                        voiceIntent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);

                        activeSpeechRecognizer.setRecognitionListener(new RecognitionListener() {
                            @Override
                            public void onReadyForSpeech(Bundle params) {
                                webView.evaluateJavascript("if(window.voiceState) window.voiceState('listening')", null);
                            }

                            @Override
                            public void onBeginningOfSpeech() {
                                webView.evaluateJavascript("if(window.voiceState) window.voiceState('speaking')", null);
                            }

                            @Override
                            public void onRmsChanged(float rmsdB) {}

                            @Override
                            public void onBufferReceived(byte[] buffer) {}

                            @Override
                            public void onEndOfSpeech() {
                                webView.evaluateJavascript("if(window.voiceState) window.voiceState('processing')", null);
                            }

                            @Override
                            public void onError(int error) {
                                String msg;
                                if (error == SpeechRecognizer.ERROR_NO_MATCH) {
                                    msg = "Aawaz samajh nahi aayi, kripya dobara bolein";
                                } else if (error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                                    msg = "Time out, kripya mic daba kar dobara bolein";
                                } else if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                                    msg = "Microphone permission allow kijiye";
                                } else {
                                    msg = "Voice recognition error (" + error + "), dobara try karein";
                                }
                                webView.evaluateJavascript("window.handleNativeVoiceError && window.handleNativeVoiceError('" + msg + "')", null);
                            }

                            @Override
                            public void onResults(Bundle results) {
                                if (results != null) {
                                    ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                                    if (matches != null && !matches.isEmpty()) {
                                        String text = matches.get(0).replace("'", "\\'");
                                        webView.evaluateJavascript("window.handleNativeVoice && window.handleNativeVoice('" + text + "')", null);
                                    }
                                }
                            }

                            @Override
                            public void onPartialResults(Bundle partialResults) {
                                if (partialResults != null) {
                                    ArrayList<String> partial = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                                    if (partial != null && !partial.isEmpty()) {
                                        String text = partial.get(0).replace("'", "\\'");
                                        webView.evaluateJavascript("window.handleLiveTranscript && window.handleLiveTranscript('" + text + "')", null);
                                    }
                                }
                            }

                            @Override
                            public void onEvent(int eventType, Bundle params) {}
                        });

                        activeSpeechRecognizer.startListening(voiceIntent);
                    } catch (Exception e) {
                        android.util.Log.e("VOICE_CLOCK", "SpeechRecognizer error", e);
                        webView.evaluateJavascript("window.handleNativeVoiceError && window.handleNativeVoiceError('" + e.getMessage() + "')", null);
                    }
                });
            }

            @JavascriptInterface
            public void startListening() {
                startListening("hi-IN");
            }

            @JavascriptInterface
            public String getNativeAlarmsJson() {
                return AlarmPreferences.getAlarmsJson(MainActivity.this);
            }

            @JavascriptInterface
            public String consumePendingAction() {
                return AlarmPreferences.consumePendingAction(MainActivity.this);
            }

            @JavascriptInterface
            public void syncAlarmSnooze(String alarmId, long newTriggerTime) {
                AlarmPreferences.snoozeAlarm(MainActivity.this, alarmId, newTriggerTime);
            }

            @JavascriptInterface
            public void syncAlarmDismiss(String alarmId) {
                AlarmPreferences.removeAlarm(MainActivity.this, alarmId);
            }

            @JavascriptInterface
            public void startHeyVcService() {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                            requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO}, 1002);
                        }
                    }
                    Intent svc = new Intent(MainActivity.this, VoiceAssistantService.class);
                    ContextCompat.startForegroundService(MainActivity.this, svc);
                    android.util.Log.d("VOICE_CLOCK", "VoiceAssistantService started");
                } catch (Exception e) {
                    android.util.Log.e("VOICE_CLOCK", "Failed to start VoiceAssistantService", e);
                }
            }

            @JavascriptInterface
            public void stopHeyVcService() {
                try {
                    Intent svc = new Intent(MainActivity.this, VoiceAssistantService.class);
                    svc.setAction("STOP");
                    stopService(svc);
                    android.util.Log.d("VOICE_CLOCK", "VoiceAssistantService stopped");
                } catch (Exception e) {
                    android.util.Log.e("VOICE_CLOCK", "Failed to stop VoiceAssistantService", e);
                }
            }

            @JavascriptInterface
            public void requestLocationPermission() {
                runOnUiThread(() -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                            requestPermissions(new String[]{
                                android.Manifest.permission.ACCESS_FINE_LOCATION,
                                android.Manifest.permission.ACCESS_COARSE_LOCATION
                            }, 1003);
                        }
                    }
                });
            }

            @JavascriptInterface
            public String getDeviceLocationCoordinates() {
                try {
                    LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
                    if (lm != null) {
                        Location loc = null;
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                                checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                                loc = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
                                if (loc == null) {
                                    loc = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
                                }
                                if (loc == null) {
                                    loc = lm.getLastKnownLocation(LocationManager.PASSIVE_PROVIDER);
                                }
                            }
                        } else {
                            loc = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
                            if (loc == null) {
                                loc = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
                            }
                        }
                        if (loc != null) {
                            return "{\"lat\":" + loc.getLatitude() + ",\"lon\":" + loc.getLongitude() + "}";
                        }
                    }
                } catch (Exception e) {
                    android.util.Log.e("VOICE_CLOCK", "Location query error", e);
                }
                return null;
            }

            @JavascriptInterface
            public void syncHardwareSettings(String volumeAction, String powerAction, boolean timerVibrate, int snoozeMinutes) {
                AlarmPreferences.syncHardwareSettings(MainActivity.this, volumeAction, powerAction, timerVibrate, snoozeMinutes);
            }

            @JavascriptInterface
            public void setNativeAppLanguage(String lang) {
                AlarmPreferences.setAppLanguage(MainActivity.this, lang);
            }

            @JavascriptInterface
            public void setAlarmRinging(boolean ringing) {
                isAlarmRinging = ringing;
                if (!ringing) {
                    stopAlarmVibration();
                } else if (AlarmPreferences.isTimerVibrate(MainActivity.this)) {
                    startAlarmVibration();
                }
            }

            @JavascriptInterface
            public void startAlarmVibrationNative() {
                startAlarmVibration();
            }

            @JavascriptInterface
            public void stopAlarmVibrationNative() {
                stopAlarmVibration();
            }

            @JavascriptInterface
            public void moveAppToBack() {
                runOnUiThread(() -> moveTaskToBack(true));
            }

            @JavascriptInterface
            public void playNativeTTS(String text, String voiceId, String lang) {
                runOnUiThread(() -> speakNativeTts(text, voiceId, lang));
            }

            @JavascriptInterface
            public void stopNativeTTS() {
                runOnUiThread(() -> {
                    if (mainTts != null) {
                        try { mainTts.stop(); } catch (Exception ignored) {}
                    }
                });
            }

            @JavascriptInterface
            public void checkAndRequestExactAlarmPermission() {
                runOnUiThread(() -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
                        if (am != null && !am.canScheduleExactAlarms()) {
                            try {
                                Intent intent = new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
                                intent.setData(android.net.Uri.parse("package:" + getPackageName()));
                                startActivity(intent);
                            } catch (Exception e) {
                                e.printStackTrace();
                            }
                        }
                    }
                });
            }

            @JavascriptInterface
            public void checkAndRequestBatteryOptimization() {
                runOnUiThread(() -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                        if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                            try {
                                Intent intent = new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                                intent.setData(android.net.Uri.parse("package:" + getPackageName()));
                                startActivity(intent);
                            } catch (Exception e) {
                                e.printStackTrace();
                            }
                        }
                    }
                });
            }

            @JavascriptInterface
            public void openUrl(String url) {
                if (url == null || url.trim().isEmpty()) return;
                runOnUiThread(() -> {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url.trim()));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                    } catch (Exception e) {
                        android.util.Log.e("VOICE_CLOCK", "Failed to open url: " + url, e);
                    }
                });
            }

            @JavascriptInterface
            public void postReminderNotification(String reminderId, String senderName, String title, String timeStr, String daysStr) {
                showFamilyReminderNotification(reminderId, senderName, title, timeStr, daysStr);
            }

            @JavascriptInterface
            public void postStatusNotification(String title, String message) {
                showStatusNotification(title, message);
            }

            @JavascriptInterface
            public void cancelReminderNotification(String reminderId) {
                if (reminderId == null) return;
                try {
                    android.app.NotificationManager nm = (android.app.NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                    if (nm != null) {
                        nm.cancel(Math.abs(reminderId.hashCode()));
                    }
                } catch (Exception ignored) {}
            }

            @JavascriptInterface
            public void copyToClipboard(String text) {
                if (text == null) return;
                runOnUiThread(() -> {
                    try {
                        android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                        if (cm != null) {
                            android.content.ClipData clip = android.content.ClipData.newPlainText("Voice Clock", text);
                            cm.setPrimaryClip(clip);
                        }
                    } catch (Exception ignored) {}
                });
            }

            @JavascriptInterface
            public void shareText(String title, String text) {
                if (text == null) return;
                runOnUiThread(() -> {
                    try {
                        Intent share = new Intent(Intent.ACTION_SEND);
                        share.setType("text/plain");
                        share.putExtra(Intent.EXTRA_SUBJECT, title != null ? title : "Voice Clock");
                        share.putExtra(Intent.EXTRA_TEXT, text);
                        startActivity(Intent.createChooser(share, title != null ? title : "Share"));
                    } catch (Exception ignored) {}
                });
            }

        }, "AndroidVoice");
    }

    public void startAlarmVibration() {
        try {
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

    public void stopAlarmVibration() {
        try {
            if (vibrator != null) {
                vibrator.cancel();
            }
        } catch (Exception ignored) {}
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            int keyCode = event.getKeyCode();
            if (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
                if (isAlarmRinging) {
                    String volAction = AlarmPreferences.getVolumeButtonAction(this);
                    if ("Remind me later".equalsIgnoreCase(volAction) || "Snooze".equalsIgnoreCase(volAction)) {
                        if (webView != null) {
                            webView.post(() -> webView.evaluateJavascript("window.handleHardwareVolumeSnooze && window.handleHardwareVolumeSnooze()", null));
                        }
                        return true;
                    } else if ("Do nothing".equalsIgnoreCase(volAction)) {
                        return true;
                    }
                    // Else "Control volume" -> allow default behavior
                }
            } else if (keyCode == KeyEvent.KEYCODE_BACK) {
                handleBackPressed();
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onBackPressed() {
        handleBackPressed();
    }

    private void handleBackPressed() {
        if (webView != null) {
            webView.evaluateJavascript("window.handleHardwareBackPress ? window.handleHardwareBackPress() : false", value -> {
                if ("false".equals(value) || value == null) {
                    runOnUiThread(() -> moveTaskToBack(true));
                }
            });
        } else {
            moveTaskToBack(true);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleAlarmAction(intent);

        if (intent != null && "com.voiceclock.vc.WAKE_VOICE".equals(intent.getAction())) {
            wakeScreenAndShowAssistant(intent.getStringExtra("command"));
        } else if (intent != null && "com.voiceclock.vc.ALARM_TRIGGER".equals(intent.getAction())) {
            wakeScreenAndShowAlarm(intent);
        }
    }

    private void handleAlarmAction(Intent intent) {
        if (intent == null) return;

        String action = intent.getStringExtra("alarmAction");
        String alarmId = intent.getStringExtra("alarmId");

        if (action == null || alarmId == null) return;

        AlarmPreferences.recordPendingAction(this, alarmId, action);

        String js;
        if ("dismiss".equals(action)) {
            js = "window.dispatchEvent(new CustomEvent('nativeDismiss',{detail:{id:'" + alarmId + "'}}));";
        } else {
            js = "window.dispatchEvent(new CustomEvent('nativeSnooze',{detail:{id:'" + alarmId + "'}}));";
        }

        if (webView != null) {
            webView.post(() -> webView.evaluateJavascript(js, null));
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 1002 && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            runOnUiThread(() -> {
                if (webView != null) {
                    webView.evaluateJavascript("if(window.AndroidVoice && window.AndroidVoice.startListening) window.AndroidVoice.startListening('" + pendingVoiceLang + "')", null);
                }
            });
        } else if (requestCode == 1003 && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            runOnUiThread(() -> {
                if (webView != null) {
                    webView.evaluateJavascript("if(window.onAndroidLocationGranted) window.onAndroidLocationGranted()", null);
                }
            });
        }
    }

    private void speakNativeTts(String text, String voiceId, String lang) {
        if (text == null || text.trim().isEmpty()) return;
        final String fVoice = (voiceId != null && !voiceId.trim().isEmpty()) ? voiceId : "female_1";
        final String fLang = (lang != null && !lang.trim().isEmpty()) ? lang : "hi-IN";

        if (mainTts != null) {
            try {
                mainTts.stop();
            } catch (Exception ignored) {}
            configureAndSpeak(mainTts, text, fVoice, fLang);
        } else {
            mainTts = new TextToSpeech(this, status -> {
                if (status == TextToSpeech.SUCCESS && mainTts != null) {
                    configureAndSpeak(mainTts, text, fVoice, fLang);
                }
            });
        }
    }

    private void configureAndSpeak(TextToSpeech tts, String text, String voiceId, String lang) {
        boolean isHindi = isTextHindi(text) || lang.toLowerCase().startsWith("hi");
        Locale targetLocale = isHindi ? new Locale("hi", "IN") : Locale.US;

        float pitch = 1.0f;
        float rate = 1.0f;
        boolean preferFemale = true;

        if ("male_1".equals(voiceId)) {
            pitch = 0.65f;
            rate = 0.95f;
            preferFemale = false;
        } else if ("female_2".equals(voiceId)) {
            pitch = 1.30f;
            rate = 1.05f;
            preferFemale = true;
        } else if ("male_2".equals(voiceId)) {
            pitch = 0.76f;
            rate = 0.92f;
            preferFemale = false;
        } else if ("female_in".equals(voiceId)) {
            targetLocale = isHindi ? new Locale("hi", "IN") : new Locale("en", "IN");
            pitch = 1.12f;
            rate = 1.0f;
            preferFemale = true;
        } else if ("male_in".equals(voiceId)) {
            targetLocale = isHindi ? new Locale("hi", "IN") : new Locale("en", "IN");
            pitch = 0.72f;
            rate = 0.95f;
            preferFemale = false;
        } else { // "female_1"
            pitch = 1.15f;
            rate = 1.0f;
            preferFemale = true;
        }

        try {
            tts.setLanguage(targetLocale);
        } catch (Exception ignored) {}

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            try {
                Set<Voice> voices = tts.getVoices();
                if (voices != null && !voices.isEmpty()) {
                    Voice bestMatch = null;
                    for (Voice v : voices) {
                        if (v == null || v.getName() == null) continue;
                        String vName = v.getName().toLowerCase(Locale.ROOT);
                        Locale vLoc = v.getLocale();
                        if (vLoc != null && vLoc.getLanguage().equalsIgnoreCase(targetLocale.getLanguage())) {
                            boolean isFem = vName.contains("female") || vName.contains("#female") || vName.contains("-fem") || vName.contains("f0") || vName.contains("f1") || vName.contains("hia") || vName.contains("hic") || vName.contains("enc") || vName.contains("enf") || vName.contains("iol");
                            boolean isMal = vName.contains("male") || vName.contains("#male") || vName.contains("-mal") || vName.contains("m0") || vName.contains("m1") || vName.contains("hie") || vName.contains("hid") || vName.contains("iom") || vName.contains("end") || vName.contains("ene") || vName.contains("sfg");
                            if (preferFemale && isFem) {
                                bestMatch = v;
                                break;
                            } else if (!preferFemale && isMal) {
                                bestMatch = v;
                                break;
                            } else if (bestMatch == null) {
                                bestMatch = v;
                            }
                        }
                    }
                    if (bestMatch != null) {
                        tts.setVoice(bestMatch);
                    }
                }
            } catch (Exception ignored) {}
        }

        // Apply pitch & speech rate AFTER setVoice to ensure engine preserves custom pitch
        tts.setPitch(pitch);
        tts.setSpeechRate(rate);

        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "MAIN_TTS");
    }

    private boolean isTextHindi(String text) {
        if (text == null) return false;
        for (char c : text.toCharArray()) {
            if (c >= 0x0900 && c <= 0x097F) return true;
        }
        return false;
    }

    private void showFamilyReminderNotification(String reminderId, String senderName, String title, String timeStr, String daysStr) {
        runOnUiThread(() -> {
            try {
                android.app.NotificationManager nm = (android.app.NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm == null) return;

                String channelId = "vc_family_reminders_channel";
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    android.app.NotificationChannel channel = new android.app.NotificationChannel(
                            channelId,
                            "Family & Friends Reminders",
                            android.app.NotificationManager.IMPORTANCE_HIGH
                    );
                    channel.setDescription("Incoming reminders from family and friends with instant Accept/Reject actions");
                    channel.enableVibration(true);
                    channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
                    nm.createNotificationChannel(channel);
                }

                int notifId = (reminderId != null) ? Math.abs(reminderId.hashCode()) : 2001;

                // Accept Intent
                Intent acceptIntent = new Intent("com.voiceclock.vc.ACTION_REMINDER_ACCEPT");
                acceptIntent.setPackage(getPackageName());
                acceptIntent.putExtra("reminderId", reminderId);
                acceptIntent.putExtra("notifId", notifId);
                PendingIntent acceptPi = PendingIntent.getBroadcast(
                        this,
                        notifId * 2 + 1,
                        acceptIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
                );

                // Reject Intent
                Intent rejectIntent = new Intent("com.voiceclock.vc.ACTION_REMINDER_REJECT");
                rejectIntent.setPackage(getPackageName());
                rejectIntent.putExtra("reminderId", reminderId);
                rejectIntent.putExtra("notifId", notifId);
                PendingIntent rejectPi = PendingIntent.getBroadcast(
                        this,
                        notifId * 2 + 2,
                        rejectIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
                );

                // Content Intent (opens app)
                Intent openIntent = new Intent(this, MainActivity.class);
                openIntent.setAction("com.voiceclock.vc.OPEN_NOTIFICATIONS");
                openIntent.putExtra("reminderId", reminderId);
                openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                PendingIntent openPi = PendingIntent.getActivity(
                        this,
                        notifId,
                        openIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
                );

                String content = (title != null ? title : "Reminder") + " (" + (timeStr != null ? timeStr : "") + ")";
                if (daysStr != null && !daysStr.trim().isEmpty()) {
                    content += " • " + daysStr;
                }

                androidx.core.app.NotificationCompat.Builder builder =
                        new androidx.core.app.NotificationCompat.Builder(this, channelId)
                                .setSmallIcon(R.mipmap.ic_launcher)
                                .setContentTitle("❤️ Family Reminder: " + (senderName != null ? senderName : "Loved One"))
                                .setContentText(content)
                                .setStyle(new androidx.core.app.NotificationCompat.BigTextStyle().bigText(
                                        "From: " + (senderName != null ? senderName : "Family") + "\nTask: " + title + "\nTime: " + timeStr + (daysStr != null && !daysStr.isEmpty() ? "\nRepeat: " + daysStr : "")
                                ))
                                .setPriority(androidx.core.app.NotificationCompat.PRIORITY_HIGH)
                                .setCategory(androidx.core.app.NotificationCompat.CATEGORY_REMINDER)
                                .setAutoCancel(true)
                                .setContentIntent(openPi)
                                .addAction(android.R.drawable.checkbox_on_background, "Accept ✅", acceptPi)
                                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Reject ❌", rejectPi);

                nm.notify(notifId, builder.build());
            } catch (Exception e) {
                android.util.Log.e("VOICE_CLOCK", "Failed to show family reminder notification", e);
            }
        });
    }

    private void showStatusNotification(String title, String message) {
        runOnUiThread(() -> {
            try {
                android.app.NotificationManager nm = (android.app.NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm == null) return;

                String channelId = "vc_family_reminders_channel";
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    android.app.NotificationChannel channel = new android.app.NotificationChannel(
                            channelId,
                            "Family & Friends Reminders",
                            android.app.NotificationManager.IMPORTANCE_DEFAULT
                    );
                    nm.createNotificationChannel(channel);
                }

                int notifId = (int) (System.currentTimeMillis() % 100000);
                Intent openIntent = new Intent(this, MainActivity.class);
                openIntent.setAction("com.voiceclock.vc.OPEN_NOTIFICATIONS");
                openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                PendingIntent openPi = PendingIntent.getActivity(
                        this,
                        notifId,
                        openIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
                );

                androidx.core.app.NotificationCompat.Builder builder =
                        new androidx.core.app.NotificationCompat.Builder(this, channelId)
                                .setSmallIcon(R.mipmap.ic_launcher)
                                .setContentTitle(title != null ? title : "Voice Clock Update")
                                .setContentText(message != null ? message : "")
                                .setStyle(new androidx.core.app.NotificationCompat.BigTextStyle().bigText(message))
                                .setAutoCancel(true)
                                .setContentIntent(openPi);

                nm.notify(notifId, builder.build());
            } catch (Exception e) {
                android.util.Log.e("VOICE_CLOCK", "Failed to show status notification", e);
            }
        });
    }

    @Override
    public void onDestroy() {
        stopAlarmVibration();
        if (mainTts != null) {
            try {
                mainTts.stop();
                mainTts.shutdown();
            } catch (Exception ignored) {}
            mainTts = null;
        }
        if (screenOffReceiver != null) {
            try {
                unregisterReceiver(screenOffReceiver);
            } catch (Exception ignored) {}
        }
        if (reminderReceiver != null) {
            try {
                unregisterReceiver(reminderReceiver);
            } catch (Exception ignored) {}
        }
        if (activeSpeechRecognizer != null) {
            try {
                activeSpeechRecognizer.cancel();
                activeSpeechRecognizer.destroy();
            } catch (Exception ignored) {}
            activeSpeechRecognizer = null;
        }
        if (voiceReceiver != null) {
            try {
                unregisterReceiver(voiceReceiver);
            } catch (Exception ignored) {}
        }
        if (alarmTriggerReceiver != null) {
            try {
                unregisterReceiver(alarmTriggerReceiver);
            } catch (Exception ignored) {}
        }
        super.onDestroy();
    }
}