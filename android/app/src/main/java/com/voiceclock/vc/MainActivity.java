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
import android.util.Log;
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

    public static volatile MainActivity activeInstance = null;

    private WebView webView;
    private BroadcastReceiver voiceReceiver;
    private BroadcastReceiver screenOffReceiver;
    private BroadcastReceiver reminderReceiver;
    private BroadcastReceiver alarmTriggerReceiver;
    private Vibrator vibrator;
    private boolean isAlarmRinging = false;
    private boolean isAppInForeground = false;
    private boolean isTtsSpeaking = false;
    private final android.os.Handler mainHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private String currentVoiceLanguage = "bilingual";
    private String pendingVoiceLang = "bilingual";
    private TextToSpeech mainTts;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        activeInstance = this;

        // Pre-warm TTS engine at application launch to eliminate speech latency
        AppTtsManager.getInstance(this).init();

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
                        } else if ("Remind me later".equalsIgnoreCase(powerAction) || "Snooze".equalsIgnoreCase(powerAction)) {
                            if (webView != null) {
                                webView.post(() -> webView.evaluateJavascript("window.handleHardwareVolumeSnooze && window.handleHardwareVolumeSnooze()", null));
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
                    String id = intent.getStringExtra("alarmId");
                    if (id != null && !AlarmPreferences.isAlarmActive(MainActivity.this, id)) {
                        Log.w("VOICE_CLOCK", "MainActivity alarmTriggerReceiver: Alarm " + id + " is not active/deleted. Dropping.");
                        return;
                    }
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

        BroadcastReceiver actionAlarmEventReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent != null && "com.voiceclock.vc.ACTION_ALARM_EVENT".equals(intent.getAction())) {
                    String action = intent.getStringExtra("action");
                    String alarmId = intent.getStringExtra("alarmId");
                    if (webView != null) {
                        String cleanId = (alarmId != null) ? alarmId.replace("'", "\\'") : "";
                        String cleanAction = (action != null) ? action.replace("'", "\\'") : "dismiss";
                        webView.post(() -> webView.evaluateJavascript("window.handleNativeAlarmEvent && window.handleNativeAlarmEvent('" + cleanId + "', '" + cleanAction + "')", null));
                    }
                }
            }
        };
        IntentFilter actionFilter = new IntentFilter("com.voiceclock.vc.ACTION_ALARM_EVENT");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(actionAlarmEventReceiver, actionFilter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(actionAlarmEventReceiver, actionFilter);
        }

        handleAlarmAction(getIntent());

        if (getIntent() != null && "com.voiceclock.vc.WAKE_VOICE".equals(getIntent().getAction())) {
            wakeScreenAndShowAssistant(getIntent().getStringExtra("command"));
        } else if (getIntent() != null && "com.voiceclock.vc.ALARM_TRIGGER".equals(getIntent().getAction())) {
            wakeScreenAndShowAlarm(getIntent());
        }
    }

    private void wakeScreenAndShowAlarm(Intent intent) {
        if (intent == null) return;
        String id = intent.getStringExtra("alarmId");
        if (id != null && !AlarmPreferences.isAlarmActive(this, id)) {
            Log.w("VOICE_CLOCK", "wakeScreenAndShowAlarm: Alarm " + id + " is not active/deleted. Dropping.");
            return;
        }
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

            if (webView != null) {
                String safeId = (id != null) ? id.replace("'", "\\'") : "";
                String type = intent.getStringExtra("type");
                String label = intent.getStringExtra("label");
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

    public WebView getWebView() {
        return webView;
    }

    public void handleVoiceInput(String text) {
        if (text == null || text.trim().isEmpty()) return;
        final String clean = text.replace("'", "\\'");
        if (webView != null) {
            webView.post(() -> webView.evaluateJavascript("window.handleNativeVoice && window.handleNativeVoice('" + clean + "')", null));
        }
    }

    public void handleLiveTranscript(String text) {
        if (text == null) return;
        final String clean = text.replace("'", "\\'");
        if (webView != null) {
            webView.post(() -> webView.evaluateJavascript("window.handleLiveTranscript && window.handleLiveTranscript('" + clean + "')", null));
        }
    }

    public void updateVoiceState(String state) {
        if (state == null) return;
        if (webView != null) {
            webView.post(() -> webView.evaluateJavascript("window.voiceState && window.voiceState('" + state + "')", null));
        }
    }

    public void onVoiceServiceStarted() {
        if (webView != null) {
            webView.post(() -> webView.evaluateJavascript("window.onVoiceSessionStarted && window.onVoiceSessionStarted()", null));
        }
    }

    public void onVoiceServiceStopped() {
        if (webView != null) {
            webView.post(() -> webView.evaluateJavascript("window.onVoiceSessionStopped && window.onVoiceSessionStopped()", null));
        }
    }

    public void startVoiceService() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO}, 1002);
                    return;
                }
            }
            Intent svc = new Intent(MainActivity.this, VoiceAssistantService.class);
            svc.putExtra("lang", currentVoiceLanguage);
            ContextCompat.startForegroundService(MainActivity.this, svc);
            Log.d("VOICE_CLOCK", "VoiceAssistantService started by MainActivity");
            onVoiceServiceStarted();
        } catch (Exception e) {
            Log.e("VOICE_CLOCK", "Failed to start VoiceAssistantService", e);
        }
    }

    public void stopVoiceService() {
        try {
            Intent svc = new Intent(MainActivity.this, VoiceAssistantService.class);
            svc.setAction("STOP");
            startService(svc);
            stopService(svc);
            Log.d("VOICE_CLOCK", "VoiceAssistantService stopped by MainActivity");
        } catch (Exception e) {
            Log.e("VOICE_CLOCK", "Failed to stop VoiceAssistantService", e);
        }
        SilentSpeechAudioHelper.restoreGlobalAudio(this);
        onVoiceServiceStopped();
    }

    public void pauseListeningForTTS() {
        isTtsSpeaking = true;
        if (VoiceAssistantService.activeService != null) {
            VoiceAssistantService.activeService.pauseListeningForTTS();
        }
        SilentSpeechAudioHelper.restoreGlobalAudio(this);
    }

    public void resumeListeningAfterTTS() {
        isTtsSpeaking = false;
        if (VoiceAssistantService.activeService != null) {
            VoiceAssistantService.activeService.resumeListeningAfterTTS();
        }
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
                    String voice,
                    long intervalMs
            ) {
                final String selectedVoice = (voice != null && !voice.trim().isEmpty()) ? voice : "female_1";
                AlarmPreferences.saveAlarm(MainActivity.this, alarmId, triggerAtMillis, label, type, text, selectedVoice, intervalMs);

                AlarmManager alarmManager =
                        (AlarmManager) getSystemService(Context.ALARM_SERVICE);
                if (alarmManager == null) return;

                long physicalTrigger = triggerAtMillis;
                if (AlarmPreferences.isManualTimeEnabled(MainActivity.this)) {
                    physicalTrigger -= AlarmPreferences.getManualTimeOffset(MainActivity.this);
                }

                int reqCode = alarmId.hashCode();

                Intent showIntent = new Intent(MainActivity.this, AlarmActivity.class);
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
                        MainActivity.this,
                        reqCode,
                        showIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE,
                        optionsBundle
                );

                Intent broadcastIntent = new Intent(MainActivity.this, AlarmReceiver.class);
                broadcastIntent.setAction("com.voiceclock.vc.ACTION_ALARM_TRIGGER_" + alarmId);
                broadcastIntent.setPackage(getPackageName());
                broadcastIntent.putExtra("alarmId", alarmId);
                broadcastIntent.putExtra("label", label);
                broadcastIntent.putExtra("type", type);
                broadcastIntent.putExtra("text", text);
                broadcastIntent.putExtra("voice", selectedVoice);
                broadcastIntent.putExtra("mode", "task".equals(type) ? "task" : "alarm");
                broadcastIntent.putExtra("intervalMs", intervalMs);

                PendingIntent broadcastPi = PendingIntent.getBroadcast(
                        MainActivity.this,
                        reqCode,
                        broadcastIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );

                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        AlarmManager.AlarmClockInfo clockInfo =
                                new AlarmManager.AlarmClockInfo(physicalTrigger, showPi);
                        alarmManager.setAlarmClock(clockInfo, broadcastPi);
                    } else {
                        alarmManager.setExact(
                                AlarmManager.RTC_WAKEUP,
                                physicalTrigger,
                                broadcastPi
                        );
                    }
                } catch (SecurityException se) {
                    Log.w("VOICE_CLOCK", "SecurityException on setAlarmClock, trying exact/idle fallbacks", se);
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, physicalTrigger, broadcastPi);
                        } else {
                            alarmManager.setExact(AlarmManager.RTC_WAKEUP, physicalTrigger, broadcastPi);
                        }
                    } catch (Exception e1) {
                        Log.w("VOICE_CLOCK", "setExactAndAllowWhileIdle failed, falling back to setAndAllowWhileIdle", e1);
                        try {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                                // setAndAllowWhileIdle does not require SCHEDULE_EXACT_ALARM and wakes device from Doze
                                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, physicalTrigger, broadcastPi);
                            } else {
                                alarmManager.set(AlarmManager.RTC_WAKEUP, physicalTrigger, broadcastPi);
                            }
                        } catch (Exception e2) {
                            Log.e("VOICE_CLOCK", "Fallback to set", e2);
                            alarmManager.set(AlarmManager.RTC_WAKEUP, physicalTrigger, broadcastPi);
                        }
                    }
                }
            }

            @JavascriptInterface
            public void scheduleAlarm(
                    String alarmId,
                    long triggerAtMillis,
                    String label,
                    String type,
                    String text,
                    String voice
            ) {
                scheduleAlarm(alarmId, triggerAtMillis, label, type, text, voice, 0L);
            }

            @JavascriptInterface
            public void scheduleAlarm(
                    String alarmId,
                    long triggerAtMillis,
                    String label,
                    String type,
                    String text
            ) {
                scheduleAlarm(alarmId, triggerAtMillis, label, type, text, "female_1", 0L);
            }

            @JavascriptInterface
            public void startAlarmServiceNative(String alarmId, String label, String type, String text, String voice) {
                try {
                    Intent serviceIntent = new Intent(MainActivity.this, AlarmService.class);
                    serviceIntent.setAction("START_ALARM");
                    serviceIntent.putExtra("alarmId", alarmId);
                    serviceIntent.putExtra("label", label);
                    serviceIntent.putExtra("type", type);
                    serviceIntent.putExtra("text", text);
                    serviceIntent.putExtra("voice", voice != null ? voice : "female_1");
                    serviceIntent.putExtra("mode", "task".equals(type) ? "task" : "alarm");
                    AlarmPreferences.SavedAlarm sa = AlarmPreferences.getAlarm(MainActivity.this, alarmId);
                    if (sa != null && sa.intervalMs > 0) {
                        serviceIntent.putExtra("intervalMs", sa.intervalMs);
                    }
                    ContextCompat.startForegroundService(MainActivity.this, serviceIntent);
                } catch (Exception e) {
                    Log.e("VOICE_CLOCK", "Failed to start AlarmService natively", e);
                }
            }

            @JavascriptInterface
            public void cancelAlarm(String alarmId) {
                if (alarmId == null || alarmId.trim().isEmpty()) return;
                AlarmPreferences.permanentlyDeleteAlarm(MainActivity.this, alarmId);
                AlarmPreferences.cancelAllAlarmIntents(MainActivity.this, alarmId);
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
                if (lang != null && !lang.trim().isEmpty()) {
                    currentVoiceLanguage = lang;
                    pendingVoiceLang = lang;
                }
                runOnUiThread(MainActivity.this::startVoiceService);
            }

            @JavascriptInterface
            public void startListening() {
                startListening(currentVoiceLanguage);
            }

            @JavascriptInterface
            public void stopListening() {
                runOnUiThread(MainActivity.this::stopVoiceService);
            }

            @JavascriptInterface
            public boolean isVoiceListeningActive() {
                return VoiceAssistantService.isRunning();
            }

            @JavascriptInterface
            public void setVoiceAssistantLanguage(String lang) {
                if (lang != null && !lang.trim().isEmpty()) {
                    currentVoiceLanguage = lang;
                    pendingVoiceLang = lang;
                    if (VoiceAssistantService.activeService != null) {
                        VoiceAssistantService.activeService.setVoiceLanguage(lang);
                    }
                }
            }

            @JavascriptInterface
            public void pauseListeningForTTSNative() {
                runOnUiThread(MainActivity.this::pauseListeningForTTS);
            }

            @JavascriptInterface
            public void resumeListeningAfterTTSNative() {
                runOnUiThread(MainActivity.this::resumeListeningAfterTTS);
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
                if (alarmId == null || alarmId.trim().isEmpty()) return;
                AlarmPreferences.permanentlyDeleteAlarm(MainActivity.this, alarmId);
                AlarmPreferences.cancelAllAlarmIntents(MainActivity.this, alarmId);
            }

            @JavascriptInterface
            public void startHeyVcService() {
                runOnUiThread(MainActivity.this::startVoiceService);
            }

            @JavascriptInterface
            public void stopHeyVcService() {
                runOnUiThread(MainActivity.this::stopVoiceService);
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
            public void saveBrevoConfigNative(String apiKey, String senderEmail, String senderName) {
                AlarmPreferences.saveBrevoConfig(MainActivity.this, apiKey, senderEmail, senderName);
            }

            @JavascriptInterface
            public String getBrevoApiKeyNative() {
                return AlarmPreferences.getBrevoApiKey(MainActivity.this);
            }

            @JavascriptInterface
            public String getBrevoSenderEmailNative() {
                return AlarmPreferences.getBrevoSenderEmail(MainActivity.this);
            }

            @JavascriptInterface
            public String getBrevoSenderNameNative() {
                return AlarmPreferences.getBrevoSenderName(MainActivity.this);
            }

            @JavascriptInterface
            public void saveVcAccountNative(String accountJson) {
                AlarmPreferences.saveVcAccount(MainActivity.this, accountJson);
            }

            @JavascriptInterface
            public String getVcAccountNative() {
                return AlarmPreferences.getVcAccount(MainActivity.this);
            }

            @JavascriptInterface
            public void sendBrevoEmail(
                    String apiKey,
                    String senderEmail,
                    String senderName,
                    String toEmail,
                    String toName,
                    String subject,
                    String htmlContent,
                    String callbackId
            ) {
                new Thread(() -> {
                    boolean success = false;
                    String resultMessage = "";
                    try {
                        java.net.URL url = new java.net.URL("https://api.brevo.com/v3/smtp/email");
                        java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                        conn.setRequestMethod("POST");
                        conn.setRequestProperty("accept", "application/json");
                        conn.setRequestProperty("api-key", apiKey != null ? apiKey.trim() : "");
                        conn.setRequestProperty("content-type", "application/json");
                        conn.setDoOutput(true);
                        conn.setConnectTimeout(15000);
                        conn.setReadTimeout(15000);

                        org.json.JSONObject payload = new org.json.JSONObject();

                        org.json.JSONObject sender = new org.json.JSONObject();
                        sender.put("name", (senderName != null && !senderName.trim().isEmpty()) ? senderName.trim() : "Voice Clock");
                        sender.put("email", (senderEmail != null && !senderEmail.trim().isEmpty()) ? senderEmail.trim() : "noreply@voiceclock.app");
                        payload.put("sender", sender);

                        org.json.JSONArray toArray = new org.json.JSONArray();
                        org.json.JSONObject to = new org.json.JSONObject();
                        to.put("email", toEmail != null ? toEmail.trim() : "");
                        if (toName != null && !toName.trim().isEmpty()) {
                            to.put("name", toName.trim());
                        }
                        toArray.put(to);
                        payload.put("to", toArray);

                        payload.put("subject", subject != null ? subject : "Voice Clock Verification Code");
                        payload.put("htmlContent", htmlContent != null ? htmlContent : "");

                        byte[] outBytes = payload.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
                        try (java.io.OutputStream os = conn.getOutputStream()) {
                            os.write(outBytes);
                            os.flush();
                        }

                        int statusCode = conn.getResponseCode();
                        java.io.InputStream is = (statusCode >= 200 && statusCode < 300)
                                ? conn.getInputStream()
                                : conn.getErrorStream();

                        StringBuilder response = new StringBuilder();
                        if (is != null) {
                            java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(is, java.nio.charset.StandardCharsets.UTF_8));
                            String line;
                            while ((line = reader.readLine()) != null) {
                                response.append(line);
                            }
                            reader.close();
                        }

                        if (statusCode >= 200 && statusCode < 300) {
                            success = true;
                            resultMessage = response.toString();
                        } else {
                            success = false;
                            resultMessage = "HTTP " + statusCode + ": " + response.toString();
                        }
                    } catch (Exception e) {
                        success = false;
                        resultMessage = "Error: " + e.getMessage();
                    }

                    final boolean finalSuccess = success;
                    final String sanitizedResult = resultMessage
                            .replace("\\", "\\\\")
                            .replace("'", "\\'")
                            .replace("\"", "\\\"")
                            .replace("\r", " ")
                            .replace("\n", " ");
                    final String cb = (callbackId != null) ? callbackId.replace("'", "\\'") : "";

                    runOnUiThread(() -> {
                        if (webView != null) {
                            webView.evaluateJavascript("window.onBrevoEmailResult && window.onBrevoEmailResult('" + cb + "', " + finalSuccess + ", \"" + sanitizedResult + "\")", null);
                        }
                    });
                }).start();
            }

            @JavascriptInterface
            public boolean canDrawOverlays() {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    return android.provider.Settings.canDrawOverlays(MainActivity.this);
                }
                return true;
            }

            @JavascriptInterface
            public boolean canUseFullScreenIntent() {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    android.app.NotificationManager nm = (android.app.NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                    return nm != null && nm.canUseFullScreenIntent();
                }
                return true;
            }

            @JavascriptInterface
            public void checkAndRequestOverlayPermission() {
                runOnUiThread(() -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        if (!android.provider.Settings.canDrawOverlays(MainActivity.this)) {
                            try {
                                Intent intent = new Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
                                intent.setData(android.net.Uri.parse("package:" + getPackageName()));
                                startActivity(intent);
                            } catch (Exception e) {
                                try {
                                    Intent intent = new Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
                                    startActivity(intent);
                                } catch (Exception ignored) {}
                            }
                        }
                    }
                });
            }

            @JavascriptInterface
            public void checkAndRequestFullScreenIntentPermission() {
                runOnUiThread(() -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                        android.app.NotificationManager nm = (android.app.NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                        if (nm != null && !nm.canUseFullScreenIntent()) {
                            try {
                                Intent intent = new Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                                intent.setData(android.net.Uri.parse("package:" + getPackageName()));
                                startActivity(intent);
                            } catch (Exception e) {
                                try {
                                    Intent intent = new Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                                    startActivity(intent);
                                } catch (Exception ignored) {}
                            }
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
            public void syncAllSettings(
                    String volumeAction,
                    String powerAction,
                    boolean timerVibrate,
                    int snoozeMinutes,
                    String silenceAfter,
                    int alarmVolume,
                    String gradualVolume,
                    String timerSound,
                    String timezoneIana,
                    long manualTimeOffset,
                    boolean manualTimeEnabled
            ) {
                int silenceSecs = 60;
                if ("Never".equalsIgnoreCase(silenceAfter)) {
                    silenceSecs = -1;
                } else if (silenceAfter != null) {
                    if (silenceAfter.contains("20")) silenceSecs = 1200;
                    else if (silenceAfter.contains("15")) silenceSecs = 900;
                    else if (silenceAfter.contains("10")) silenceSecs = 600;
                    else if (silenceAfter.contains("5")) silenceSecs = 300;
                    else if (silenceAfter.contains("1")) silenceSecs = 60;
                }

                int gradualSecs = 0;
                if (gradualVolume != null && !gradualVolume.equalsIgnoreCase("Off")) {
                    try {
                        gradualSecs = Integer.parseInt(gradualVolume.replace("s", "").trim());
                    } catch (Exception ignored) {}
                }

                AlarmPreferences.syncAllSettings(
                        MainActivity.this,
                        volumeAction,
                        powerAction,
                        timerVibrate,
                        snoozeMinutes,
                        silenceSecs,
                        alarmVolume,
                        gradualSecs,
                        timerSound,
                        timezoneIana,
                        manualTimeOffset,
                        manualTimeEnabled
                );
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
                    AppTtsManager.getInstance(MainActivity.this).stop();
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
                        boolean systemIgnoring = pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
                        boolean userAlreadyAllowed = AlarmPreferences.isBatteryOptimizationAllowed(MainActivity.this);

                        // If user already allowed or system is ignoring: NEVER prompt again!
                        if (systemIgnoring || userAlreadyAllowed) {
                            if (systemIgnoring && !userAlreadyAllowed) {
                                AlarmPreferences.setBatteryOptimizationAllowed(MainActivity.this, true);
                            }
                            return;
                        }

                        // If user has not granted (initial run or previously denied): ask permission
                        try {
                            Intent intent = new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                            intent.setData(android.net.Uri.parse("package:" + getPackageName()));
                            startActivityForResult(intent, 1005);
                        } catch (Exception e) {
                            try {
                                Intent fallback = new Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                                startActivity(fallback);
                            } catch (Exception ignored) {}
                        }
                    }
                });
            }

            @JavascriptInterface
            public void checkAllAlarmPermissions() {
                runOnUiThread(() -> {
                    // 1. Exact Alarm (Android 12+)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
                        if (am != null && !am.canScheduleExactAlarms()) {
                            try {
                                Intent intent = new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
                                intent.setData(android.net.Uri.parse("package:" + getPackageName()));
                                startActivity(intent);
                                return;
                            } catch (Exception ignored) {}
                        }
                    }

                    // 2. Battery Optimization (Android 6+)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                        boolean systemIgnoring = pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
                        boolean userAlreadyAllowed = AlarmPreferences.isBatteryOptimizationAllowed(MainActivity.this);
                        if (!systemIgnoring && !userAlreadyAllowed) {
                            try {
                                Intent intent = new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                                intent.setData(android.net.Uri.parse("package:" + getPackageName()));
                                startActivityForResult(intent, 1005);
                                return;
                            } catch (Exception ignored) {}
                        }
                    }

                    // 3. Draw over other apps (Overlay) - Crucial for background UI popup over lock screen
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        if (!android.provider.Settings.canDrawOverlays(MainActivity.this)) {
                            try {
                                Intent intent = new Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
                                intent.setData(android.net.Uri.parse("package:" + getPackageName()));
                                startActivity(intent);
                                return;
                            } catch (Exception ignored) {}
                        }
                    }

                    // 4. Full screen intent (Android 14+)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                        android.app.NotificationManager nm = (android.app.NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                        if (nm != null && !nm.canUseFullScreenIntent()) {
                            try {
                                Intent intent = new Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                                intent.setData(android.net.Uri.parse("package:" + getPackageName()));
                                startActivity(intent);
                                return;
                            } catch (Exception ignored) {}
                        }
                    }
                });
            }

            @JavascriptInterface
            public boolean isBatteryOptimizationAllowedNative() {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                    if (pm != null && pm.isIgnoringBatteryOptimizations(getPackageName())) {
                        AlarmPreferences.setBatteryOptimizationAllowed(MainActivity.this, true);
                        return true;
                    }
                }
                return AlarmPreferences.isBatteryOptimizationAllowed(MainActivity.this);
            }

            @JavascriptInterface
            public void setBatteryOptimizationAllowedNative(boolean allowed) {
                AlarmPreferences.setBatteryOptimizationAllowed(MainActivity.this, allowed);
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
                    } else if ("Dismiss".equalsIgnoreCase(volAction)) {
                        if (webView != null) {
                            webView.post(() -> webView.evaluateJavascript("window.handleHardwarePowerDismiss && window.handleHardwarePowerDismiss()", null));
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
                startVoiceService();
                if (webView != null) {
                    webView.evaluateJavascript("if(window.onVoicePermissionGranted) window.onVoicePermissionGranted()", null);
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
        pauseListeningForTTS();
        SilentSpeechAudioHelper.restoreGlobalAudio(this);
        final String fVoice = (voiceId != null && !voiceId.trim().isEmpty()) ? voiceId : "female_1";
        final AppTtsManager ttsMgr = AppTtsManager.getInstance(this);

        final android.speech.tts.UtteranceProgressListener utteranceListener = new android.speech.tts.UtteranceProgressListener() {
            @Override
            public void onStart(String utteranceId) {
                isTtsSpeaking = true;
            }

            @Override
            public void onDone(String utteranceId) {
                runOnUiThread(MainActivity.this::resumeListeningAfterTTS);
            }

            @Override
            public void onError(String utteranceId) {
                runOnUiThread(MainActivity.this::resumeListeningAfterTTS);
            }
        };

        int wordCount = text.trim().split("\\s+").length;
        long maxDuration = Math.max(2500, Math.min(12000, wordCount * 450 + 2000));
        mainHandler.postDelayed(() -> {
            if (isTtsSpeaking) {
                runOnUiThread(MainActivity.this::resumeListeningAfterTTS);
            }
        }, maxDuration);

        if (ttsMgr.isReady()) {
            ttsMgr.stop();
            ttsMgr.configureVoice(fVoice, text);
            ttsMgr.speak(text, 1.0f, "VOICE_CLOCK_PREVIEW_" + System.currentTimeMillis(), utteranceListener);
        } else {
            ttsMgr.waitForReady(new AppTtsManager.OnInitCallback() {
                @Override
                public void onReady() {
                    ttsMgr.configureVoice(fVoice, text);
                    ttsMgr.speak(text, 1.0f, "VOICE_CLOCK_PREVIEW_" + System.currentTimeMillis(), utteranceListener);
                }
                @Override
                public void onError() {
                    runOnUiThread(MainActivity.this::resumeListeningAfterTTS);
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
    public void onResume() {
        super.onResume();
        activeInstance = this;
        isAppInForeground = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && pm.isIgnoringBatteryOptimizations(getPackageName())) {
                AlarmPreferences.setBatteryOptimizationAllowed(this, true);
            }
        }
        if (VoiceAssistantService.isRunning()) {
            onVoiceServiceStarted();
        } else {
            onVoiceServiceStopped();
        }
    }

    @Override
    public void onPause() {
        isAppInForeground = false;
        super.onPause();
    }

    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == 1005) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            boolean systemIgnoring = (pm != null && pm.isIgnoringBatteryOptimizations(getPackageName()));
            boolean isAllowed = systemIgnoring || (resultCode == RESULT_OK);
            AlarmPreferences.setBatteryOptimizationAllowed(this, isAllowed);
            Log.d("VOICE_CLOCK", "Battery optimization dialog result: resultCode=" + resultCode + ", systemIgnoring=" + systemIgnoring + ", isAllowed=" + isAllowed);
        }
    }

    @Override
    public void onDestroy() {
        isAppInForeground = false;
        if (isFinishing()) {
            stopVoiceService();
        }
        SilentSpeechAudioHelper.restoreGlobalAudio(this);
        stopAlarmVibration();
        if (activeInstance == this) {
            activeInstance = null;
        }
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