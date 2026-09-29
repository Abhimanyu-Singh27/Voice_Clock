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
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
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

public class MainActivity extends BridgeActivity {

    private WebView webView;
    private BroadcastReceiver voiceReceiver;
    private BroadcastReceiver screenOffReceiver;
    private Vibrator vibrator;
    private boolean isAlarmRinging = false;
    private SpeechRecognizer activeSpeechRecognizer;
    private String pendingVoiceLang = "hi-IN";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

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

        handleAlarmAction(getIntent());

        if (getIntent() != null && "com.voiceclock.vc.WAKE_VOICE".equals(getIntent().getAction())) {
            wakeScreenAndShowAssistant(getIntent().getStringExtra("command"));
        }
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
                    String text
            ) {
                AlarmPreferences.saveAlarm(MainActivity.this, alarmId, triggerAtMillis, label, type, text);

                AlarmManager alarmManager =
                        (AlarmManager) getSystemService(Context.ALARM_SERVICE);

                Intent intent =
                        new Intent(MainActivity.this, AlarmReceiver.class);

                intent.putExtra("alarmId", alarmId);
                intent.putExtra("label", label);
                intent.putExtra("type", type);
                intent.putExtra("text", text);
                intent.putExtra(
                        "mode",
                        "task".equals(type) ? "task" : "alarm"
                );

                PendingIntent pi =
                        PendingIntent.getBroadcast(
                                MainActivity.this,
                                alarmId.hashCode(),
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
                    showIntent.putExtra("mode", "task".equals(type) ? "task" : "alarm");
                    showIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

                    PendingIntent showPi = PendingIntent.getActivity(
                            MainActivity.this,
                            alarmId.hashCode() + 100000,
                            showIntent,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    );

                    AlarmManager.AlarmClockInfo clockInfo =
                            new AlarmManager.AlarmClockInfo(triggerAtMillis, showPi);

                    alarmManager.setAlarmClock(clockInfo, pi);
                } else {
                    alarmManager.setExact(
                            AlarmManager.RTC_WAKEUP,
                            triggerAtMillis,
                            pi
                    );
                }
            }

            @JavascriptInterface
            public void cancelAlarm(String alarmId) {
                AlarmPreferences.removeAlarm(MainActivity.this, alarmId);

                AlarmManager alarmManager =
                        (AlarmManager) getSystemService(Context.ALARM_SERVICE);

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

            @JavascriptInterface
            public void stopAlarmService() {
                Intent stop =
                        new Intent(MainActivity.this, AlarmService.class);
                stop.setAction("STOP_ALARM");
                startService(stop);
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

    @Override
    public void onDestroy() {
        stopAlarmVibration();
        if (screenOffReceiver != null) {
            try {
                unregisterReceiver(screenOffReceiver);
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
        super.onDestroy();
    }
}