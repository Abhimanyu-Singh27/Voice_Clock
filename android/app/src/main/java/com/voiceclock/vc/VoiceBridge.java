package com.voiceclock.vc;

import android.webkit.JavascriptInterface;
import android.webkit.WebView;

public class VoiceBridge {

    WebView webView;

    public VoiceBridge(WebView webView) {
        this.webView = webView;
    }

    @JavascriptInterface
    public void startListening() {

        // TODO: trigger Android SpeechRecognizer here

    }

    public void sendResultToJS(String text) {
        webView.post(() ->
                webView.evaluateJavascript(
                        "window.handleNativeVoice('" + text + "')",
                        null
                )
        );
    }
}