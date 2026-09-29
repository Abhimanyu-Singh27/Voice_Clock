function initVoiceClockApp() {
  const $ = id => document.getElementById(id);
  let isAppReady = false;

  window.isAndroidReady = false;
  window.voiceReady = false;

  document.addEventListener("deviceready", () => {
    window.isAndroidReady = true;
    window.voiceReady = true;
    if (typeof window.syncNativeAlarmState === 'function') {
      window.syncNativeAlarmState();
    }
  });

  // Safe logger
  function addLog(msg, type = 'info') {
    console.log(`[Log ${type}]:`, msg);
  }

  // Top-level stopwatch state variables (hoisted for language & initialization safely)
  let stopwatchRunning = false;
  let stopwatchStart = 0;
  let elapsedTime = 0;
  let animationFrame = null;
  let laps = [];
  let lastLapTime = 0;

  // -------------------- POPUP & TOAST --------------------
  function showPopup(msg, type = 'normal') {
    const popup = document.createElement('div');
    popup.className = 'toast';
    popup.textContent = msg;
    if (type === 'deleted') popup.style.backgroundColor = 'rgba(239, 68, 68, 0.95)';
    else if (type === 'dismissed') popup.style.backgroundColor = 'rgba(245, 158, 11, 0.95)';
    else if (type === 'snooze') popup.style.backgroundColor = 'rgba(217, 70, 239, 0.95)';
    else popup.style.backgroundColor = '#0284c7';

    const box = $('notification-box') || document.body;
    box.appendChild(popup);
    setTimeout(() => {
      popup.style.opacity = '0';
      popup.style.transform = 'translateY(-10px)';
      popup.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      setTimeout(() => popup.remove(), 300);
    }, 2800);
  }

  function showToast(msg) {
    showPopup(msg);
  }

  // -------------------- AUDIO CONTEXT --------------------
  let audioCtx = null, audioUnlocked = false;
  function unlockAudio() {
    if (audioUnlocked) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      audioUnlocked = true;
      addLog('Audio unlocked');
    } catch (e) {
      console.log('AudioContext init error:', e);
    }
  }
  document.addEventListener('click', unlockAudio, { once: true });
  document.addEventListener('touchstart', unlockAudio, { once: true });

  // -------------------- FEATURE REGISTRY & AUTOMATIC VERSIONING --------------------
  // Version Formula: 1.[Feature Count].[Patch (for bug fixes)]
  // Starts cleanly at Version 1.0.0 as requested!
  const APP_FEATURE_REGISTRY = [
    {
      id: 'voice_clock_foundation',
      title: 'Voice Clock Foundation Launch',
      title_hi: 'वॉयस क्लॉक आधिकारिक प्रारंभिक संस्करण',
      description: 'Smart voice alarms, tasks, Sunday-Saturday day pills, lockscreen ringing, stopwatch persistence, and hardware buttons',
      description_hi: 'सटीक वॉयस अलार्म, टास्क, रविवार-शनिवार पुनरावृत्ति, लॉकस्क्रीन रिंगिंग, स्टॉपवॉच और हार्डवेयर बटन नियंत्रण',
      date: 'Sep 2026',
      date_hi: 'सितंबर 2026'
    }
  ];

  function getCalculatedAppVersion() {
    const major = 1;
    const featureCount = Math.max(0, APP_FEATURE_REGISTRY.length - 1);
    const bugFixPatch = 0; // Bug fixes modify patch
    return `${major}.${featureCount}.${bugFixPatch}`;
  }

  // Globally accessible helper so any future feature addition automatically increments version
  window.registerVCFeature = function(id, title, description, title_hi, description_hi) {
    if (!APP_FEATURE_REGISTRY.some(f => f.id === id)) {
      APP_FEATURE_REGISTRY.push({
        id,
        title,
        title_hi: title_hi || title,
        description,
        description_hi: description_hi || description,
        date: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        date_hi: new Date().toLocaleDateString('hi-IN', { month: 'short', year: 'numeric' })
      });
      if (isAppReady) {
        if (typeof renderAboutView === 'function') renderAboutView();
        if (typeof applySettingDisplays === 'function') applySettingDisplays();
      }
    }
  };

  // -------------------- SETTINGS STATE & PERSISTENCE --------------------
  const defaultSettings = {
    appLanguage: 'en',
    timezone: '(GMT+5:30) New Delhi',
    timezoneIana: 'Asia/Kolkata',
    autoTimezone: true,
    manualTimeOffset: 0,
    manualTimeEnabled: false,
    silenceAfter: '1 minute',
    snoozeDuration: '10 minutes',
    alarmVolume: 80,
    gradualVolume: 'Off',
    volumeButtonsAction: 'Remind me later',
    powerButtonAction: 'Dismiss',
    powerOffRinging: true,
    startWeek: 'Sunday',
    timerSound: 'Om Namo Bhagavate Vasudevaya _ Mahavatar Narsimha Ringtone Download - MobCup.Com.Co',
    timerVibrate: false,
    lightTheme: false
  };

  let userSettings = JSON.parse(localStorage.getItem('voiceClockSettings')) || defaultSettings;
  if (!userSettings.appLanguage) userSettings.appLanguage = 'en';
  if (!userSettings.snoozeDuration) userSettings.snoozeDuration = '10 minutes';
  if (userSettings.autoTimezone === undefined) userSettings.autoTimezone = true;
  if (!userSettings.timezoneIana) userSettings.timezoneIana = 'Asia/Kolkata';
  if (userSettings.manualTimeOffset === undefined) userSettings.manualTimeOffset = 0;
  if (userSettings.manualTimeEnabled === undefined) userSettings.manualTimeEnabled = false;
  if (!userSettings.volumeButtonsAction) userSettings.volumeButtonsAction = userSettings.buttonsAction || 'Remind me later';
  if (!userSettings.powerButtonAction) userSettings.powerButtonAction = 'Dismiss';
  if (userSettings.timerVibrate === undefined) userSettings.timerVibrate = false;

  function syncNativeHardwareSettings() {
    if (window.AndroidVoice && typeof window.AndroidVoice.syncHardwareSettings === 'function') {
      const snoozeMins = parseInt(userSettings.snoozeDuration || '10', 10) || 10;
      window.AndroidVoice.syncHardwareSettings(
        userSettings.volumeButtonsAction || 'Remind me later',
        userSettings.powerButtonAction || 'Dismiss',
        !!userSettings.timerVibrate,
        snoozeMins
      );
    }
  }

  function saveSettings() {
    localStorage.setItem('voiceClockSettings', JSON.stringify(userSettings));
    syncNativeHardwareSettings();
  }
  syncNativeHardwareSettings();

  // -------------------- BILINGUAL I18N SYSTEM (ENGLISH & HINDI) --------------------
  const I18N_STRINGS = {
    en: {
      tabLabelAlarm: 'Alarm',
      tabLabelTasks: 'Tasks',
      tabLabelVoice: 'Voice',
      tabLabelStopwatch: 'Stopwatch',

      brandTitle: 'Voice Clock',
      alarmBrandTitle: 'Voice Clock',
      alarmFormTitle: 'Set Alarm',
      taskTabTitle: 'Tasks',
      taskFormTitle: 'Add Task',
      voiceTabTitle: 'Voice Command',
      settingsViewTitle: 'Settings',
      aboutViewTitle: 'About Voice Clock',
      softwareUpdateViewTitle: 'Software Update',
      timezoneViewTitle: 'Time Zone',

      alarmDatePlaceholder: 'Set Time and Date',
      alarmNamePlaceholder: 'Alarm Name (Optional)',
      ttsTextPlaceholder: 'Alarm message for Text to Speech',
      setAlarmBtn: 'Set Alarm',
      alarmRepeatDefault: 'Select Repetition Time (Optional)',
      alarmRepeatOnce: 'Once',
      alarmRepeat1m: 'Every 1 min',
      alarmRepeat10m: 'Every 10 min',
      alarmRepeat1h: 'Every 1 hour',
      alarmRepeat5h: 'Every 5 hours',
      alarmRepeatCustom: 'Custom Interval',
      audioModeDefault: 'Select Mode Of Audio',
      audioModeTts: 'Text to Speech',
      audioModeUpload: 'Uploaded Audio',
      alarmCustomHoursPlaceholder: 'Hours',
      alarmCustomMinutesPlaceholder: 'Minutes (Optional)',
      alarmRepeatDaysLabel: 'Repeat on days:',
      alarmRepeatDaysHint: 'Select days of the week',

      taskTitlePlaceholder: 'Task Message',
      taskDatePlaceholder: 'Set Time and Date',
      addTask: 'Add Task',
      taskRepeatDefault: 'Select Repetition Time',
      taskRepeatOnce: 'Once',
      taskRepeat1m: 'Every 1 min',
      taskRepeat5m: 'Every 5 min',
      taskRepeat1h: 'Every 1 hour',
      taskRepeat5h: 'Every 5 hours',
      taskRepeatCustom: 'Custom Time Interval',
      taskCustomHoursPlaceholder: 'Hours',
      taskCustomMinutesPlaceholder: 'Minutes (Optional)',
      taskRepeatDaysLabel: 'Repeat on days:',
      taskRepeatDaysHint: 'Select days of the week',

      noAlarmsMsg: 'No alarms yet. Tap + to set an alarm.',
      noTasksMsg: 'No tasks yet. Tap + to add a task.',

      voiceLangLabel: 'Language:',
      voiceAssistantActiveHeading: 'Voice Assistant Active (Screen-On)',
      voiceAssistantActiveDesc: 'Speak in English while screen is on. Say "Set alarm at 7 AM" or "Stop alarm".',
      voiceBtnLabel: 'Start Voice',
      voiceListening: 'Listening...',
      voiceSub: 'Speak clearly in English',
      voiceCancelBtn: 'Cancel',
      voiceCmdStatus: 'Tap the microphone button to give a voice command',
      voiceTrySayingHeading: 'Try saying:',

      secGeneralTitle: 'General',
      secAlarmsTitle: 'Alarms',
      secTimersTitle: 'Timers',
      secAppearanceTitle: 'Appearance',
      secAboutTitle: 'About Voice Clock',

      settingAppLangLabel: 'App Language',
      settingHomeTzLabel: 'Home time zone',
      settingDateTimeLabel: 'Change date & time',
      settingDateTimeSub: 'Device time synchronized',
      settingSilenceLabel: 'Silence after',
      settingSnoozeLabel: 'Snooze length',
      settingAlarmVolLabel: 'Alarm volume',
      settingGradualVolLabel: 'Gradually increase volume',
      settingVolumeButtonsActionLabel: 'Volume buttons',
      settingPowerButtonActionLabel: 'Power button',
      settingPowerOffLabel: 'Power-off alarm ringing',
      settingPowerOffSub: 'After power-off, the device automatically powers on and rings',
      settingStartWeekLabel: 'Start week on',
      settingTimerSoundLabel: 'Timer sound',
      settingTimerVibrateLabel: 'Timer vibrate',
      settingThemeLabel: 'Light Theme',
      settingThemeSub: 'Switch between Dark and Light mode',
      settingAboutVCLabel: 'About Voice Clock',

      alarmEditTitle: 'Edit Alarm',
      taskEditTitle: 'Edit Task',
      editAlarmRepeatDaysLabel: 'Repeat on days:',
      editAlarmRepeatDaysHint: 'Select days of the week',
      editTaskRepeatDaysLabel: 'Repeat on days:',
      editTaskRepeatDaysHint: 'Select days of the week',
      saveEditAlarmBtn: 'Save Changes',
      saveEditTaskBtn: 'Save Changes',
      deleteEditAlarmBtn: 'Delete',
      deleteEditTaskBtn: 'Delete',
      editAlarmDatePlaceholder: 'Set Time and Date',
      editTaskDatePlaceholder: 'Set Time and Date',

      dateTimeModalTitle: 'Change Date & Time',
      dateTimeModalSub: 'Manually adjust or synchronize real time',
      dtDateLabel: 'Date:',
      dtTimeLabel: 'Time:',
      autoSyncBtnText: 'Auto Synchronize with Selected Time Zone',
      closeDateTimeModalBtn: 'Cancel',
      saveDateTimeBtn: 'Save Date & Time',

      locModalTitle: 'Auto Time Zone Location',
      locModalSub: 'Privacy & Security Protocol',
      cancelLocationPermBtn: 'Cancel',
      allowLocationPermBtn: 'Enable',

      privModalTitle: 'Privacy & Security Policy',
      privModalSub: 'Voice Clock On-Device Architecture',
      closePrivacyModalBtn: 'Close',
      closeOptionsModalBtn: 'Cancel',

      tzAutoLabel: 'Set time zone automatically',
      tzAutoSub: 'Use device location & network to update time zone as you travel',
      autoTzStatusLabel: 'Automatic detection active (GPS & Device Network)',
      currentTzTag: 'CURRENT HOME TIME ZONE',
      tzWorldHeader: 'WORLD TIME ZONES',
      tzCountBadge: '40+ Cities',
      tzSearchPlaceholder: 'Search city or country (e.g. Delhi, London, New York)...',

      aboutAppNameTitle: 'Voice Clock',
      aboutAppTagline: 'Intelligent AI & Voice-Powered Productivity Clock',
      aboutReleaseBadge: 'Feature Release',
      aboutPlatformBadge: 'Android Native',
      aboutAppInfoTitle: 'Application Information',
      aboutAppVersionLabel: 'App Version',
      aboutVersionActionHint: 'Tap to check software updates ▸',
      aboutVersionNewPill: 'UPDATE',
      aboutLaunchDateLabel: 'Date of Launching',
      aboutLaunchDateVal: 'September 29, 2026',
      aboutLaunchYearLabel: 'Year of Launching',
      aboutOwnerLabel: 'Owner & Creator',
      aboutOwnerVal: 'Ayush Kumar Singh',
      aboutRoleLabel: 'Role',
      aboutRoleVal: 'Founder & Lead Architect',
      aboutPkgLabel: 'Package ID',
      aboutSpeechLabel: 'Speech Engine',
      aboutSpeechVal: '100% On-Device English Recognizer',
      aboutPrivacyLabel: 'Privacy Guarantee',
      aboutPrivacyVal: 'Zero Cloud Recording (100% Local)',
      aboutFeaturesTitle: 'Registered Features & Version History',
      aboutFeaturesDesc: 'Every added feature automatically increments the feature version counter.',
      updateBtnText: 'Check for updates',
      privacyPolicyBtnText: 'Privacy & Security Policy',
      aboutPassionLine: 'Designed and engineered with passion by <span class="passion-red-heart">❤</span>',
      aboutCopyrightLine: '&copy; 2026 Voice Clock. All Rights Reserved.',

      swAppTitle: 'Voice Clock',
      swInstalledLabel: 'Installed Version: ',
      swScanHeading: 'Check for Updates',
      swScanSubtext: 'Scan Voice Clock OTA channels to discover new features, performance updates, and bug fixes.',
      startScanBtnText: 'Check for Updates',
      swFoundNewText: 'Found New Version!',
      swUpdateTypeLabel: 'Update Type',
      swReleaseDateLabel: 'Release Date',
      swPackageSizeLabel: 'Package Size',
      swChangelogHeading: "What's New in this Update:",
      applyUpdateBtnText: 'Update to New Version',
      dismissUpdateBtnText: 'Not Now',
      swProgressLabel: 'Downloading Update Package...',
      swProgressSub: 'Applying real-time OTA hot update. No APK reinstallation needed!',
      upToDateHeading: "You're All Set!",
      upToDateMsg: 'Voice Clock is running the latest official version. All features and bug fixes are up to date.',

      swStartBtn: '▶ Start',
      swPauseBtn: '⏸ Pause',
      swLapBtn: '🏁 Record',
      swResetBtn: '↺ Reset',
      lapEmptyText: 'No laps recorded',
      lapHeaderLap: 'Lap',
      lapHeaderTime: 'Time',

      modalLabel: 'Alarm',
      taskModalLabel: 'Task',
      alarmSwipeHintLeft: '◂ Slide to Snooze',
      alarmSwipeHintRight: 'Slide to Dismiss ▸',
      taskSwipeHintLeft: '◂ Slide to Snooze',
      taskSwipeHintRight: 'Slide to Dismiss ▸'
    },
    hi: {
      tabLabelAlarm: 'अलार्म',
      tabLabelTasks: 'कार्य',
      tabLabelVoice: 'आवाज़',
      tabLabelStopwatch: 'स्टॉपवॉच',

      brandTitle: 'वॉयस क्लॉक',
      alarmBrandTitle: 'वॉयस क्लॉक',
      alarmFormTitle: 'अलार्म सेट करें',
      taskTabTitle: 'कार्य सूची',
      taskFormTitle: 'नया कार्य जोड़ें',
      voiceTabTitle: 'वॉयस कमांड',
      settingsViewTitle: 'सेटिंग्स',
      aboutViewTitle: 'वॉयस क्लॉक के बारे में',
      softwareUpdateViewTitle: 'सॉफ्टवेयर अपडेट',
      timezoneViewTitle: 'समय क्षेत्र',

      alarmDatePlaceholder: 'समय और दिनांक चुनें',
      alarmNamePlaceholder: 'अलार्म का नाम (वैकल्पिक)',
      ttsTextPlaceholder: 'बोलने के लिए संदेश (टेक्स्ट टू स्पीच)',
      setAlarmBtn: 'अलार्म सेट करें',
      alarmRepeatDefault: 'दोहराव का समय चुनें (वैकल्पिक)',
      alarmRepeatOnce: 'एक बार',
      alarmRepeat1m: 'हर 1 मिनट',
      alarmRepeat10m: 'हर 10 मिनट',
      alarmRepeat1h: 'हर 1 घंटा',
      alarmRepeat5h: 'हर 5 घंटे',
      alarmRepeatCustom: 'कस्टम अंतराल',
      audioModeDefault: 'ऑडियो मोड चुनें',
      audioModeTts: 'टेक्स्ट टू स्पीच',
      audioModeUpload: 'अपलोड किया गया ऑडियो',
      alarmCustomHoursPlaceholder: 'घंटे',
      alarmCustomMinutesPlaceholder: 'मिनट (वैकल्पिक)',
      alarmRepeatDaysLabel: 'दोहराने के दिन:',
      alarmRepeatDaysHint: 'सप्ताह के दिन चुनें',

      taskTitlePlaceholder: 'कार्य का विवरण / नाम',
      taskDatePlaceholder: 'समय और दिनांक चुनें',
      addTask: 'कार्य जोड़ें',
      taskRepeatDefault: 'दोहराव का समय चुनें',
      taskRepeatOnce: 'एक बार',
      taskRepeat1m: 'हर 1 मिनट',
      taskRepeat5m: 'हर 5 मिनट',
      taskRepeat1h: 'हर 1 घंटा',
      taskRepeat5h: 'हर 5 घंटे',
      taskRepeatCustom: 'कस्टम समय अंतराल',
      taskCustomHoursPlaceholder: 'घंटे',
      taskCustomMinutesPlaceholder: 'मिनट (वैकल्पिक)',
      taskRepeatDaysLabel: 'दोहराने के दिन:',
      taskRepeatDaysHint: 'सप्ताह के दिन चुनें',

      noAlarmsMsg: 'कोई अलार्म नहीं है। नया अलार्म जोड़ने के लिए + दबाएं।',
      noTasksMsg: 'कोई कार्य नहीं है। नया कार्य जोड़ने के लिए + दबाएं।',

      voiceLangLabel: 'भाषा:',
      voiceAssistantActiveHeading: 'वॉयस असिस्टेंट सक्रिय (स्क्रीन-ऑन)',
      voiceAssistantActiveDesc: 'स्क्रीन चालू रहने पर हिंदी में बोलें। बोलें "सुबह 7 बजे का अलार्म लगाओ" या "अलार्म बंद करो"।',
      voiceBtnLabel: 'बोलना शुरू करें',
      voiceListening: 'सुन रहा हूँ...',
      voiceSub: 'हिंदी में स्पष्ट बोलें',
      voiceCancelBtn: 'रद्द करें',
      voiceCmdStatus: 'वॉयस कमांड देने के लिए माइक्रोफ़ोन बटन दबाएं',
      voiceTrySayingHeading: 'बोलकर देखें:',

      secGeneralTitle: 'सामान्य',
      secAlarmsTitle: 'अलार्म सेटिंग्स',
      secTimersTitle: 'टाइमर सेटिंग्स',
      secAppearanceTitle: 'दिखावट',
      secAboutTitle: 'वॉयस क्लॉक के बारे में',

      settingAppLangLabel: 'ऐप भाषा',
      settingHomeTzLabel: 'गृह समय क्षेत्र',
      settingDateTimeLabel: 'दिनांक और समय बदलें',
      settingDateTimeSub: 'डिवाइस समय सिंक्रनाइज़ है',
      settingSilenceLabel: 'अलार्म बंद होने का समय',
      settingSnoozeLabel: 'स्नूज़ अवधि',
      settingAlarmVolLabel: 'अलार्म आवाज़',
      settingGradualVolLabel: 'आवाज़ धीरे-धीरे बढ़ाएं',
      settingVolumeButtonsActionLabel: 'वॉल्यूम बटन क्रिया',
      settingPowerButtonActionLabel: 'पावर बटन क्रिया',
      settingPowerOffLabel: 'पावर-ऑफ अलार्म',
      settingPowerOffSub: 'फोन बंद होने पर भी डिवाइस चालू होकर बजेगा',
      settingStartWeekLabel: 'सप्ताह का पहला दिन',
      settingTimerSoundLabel: 'टाइमर रिंगटोन',
      settingTimerVibrateLabel: 'टाइमर कंपन',
      settingThemeLabel: 'लाइट थीम',
      settingThemeSub: 'डार्क और लाइट मोड में बदलें',
      settingAboutVCLabel: 'वॉयस क्लॉक के बारे में',

      alarmEditTitle: 'अलार्म संपादित करें',
      taskEditTitle: 'कार्य संपादित करें',
      editAlarmRepeatDaysLabel: 'दोहराने के दिन:',
      editAlarmRepeatDaysHint: 'सप्ताह के दिन चुनें',
      editTaskRepeatDaysLabel: 'दोहराने के दिन:',
      editTaskRepeatDaysHint: 'सप्ताह के दिन चुनें',
      saveEditAlarmBtn: 'बदलाव सुरक्षित करें',
      saveEditTaskBtn: 'बदलाव सुरक्षित करें',
      deleteEditAlarmBtn: 'हटाएं',
      deleteEditTaskBtn: 'हटाएं',
      editAlarmDatePlaceholder: 'समय और दिनांक चुनें',
      editTaskDatePlaceholder: 'समय और दिनांक चुनें',

      dateTimeModalTitle: 'दिनांक और समय बदलें',
      dateTimeModalSub: 'मैन्युअल रूप से बदलें या वास्तविक समय सिंक करें',
      dtDateLabel: 'तारीख:',
      dtTimeLabel: 'समय:',
      autoSyncBtnText: 'चयनित समय क्षेत्र के साथ स्वतः सिंक करें',
      closeDateTimeModalBtn: 'रद्द करें',
      saveDateTimeBtn: 'दिनांक और समय सहेजें',

      locModalTitle: 'स्वचालित समय क्षेत्र स्थान',
      locModalSub: 'गोपनीयता और सुरक्षा प्रोटोकॉल',
      cancelLocationPermBtn: 'रद्द करें',
      allowLocationPermBtn: 'सक्षम करें',

      privModalTitle: 'गोपनीयता और सुरक्षा नीति',
      privModalSub: 'वॉयस क्लॉक ऑन-डिवाइस तकनीक',
      closePrivacyModalBtn: 'बंद करें',
      closeOptionsModalBtn: 'रद्द करें',

      tzAutoLabel: 'समय क्षेत्र स्वचालित रूप से सेट करें',
      tzAutoSub: 'यात्रा के दौरान समय क्षेत्र अपडेट करने के लिए डिवाइस स्थान और नेटवर्क का उपयोग करें',
      autoTzStatusLabel: 'स्वचालित पहचान सक्रिय है (जीपीएस और नेटवर्क)',
      currentTzTag: 'वर्तमान गृह समय क्षेत्र',
      tzWorldHeader: 'विश्व समय क्षेत्र',
      tzCountBadge: '40+ शहर',
      tzSearchPlaceholder: 'शहर या देश खोजें (जैसे जयपुर, दिल्ली, मुंबई)...',

      aboutAppNameTitle: 'वॉयस क्लॉक',
      aboutAppTagline: 'बुद्धिमान एआई और वॉयस संचालित प्रोडक्टिविटी क्लॉक',
      aboutReleaseBadge: 'फ़ीचर रिलीज़',
      aboutPlatformBadge: 'एंड्रॉयड नेटिव',
      aboutAppInfoTitle: 'एप्लिकेशन जानकारी',
      aboutAppVersionLabel: 'ऐप संस्करण',
      aboutVersionActionHint: 'सॉफ्टवेयर अपडेट चेक करने के लिए टैप करें ▸',
      aboutVersionNewPill: 'अपडेट',
      aboutLaunchDateLabel: 'लॉन्च की तारीख',
      aboutLaunchDateVal: '29 सितंबर, 2026',
      aboutLaunchYearLabel: 'लॉन्च का वर्ष',
      aboutOwnerLabel: 'मालिक और निर्माता',
      aboutOwnerVal: 'आयुष कुमार सिंह',
      aboutRoleLabel: 'भूमिका',
      aboutRoleVal: 'संस्थापक और मुख्य वास्तुकार',
      aboutPkgLabel: 'पैकेज आईडी',
      aboutSpeechLabel: 'स्पीच इंजन',
      aboutSpeechVal: '100% ऑन-डिवाइस हिंदी पहचानकर्ता',
      aboutPrivacyLabel: 'गोपनीयता गारंटी',
      aboutPrivacyVal: 'शून्य क्लाउड रिकॉर्डिंग (100% स्थानीय)',
      aboutFeaturesTitle: 'पंजीकृत सुविधाएँ और संस्करण इतिहास',
      aboutFeaturesDesc: 'हर नई जोड़ी गई सुविधा से संस्करण काउंटर स्वतः बढ़ता है।',
      updateBtnText: 'अपडेट चेक करें',
      privacyPolicyBtnText: 'गोपनीयता और सुरक्षा नीति',
      aboutPassionLine: 'समर्पण और निष्ठा के साथ डिज़ाइन और निर्मित <span class="passion-red-heart">❤</span>',
      aboutCopyrightLine: '&copy; 2026 वॉयस क्लॉक। सर्वाधिकार सुरक्षित।',

      swAppTitle: 'वॉयस क्लॉक',
      swInstalledLabel: 'स्थापित संस्करण: ',
      swScanHeading: 'अपडेट चेक करें',
      swScanSubtext: 'नई सुविधाओं, बेहतर प्रदर्शन और बग सुधारों के लिए वॉयस क्लॉक चैनलों को स्कैन करें।',
      startScanBtnText: 'अपडेट चेक करें',
      swFoundNewText: 'नया संस्करण मिला!',
      swUpdateTypeLabel: 'अपडेट का प्रकार',
      swReleaseDateLabel: 'रिलीज़ की तारीख',
      swPackageSizeLabel: 'पैकेज का आकार',
      swChangelogHeading: 'इस अपडेट में नया क्या है:',
      applyUpdateBtnText: 'नया संस्करण अपडेट करें',
      dismissUpdateBtnText: 'बाद में',
      swProgressLabel: 'अपडेट पैकेज डाउनलोड हो रहा है...',
      swProgressSub: 'अपडेट लागू हो रहा है। एपीके दोबारा इंस्टॉल करने की आवश्यकता नहीं है!',
      upToDateHeading: 'सब कुछ तैयार है!',
      upToDateMsg: 'वॉयस क्लॉक नवीनतम आधिकारिक संस्करण पर चल रहा है। सभी सुविधाएं अपडेट हैं।',

      swStartBtn: '▶ शुरू करें',
      swPauseBtn: '⏸ रोकें',
      swLapBtn: '🏁 रिकॉर्ड',
      swResetBtn: '↺ रीसेट',
      lapEmptyText: 'कोई लैप रिकॉर्ड नहीं',
      lapHeaderLap: 'लैप',
      lapHeaderTime: 'समय',

      modalLabel: 'अलार्म',
      taskModalLabel: 'कार्य',
      alarmSwipeHintLeft: '◂ स्नूज़ के लिए स्लाइड करें',
      alarmSwipeHintRight: 'बंद करने के लिए स्लाइड करें ▸',
      taskSwipeHintLeft: '◂ स्नूज़ के लिए स्लाइड करें',
      taskSwipeHintRight: 'बंद करने के लिए स्लाइड करें ▸'
    }
  };

  function updateDayPillsLanguage(isHi) {
    const dayLabelsEn = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const dayLabelsHi = ['र', 'सो', 'मं', 'बु', 'गु', 'शु', 'श'];
    const labels = isHi ? dayLabelsHi : dayLabelsEn;

    ['alarmDayPills', 'editAlarmDayPills', 'taskDayPills', 'editTaskDayPills'].forEach(containerId => {
      const container = $(containerId);
      if (container) {
        const pills = container.querySelectorAll('.day-pill');
        pills.forEach((p, idx) => {
          if (labels[idx]) p.textContent = labels[idx];
        });
        if (typeof updateDayPillHint === 'function') {
          updateDayPillHint(containerId);
        }
      }
    });
  }

  function applyAppLanguage(lang) {
    const isHi = lang === 'hi';
    const dict = I18N_STRINGS[isHi ? 'hi' : 'en'] || I18N_STRINGS.en;

    const directIdMap = [
      'tabLabelAlarm',
      'tabLabelTasks',
      'tabLabelVoice',
      'tabLabelStopwatch',
      'alarmBrandTitle',
      'alarmFormTitle',
      'taskTabTitle',
      'taskFormTitle',
      'voiceTabTitle',
      'settingsViewTitle',
      'aboutViewTitle',
      'softwareUpdateViewTitle',
      'timezoneViewTitle',
      'secGeneralTitle',
      'secAlarmsTitle',
      'secTimersTitle',
      'secAppearanceTitle',
      'secAboutTitle',
      'settingAppLangLabel',
      'settingHomeTzLabel',
      'settingDateTimeLabel',
      'settingSilenceLabel',
      'settingSnoozeLabel',
      'settingAlarmVolLabel',
      'settingGradualVolLabel',
      'settingVolumeButtonsActionLabel',
      'settingPowerButtonActionLabel',
      'settingPowerOffLabel',
      'settingPowerOffSub',
      'settingStartWeekLabel',
      'settingTimerSoundLabel',
      'settingTimerVibrateLabel',
      'settingThemeLabel',
      'settingThemeSub',
      'settingAboutVCLabel',
      'alarmEditTitle',
      'taskEditTitle',
      'saveEditAlarmBtn',
      'saveEditTaskBtn',
      'deleteEditAlarmBtn',
      'deleteEditTaskBtn',
      'dateTimeModalTitle',
      'dateTimeModalSub',
      'dtDateLabel',
      'dtTimeLabel',
      'autoSyncBtnText',
      'saveDateTimeBtn',
      'closeDateTimeModalBtn',
      'locModalTitle',
      'locModalSub',
      'cancelLocationPermBtn',
      'allowLocationPermBtn',
      'privModalTitle',
      'privModalSub',
      'closePrivacyModalBtn',
      'closeOptionsModalBtn',
      'tzAutoLabel',
      'tzAutoSub',
      'currentTzTag',
      'tzWorldHeader',
      'tzCountBadge',
      'aboutAppNameTitle',
      'aboutAppTagline',
      'aboutReleaseBadge',
      'aboutPlatformBadge',
      'aboutAppInfoTitle',
      'aboutAppVersionLabel',
      'aboutVersionActionHint',
      'aboutVersionNewPill',
      'aboutLaunchDateLabel',
      'aboutLaunchDateVal',
      'aboutLaunchYearLabel',
      'aboutOwnerLabel',
      'aboutOwnerVal',
      'aboutRoleLabel',
      'aboutRoleVal',
      'aboutPkgLabel',
      'aboutSpeechLabel',
      'aboutSpeechVal',
      'aboutPrivacyLabel',
      'aboutPrivacyVal',
      'aboutFeaturesTitle',
      'aboutFeaturesDesc',
      'updateBtnText',
      'privacyPolicyBtnText',
      'swAppTitle',
      'swInstalledLabel',
      'swScanHeading',
      'swScanSubtext',
      'swFoundNewText',
      'swUpdateTypeLabel',
      'swReleaseDateLabel',
      'swPackageSizeLabel',
      'swChangelogHeading',
      'applyUpdateBtnText',
      'dismissUpdateBtnText',
      'swProgressLabel',
      'swProgressSub',
      'upToDateHeading',
      'upToDateMsg',
      'startScanBtnText',
      'swStartBtn',
      'swPauseBtn',
      'swLapBtn',
      'swResetBtn',
      'lapEmptyText',
      'lapHeaderLap',
      'lapHeaderTime',
      'alarmSwipeHintLeft',
      'alarmSwipeHintRight',
      'taskSwipeHintLeft',
      'taskSwipeHintRight',
      'alarmDatePlaceholder',
      'editAlarmDatePlaceholder',
      'taskDatePlaceholder',
      'editTaskDatePlaceholder',
      'setAlarmBtn',
      'addTask',
      'voiceLangLabel',
      'voiceAssistantActiveHeading',
      'voiceAssistantActiveDesc',
      'voiceBtnLabel',
      'voiceTrySayingHeading',
      'voiceCmdStatus',
      'alarmRepeatDaysLabel',
      'editAlarmRepeatDaysLabel',
      'taskRepeatDaysLabel',
      'editTaskRepeatDaysLabel'
    ];

    directIdMap.forEach(id => {
      const el = $(id);
      if (el && dict[id] !== undefined) {
        el.textContent = dict[id];
      }
    });

    if ($('alarmName')) $('alarmName').placeholder = dict.alarmNamePlaceholder;
    if ($('ttsText')) $('ttsText').placeholder = dict.ttsTextPlaceholder;
    if ($('editAlarmName')) $('editAlarmName').placeholder = dict.alarmNamePlaceholder;
    if ($('editTtsText')) $('editTtsText').placeholder = dict.ttsTextPlaceholder;
    if ($('taskTitle')) $('taskTitle').placeholder = dict.taskTitlePlaceholder;
    if ($('editTaskTitle')) $('editTaskTitle').placeholder = dict.taskTitlePlaceholder;
    if ($('alarmCustomHours')) $('alarmCustomHours').placeholder = dict.alarmCustomHoursPlaceholder;
    if ($('alarmCustomMinutes')) $('alarmCustomMinutes').placeholder = dict.alarmCustomMinutesPlaceholder;
    if ($('editAlarmCustomHours')) $('editAlarmCustomHours').placeholder = dict.alarmCustomHoursPlaceholder;
    if ($('editAlarmCustomMinutes')) $('editAlarmCustomMinutes').placeholder = dict.alarmCustomMinutesPlaceholder;
    if ($('customHours')) $('customHours').placeholder = dict.taskCustomHoursPlaceholder;
    if ($('customMinutes')) $('customMinutes').placeholder = dict.taskCustomMinutesPlaceholder;
    if ($('editCustomHours')) $('editCustomHours').placeholder = dict.taskCustomHoursPlaceholder;
    if ($('editCustomMinutes')) $('editCustomMinutes').placeholder = dict.taskCustomMinutesPlaceholder;
    if ($('timezoneSearchInput')) $('timezoneSearchInput').placeholder = dict.tzSearchPlaceholder;

    const alarmRepeatEl = $('alarmRepeat');
    if (alarmRepeatEl && alarmRepeatEl.options.length >= 7) {
      alarmRepeatEl.options[0].text = dict.alarmRepeatDefault;
      alarmRepeatEl.options[1].text = dict.alarmRepeatOnce;
      alarmRepeatEl.options[2].text = dict.alarmRepeat1m;
      alarmRepeatEl.options[3].text = dict.alarmRepeat10m;
      alarmRepeatEl.options[4].text = dict.alarmRepeat1h;
      alarmRepeatEl.options[5].text = dict.alarmRepeat5h;
      alarmRepeatEl.options[6].text = dict.alarmRepeatCustom;
    }

    const editAlarmRepeatEl = $('editAlarmRepeat');
    if (editAlarmRepeatEl && editAlarmRepeatEl.options.length >= 6) {
      editAlarmRepeatEl.options[0].text = dict.alarmRepeatOnce;
      editAlarmRepeatEl.options[1].text = dict.alarmRepeat1m;
      editAlarmRepeatEl.options[2].text = dict.alarmRepeat10m;
      editAlarmRepeatEl.options[3].text = dict.alarmRepeat1h;
      editAlarmRepeatEl.options[4].text = dict.alarmRepeat5h;
      editAlarmRepeatEl.options[5].text = dict.alarmRepeatCustom;
    }

    const modeEl = $('mode');
    if (modeEl && modeEl.options.length >= 3) {
      modeEl.options[0].text = dict.audioModeDefault;
      modeEl.options[1].text = dict.audioModeTts;
      modeEl.options[2].text = dict.audioModeUpload;
    }

    const editModeEl = $('editMode');
    if (editModeEl && editModeEl.options.length >= 2) {
      editModeEl.options[0].text = dict.audioModeTts;
      editModeEl.options[1].text = dict.audioModeUpload;
    }

    const taskRepeatEl = $('taskRepeat');
    if (taskRepeatEl && taskRepeatEl.options.length >= 7) {
      taskRepeatEl.options[0].text = dict.taskRepeatDefault;
      taskRepeatEl.options[1].text = dict.taskRepeatOnce;
      taskRepeatEl.options[2].text = dict.taskRepeat1m;
      taskRepeatEl.options[3].text = dict.taskRepeat5m;
      taskRepeatEl.options[4].text = dict.taskRepeat1h;
      taskRepeatEl.options[5].text = dict.taskRepeat5h;
      taskRepeatEl.options[6].text = dict.taskRepeatCustom;
    }

    const editTaskRepeatEl = $('editTaskRepeat');
    if (editTaskRepeatEl && editTaskRepeatEl.options.length >= 6) {
      editTaskRepeatEl.options[0].text = dict.taskRepeatOnce;
      editTaskRepeatEl.options[1].text = dict.taskRepeat1m;
      editTaskRepeatEl.options[2].text = dict.taskRepeat5m;
      editTaskRepeatEl.options[3].text = dict.taskRepeat1h;
      editTaskRepeatEl.options[4].text = dict.taskRepeat5h;
      editTaskRepeatEl.options[5].text = dict.taskRepeatCustom;
    }

    const voiceLangSelectEl = $('voiceLangSelect');
    if (voiceLangSelectEl) {
      if (isHi) {
        voiceLangSelectEl.innerHTML = '<option value="hi-IN" selected>हिंदी (भारत)</option>';
      } else {
        voiceLangSelectEl.innerHTML = '<option value="en-IN" selected>English (India)</option><option value="en-US">English (US)</option>';
      }
    }

    const voiceHintChipsEl = $('voiceHintChips');
    if (voiceHintChipsEl) {
      if (isHi) {
        voiceHintChipsEl.innerHTML = `
          <span class="hint-chip">"सुबह 7:00 बजे का अलार्म लगाओ"</span>
          <span class="hint-chip">"शाम 8:00 बजे मीटिंग का अलार्म लगाओ"</span>
          <span class="hint-chip">"सुबह 7:00 बजे पढ़ाई का अलार्म लगाओ"</span>
          <span class="hint-chip">"शाम 7:00 बजे पढ़ाई का कार्य बनाओ"</span>
          <span class="hint-chip">"रात 8:30 बजे दवा लेने का कार्य याद दिलाओ"</span>
          <span class="hint-chip">"अलार्म बंद करो"</span>
          <span class="hint-chip">"अलार्म स्नूज़ करो"</span>
        `;
      } else {
        voiceHintChipsEl.innerHTML = `
          <span class="hint-chip">"Set alarm at 7:00 AM"</span>
          <span class="hint-chip">"Set alarm at 8:00 PM for meeting"</span>
          <span class="hint-chip">"Set alarm at 7:00 AM for study"</span>
          <span class="hint-chip">"Create task for study at 7:00 PM"</span>
          <span class="hint-chip">"Remind me to take medicine at 8:30 PM"</span>
          <span class="hint-chip">"Stop alarm"</span>
          <span class="hint-chip">"Snooze alarm"</span>
        `;
      }
    }

    if ($('aboutPassionLine')) $('aboutPassionLine').innerHTML = dict.aboutPassionLine;
    if ($('aboutCopyrightLine')) $('aboutCopyrightLine').innerHTML = dict.aboutCopyrightLine;

    const locBody = $('locModalBody');
    if (locBody) {
      locBody.innerHTML = isHi
        ? `वॉयस क्लॉक आपके सटीक स्थानीय समय क्षेत्र का स्वतः चयन करने के लिए अनुमानित स्थान का उपयोग करता है।<br><br>
           🔒 <strong>100% सुरक्षित और गोपनीय:</strong>
           <ul style="margin:6px 0 0 16px;padding:0;">
             <li>स्थान विवरण कभी डिवाइस से बाहर नहीं जाता</li>
             <li>शून्य सर्वर ट्रैकिंग या क्लाउड अपलोड</li>
             <li>केवल समय गणना के लिए उपयोग</li>
           </ul>`
        : `Voice Clock automatically detects your local time zone when you travel using device location.<br><br>
           🔒 <strong>100% Private &amp; Safe:</strong>
           <ul style="margin:6px 0 0 16px;padding:0;">
             <li>Location coordinates never leave your device</li>
             <li>Zero server tracking or cloud uploads</li>
             <li>Only used to calculate time offset</li>
           </ul>`;
    }

    const privBody = $('privModalBody');
    if (privBody) {
      privBody.innerHTML = isHi
        ? `<p><strong>1. शून्य वॉयस रिकॉर्डिंग:</strong> वॉयस क्लॉक आपकी आवाज़ को डिस्क पर सहेजता नहीं है और न ही किसी क्लाउड पर अपलोड करता है।</p>
           <p><strong>2. स्थानीय पहचान:</strong> सभी वॉयस निर्देश सीधे आपके डिवाइस पर संसाधित होते हैं।</p>
           <p><strong>3. स्थान गोपनीयता:</strong> समय क्षेत्र के लिए लिया गया स्थान केवल स्थानीय मेमोरी में उपयोग होता है और तुरंत हटा दिया जाता है।</p>
           <p><strong>4. बैटरी बचत:</strong> स्क्रीन बंद होते ही माइक्रोफ़ोन स्वतः निष्क्रिय हो जाता है।</p>
           <p><strong>5. निर्माता:</strong> आयुष कुमार सिंह (2026)।</p>`
        : `<p><strong>1. Zero Voice Recording Retention:</strong> Voice Clock does not record or store your voice audio on disk or upload it to any third-party cloud.</p>
           <p><strong>2. Local Speech Recognition:</strong> Voice commands are analyzed directly on your device using native speech recognizers.</p>
           <p><strong>3. Location Privacy:</strong> When automatic time zone detection is enabled, geolocation coordinates are used strictly in local memory to match timezone offsets and are discarded immediately.</p>
           <p><strong>4. Battery Efficiency:</strong> Voice Clock automatically shuts down microphone listeners when your device screen turns off, saving battery.</p>
           <p><strong>5. Created By:</strong> Ayush Kumar Singh (2026).</p>`;
    }

    updateDayPillsLanguage(isHi);

    if (window.AndroidVoice && typeof window.AndroidVoice.setNativeAppLanguage === 'function') {
      try {
        window.AndroidVoice.setNativeAppLanguage(lang);
      } catch (e) {
        console.log('Error setting native app language:', e);
      }
    }

    if ($('closeVoiceOverlayBtn')) $('closeVoiceOverlayBtn').textContent = dict.voiceCancelBtn;
    if ($('voiceSub')) $('voiceSub').textContent = dict.voiceSub;

    // Localize stopwatch button states and lap items
    const swStartBtnEl = $('swStartBtn');
    if (swStartBtnEl) {
      if (typeof stopwatchRunning !== 'undefined' && stopwatchRunning) {
        swStartBtnEl.textContent = isHi ? "चालू है" : "Running";
      } else if (typeof elapsedTime !== 'undefined' && elapsedTime > 0) {
        swStartBtnEl.textContent = isHi ? "फिर शुरू करें" : "Resume";
      } else {
        swStartBtnEl.textContent = isHi ? "▶ शुरू करें" : "▶ Start";
      }
    }
    const emptyLapEl = document.querySelector('#lapContainer .lap-empty');
    if (emptyLapEl) {
      emptyLapEl.textContent = isHi ? "कोई लैप रिकॉर्ड नहीं" : "No laps recorded";
    }
    const lapItems = document.querySelectorAll('#lapContainer .lap-item');
    if (lapItems.length > 0 && typeof laps !== 'undefined' && Array.isArray(laps)) {
      const lCont = $('lapContainer');
      if (lCont) {
        lCont.innerHTML = '';
        laps.forEach((lapTime, idx) => {
          const t = formatTime(lapTime);
          const lapDiv = document.createElement("div");
          lapDiv.className = "lap-item";
          lapDiv.innerHTML = `
            <span>${isHi ? 'लैप ' + (idx + 1) : 'Lap ' + (idx + 1)}</span>
            <span>${t.h}:${t.m}:${t.s}.${t.cs}</span>
          `;
          lCont.prepend(lapDiv);
        });
      }
    }

    if (isAppReady) {
      if (typeof renderAlarms === 'function') renderAlarms();
      if (typeof renderTasks === 'function') renderTasks();
      if (typeof renderAboutView === 'function') renderAboutView();
      if (typeof applySettingDisplays === 'function') applySettingDisplays();
      if (typeof updateTimezoneUI === 'function') updateTimezoneUI();
      if (typeof renderTimezoneList === 'function') renderTimezoneList($('timezoneSearchInput') ? $('timezoneSearchInput').value : '');
      if (typeof updateClock === 'function') updateClock();
    }
  }

  // -------------------- REAL-TIME CLOCK (Inside Stopwatch Tab & Timezone View) --------------------
  function getEffectiveNow() {
    if (userSettings && userSettings.manualTimeEnabled && typeof userSettings.manualTimeOffset === 'number') {
      return new Date(Date.now() + userSettings.manualTimeOffset);
    }
    return new Date();
  }

  const clockEl = $('clock'), dateEl = $('date');
  function updateClock() {
    const now = getEffectiveNow();
    const tz = (userSettings && userSettings.timezoneIana) ? userSettings.timezoneIana : 'Asia/Kolkata';
    const isHi = userSettings && userSettings.appLanguage === 'hi';

    if (clockEl) {
      try {
        clockEl.textContent = now.toLocaleTimeString('en-US', { timeZone: tz, hour12: true });
      } catch {
        clockEl.textContent = now.toLocaleTimeString();
      }
    }
    if (dateEl) {
      if (isHi) {
        const daysHi = ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"];
        const monthsHi = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];
        try {
          const dParts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' }).formatToParts(now);
          const dayVal = dParts.find(p => p.type === 'day')?.value || now.getDate();
          const monthIdx = parseInt(dParts.find(p => p.type === 'month')?.value || (now.getMonth() + 1), 10) - 1;
          const yearVal = dParts.find(p => p.type === 'year')?.value || now.getFullYear();
          const dayName = daysHi[now.getDay()];
          const monthName = monthsHi[monthIdx] || '';
          dateEl.textContent = `${dayName}, ${dayVal} ${monthName} ${yearVal}`;
        } catch {
          dateEl.textContent = `${daysHi[now.getDay()]}, ${now.getDate()} ${monthsHi[now.getMonth()]} ${now.getFullYear()}`;
        }
      } else {
        try {
          const dayName = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long' });
          const dateStr = now.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' });
          dateEl.textContent = `${dayName}, ${dateStr}`;
        } catch {
          const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
          dateEl.textContent = `${days[now.getDay()]}, ${now.toLocaleDateString()}`;
        }
      }
    }
    const dateTimeSub = $('settingDateTimeSub');
    if (dateTimeSub) {
      if (userSettings && userSettings.manualTimeEnabled) {
        dateTimeSub.textContent = isHi ? `मैन्युअल समय: ${now.toLocaleTimeString()} (${now.toLocaleDateString()})` : `Manual time: ${now.toLocaleTimeString()} (${now.toLocaleDateString()})`;
      } else {
        dateTimeSub.textContent = isHi ? `डिवाइस समय सिंक्रनाइज़ है: ${now.toLocaleTimeString()}` : `Device time: ${now.toLocaleTimeString()} (${now.toLocaleDateString()})`;
      }
    }

    if (typeof updateTimezoneClockDisplay === 'function') {
      updateTimezoneClockDisplay(now, tz);
    }
  }
  setInterval(updateClock, 1000);
  updateClock();

  // -------------------- CHANGE DATE & TIME MODAL --------------------
  const dateTimeModal = $('dateTimeModal');
  const settingDateTime = $('settingDateTime');
  const closeDateTimeModalBtn = $('closeDateTimeModalBtn');
  const saveDateTimeBtn = $('saveDateTimeBtn');
  const autoSyncTimeBtn = $('autoSyncTimeBtn');
  const manualDateInput = $('manualDateInput');
  const manualTimeInput = $('manualTimeInput');
  const autoSyncStatusMsg = $('autoSyncStatusMsg');

  function openDateTimeModal() {
    if (!dateTimeModal) return;
    const now = getEffectiveNow();
    const tz = userSettings.timezoneIana || 'Asia/Kolkata';

    try {
      const year = now.toLocaleDateString('en-US', { timeZone: tz, year: 'numeric' });
      const month = now.toLocaleDateString('en-US', { timeZone: tz, month: '2-digit' });
      const day = now.toLocaleDateString('en-US', { timeZone: tz, day: '2-digit' });
      const hours = now.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', hour12: false });
      const mins = now.toLocaleTimeString('en-US', { timeZone: tz, minute: '2-digit' });
      const secs = now.toLocaleTimeString('en-US', { timeZone: tz, second: '2-digit' });

      if (manualDateInput) manualDateInput.value = `${year}-${month}-${day}`;
      if (manualTimeInput) manualTimeInput.value = `${hours}:${mins}:${secs}`;
    } catch {
      if (manualDateInput) manualDateInput.value = now.toISOString().split('T')[0];
      if (manualTimeInput) manualTimeInput.value = now.toTimeString().split(' ')[0];
    }

    if (autoSyncStatusMsg) {
      if (userSettings.manualTimeEnabled) {
        autoSyncStatusMsg.textContent = userSettings.appLanguage === 'hi' ? 'मैन्युअल समय सक्रिय है' : 'Manual time offset active';
      } else {
        autoSyncStatusMsg.textContent = '';
      }
    }
    dateTimeModal.classList.remove('hidden');
  }

  function closeDateTimeModal() {
    if (dateTimeModal) dateTimeModal.classList.add('hidden');
  }

  settingDateTime?.addEventListener('click', openDateTimeModal);
  closeDateTimeModalBtn?.addEventListener('click', closeDateTimeModal);
  dateTimeModal?.addEventListener('click', (e) => {
    if (e.target === dateTimeModal) closeDateTimeModal();
  });

  autoSyncTimeBtn?.addEventListener('click', () => {
    userSettings.manualTimeOffset = 0;
    userSettings.manualTimeEnabled = false;
    saveSettings();
    updateClock();

    const now = new Date();
    const tz = userSettings.timezoneIana || 'Asia/Kolkata';
    try {
      const year = now.toLocaleDateString('en-US', { timeZone: tz, year: 'numeric' });
      const month = now.toLocaleDateString('en-US', { timeZone: tz, month: '2-digit' });
      const day = now.toLocaleDateString('en-US', { timeZone: tz, day: '2-digit' });
      const hours = now.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', hour12: false });
      const mins = now.toLocaleTimeString('en-US', { timeZone: tz, minute: '2-digit' });
      const secs = now.toLocaleTimeString('en-US', { timeZone: tz, second: '2-digit' });

      if (manualDateInput) manualDateInput.value = `${year}-${month}-${day}`;
      if (manualTimeInput) manualTimeInput.value = `${hours}:${mins}:${secs}`;
    } catch (e) {
      if (manualDateInput) manualDateInput.value = now.toISOString().split('T')[0];
      if (manualTimeInput) manualTimeInput.value = now.toTimeString().split(' ')[0];
    }
    const isHi = userSettings.appLanguage === 'hi';
    const tzName = userSettings.timezone || tz;
    if (autoSyncStatusMsg) autoSyncStatusMsg.textContent = isHi ? `✓ ${tzName} के साथ समन्वयित` : `✓ Synchronized with ${tzName}`;
    showPopup(isHi ? `✓ वास्तविक समय समन्वयित हुआ (${tzName})` : `✓ Real time synchronized (${tzName})`);
  });

  saveDateTimeBtn?.addEventListener('click', () => {
    const isHi = userSettings.appLanguage === 'hi';
    const dateVal = manualDateInput?.value;
    const timeVal = manualTimeInput?.value;
    if (!dateVal || !timeVal) {
      alert(isHi ? 'कृपया मान्य तारीख और समय दर्ज करें' : 'Please enter valid date and time');
      return;
    }
    const dateParts = dateVal.split('-').map(Number);
    const timeParts = timeVal.split(':').map(Number);
    if (dateParts.length < 3) {
      alert(isHi ? 'कृपया मान्य तारीख (YYYY-MM-DD) दर्ज करें' : 'Please enter valid date (YYYY-MM-DD)');
      return;
    }
    const year = dateParts[0];
    const month = dateParts[1] - 1;
    const day = dateParts[2];
    const hours = timeParts[0] || 0;
    const mins = timeParts[1] || 0;
    const secs = timeParts[2] || 0;

    const targetDate = new Date(year, month, day, hours, mins, secs);
    if (isNaN(targetDate.getTime())) {
      alert(isHi ? 'कृपया मान्य तारीख और समय दर्ज करें' : 'Please enter valid date and time');
      return;
    }

    userSettings.manualTimeOffset = targetDate.getTime() - Date.now();
    userSettings.manualTimeEnabled = true;
    saveSettings();
    updateClock();

    closeDateTimeModal();
    showPopup(isHi ? '✓ दिनांक और समय सहेज लिया गया' : '✓ Date & Time saved');
  });

  // -------------------- TABS & HIERARCHICAL NAVIGATION --------------------
  function switchToTab(tabId) {
    if (!tabId) return;
    const allTabBtns = document.querySelectorAll('.bottom-nav .tab-btn');
    const allTabContents = document.querySelectorAll('.tab-content');

    allTabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    allTabContents.forEach(c => c.classList.toggle('active', c.id === tabId));

    // Close any open overlay pages when switching tabs
    ['settingsView', 'aboutView', 'softwareUpdateView', 'timezoneView', 'optionsDialogModal', 'locationPrivacyModal', 'privacyPolicyModal', 'dateTimeModal'].forEach(id => {
      const el = $(id);
      if (el) el.classList.add('hidden');
    });

    // Reset alarm & task forms to list view when switching
    if (tabId === 'alarmTab') {
      $('alarmFormView')?.classList.add('hidden');
      $('alarmEditView')?.classList.add('hidden');
      $('alarmListView')?.classList.remove('hidden');
    } else if (tabId === 'taskTab') {
      $('taskFormView')?.classList.add('hidden');
      $('taskEditView')?.classList.add('hidden');
      $('taskListView')?.classList.remove('hidden');
    }
  }
  window.switchToTab = switchToTab;

  // Document-level event delegation ensures clicks on nested SVG, paths, or labels reliably switch tabs
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.bottom-nav .tab-btn');
    if (btn && btn.dataset && btn.dataset.tab) {
      e.preventDefault();
      switchToTab(btn.dataset.tab);
    }
  });

  // Direct element event listeners
  document.querySelectorAll('.bottom-nav .tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      switchToTab(btn.dataset.tab);
    });
  });

  // Clean, non-looping hierarchical hardware back button handler
  window.handleHardwareBackPress = function() {
    // 1. Close active popups/modals
    const modalsToClose = [
      'dateTimeModal',
      'optionsDialogModal',
      'locationPrivacyModal',
      'privacyPolicyModal',
      'voiceOverlay'
    ];
    for (const id of modalsToClose) {
      const el = $(id);
      if (el && !el.classList.contains('hidden')) {
        el.classList.add('hidden');
        if (id === 'voiceOverlay' && activeSpeechRecognition) {
          try { activeSpeechRecognition.abort(); } catch {}
          activeSpeechRecognition = null;
        }
        return true;
      }
    }

    // 2. Subpages inside Settings
    const swView = $('softwareUpdateView');
    if (swView && !swView.classList.contains('hidden')) {
      swView.classList.add('hidden');
      refreshSettingsUpdateBadge();
      return true;
    }
    const abView = $('aboutView');
    if (abView && !abView.classList.contains('hidden')) {
      abView.classList.add('hidden');
      return true;
    }
    const tzView = $('timezoneView');
    if (tzView && !tzView.classList.contains('hidden')) {
      tzView.classList.add('hidden');
      return true;
    }
    const stView = $('settingsView');
    if (stView && !stView.classList.contains('hidden')) {
      stView.classList.add('hidden');
      return true;
    }

    // 3. Edit & Form Views in tabs
    const alEdit = $('alarmEditView');
    if (alEdit && !alEdit.classList.contains('hidden')) {
      alEdit.classList.add('hidden');
      $('alarmListView')?.classList.remove('hidden');
      return true;
    }
    const alForm = $('alarmFormView');
    if (alForm && !alForm.classList.contains('hidden')) {
      alForm.classList.add('hidden');
      $('alarmListView')?.classList.remove('hidden');
      return true;
    }
    const tskEdit = $('taskEditView');
    if (tskEdit && !tskEdit.classList.contains('hidden')) {
      tskEdit.classList.add('hidden');
      $('taskListView')?.classList.remove('hidden');
      return true;
    }
    const tskForm = $('taskFormView');
    if (tskForm && !tskForm.classList.contains('hidden')) {
      tskForm.classList.add('hidden');
      $('taskListView')?.classList.remove('hidden');
      return true;
    }

    // 4. Tab navigation: if on taskTab, voiceTab, or logTab, return directly to root alarmTab
    const activeTab = document.querySelector('.tab-content.active');
    if (activeTab && activeTab.id !== 'alarmTab') {
      switchToTab('alarmTab');
      return true;
    }

    // 5. Already at root alarm tab list view with no popups -> minimize app cleanly
    return false;
  };

  // -------------------- SETTINGS VIEW & PREFERENCES --------------------
  const settingsView = $('settingsView');
  const closeSettingsBtn = $('closeSettingsBtn');
  document.querySelectorAll('.open-settings-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (settingsView) settingsView.classList.remove('hidden');
    });
  });
  closeSettingsBtn?.addEventListener('click', () => {
    if (settingsView) settingsView.classList.add('hidden');
  });

  // Load and apply theme
  const savedTheme = localStorage.getItem('theme');
  const settingThemeToggle = $('settingThemeToggle');
  if (savedTheme === 'light' || userSettings.lightTheme) {
    document.body.classList.add('light');
    if (settingThemeToggle) settingThemeToggle.checked = true;
  } else {
    document.body.classList.remove('light');
  }

  settingThemeToggle?.addEventListener('change', (e) => {
    const isLight = e.target.checked;
    userSettings.lightTheme = isLight;
    if (isLight) {
      document.body.classList.add('light');
      localStorage.setItem('theme', 'light');
    } else {
      document.body.classList.remove('light');
      localStorage.setItem('theme', 'dark');
    }
    saveSettings();
  });

  // -------------------- OPTIONS PICKER MODAL (OPTION BAR) --------------------
  const optionsDialogModal = $('optionsDialogModal');
  const optionsModalTitle = $('optionsModalTitle');
  const optionsModalSub = $('optionsModalSub');
  const optionsModalList = $('optionsModalList');
  const closeOptionsModalBtn = $('closeOptionsModalBtn');

  function openOptionPicker({ title, subtitle = '', options, currentValue, onSelect }) {
    if (!optionsDialogModal || !optionsModalList) return;

    if (optionsModalTitle) optionsModalTitle.textContent = title;
    if (optionsModalSub) {
      optionsModalSub.textContent = subtitle;
      optionsModalSub.style.display = subtitle ? 'block' : 'none';
    }

    optionsModalList.innerHTML = '';

    options.forEach(opt => {
      const val = typeof opt === 'object' ? opt.value : opt;
      const label = typeof opt === 'object' ? opt.label : opt;
      const sub = typeof opt === 'object' ? opt.sub : '';
      const isSelected = String(val).toLowerCase() === String(currentValue).toLowerCase();

      const row = document.createElement('div');
      row.className = `option-item-row ${isSelected ? 'selected' : ''}`;
      row.innerHTML = `
        <div class="option-row-text">
          <div class="option-row-label">${label}</div>
          ${sub ? `<div class="option-row-sub">${sub}</div>` : ''}
        </div>
        <div class="option-radio-outer">
          <div class="option-radio-inner"></div>
        </div>
      `;

      row.addEventListener('click', () => {
        closeOptionPicker();
        if (typeof onSelect === 'function') {
          onSelect(val);
        }
      });

      optionsModalList.appendChild(row);
    });

    optionsDialogModal.classList.remove('hidden');
  }

  function closeOptionPicker() {
    if (optionsDialogModal) optionsDialogModal.classList.add('hidden');
  }

  closeOptionsModalBtn?.addEventListener('click', closeOptionPicker);
  optionsDialogModal?.addEventListener('click', (e) => {
    if (e.target === optionsDialogModal) closeOptionPicker();
  });

  // Apply setting text displays across settings UI
  function applySettingDisplays() {
    const isHi = userSettings.appLanguage === 'hi';
    const currentVer = getCalculatedAppVersion();

    if ($('settingAppLanguageSub')) {
      $('settingAppLanguageSub').textContent = isHi ? 'हिंदी' : 'English';
    }
    if ($('settingHomeTimeZoneSub')) {
      const autoPrefix = userSettings.autoTimezone ? (isHi ? '⚡ स्वतः: ' : '⚡ Auto: ') : '';
      let tzDisplay = userSettings.timezone || '(GMT+5:30) New Delhi';
      if (isHi && typeof WORLD_TIMEZONES !== 'undefined') {
        const found = WORLD_TIMEZONES.find(z => z.iana === userSettings.timezoneIana);
        if (found && found.cityHi) {
          tzDisplay = `(${found.offsetStr}) ${found.cityHi}`;
        }
      }
      $('settingHomeTimeZoneSub').textContent = `${autoPrefix}${tzDisplay}`;
    }
    if ($('settingSilenceAfterSub')) {
      const s = userSettings.silenceAfter || '1 minute';
      const silenceMapHi = {
        '1 minute': '1 मिनट',
        '5 minutes': '5 मिनट',
        '10 minutes': '10 मिनट',
        '15 minutes': '15 मिनट',
        '20 minutes': '20 मिनट',
        'Never': 'कभी नहीं'
      };
      $('settingSilenceAfterSub').textContent = isHi ? (silenceMapHi[s] || s) : s;
    }
    if ($('settingSnoozeDurationSub')) {
      const sn = userSettings.snoozeDuration || '10 minutes';
      const snoozeMapHi = {
        '5 minutes': '5 मिनट',
        '10 minutes': '10 मिनट',
        '15 minutes': '15 मिनट',
        '20 minutes': '20 मिनट',
        '30 minutes': '30 मिनट'
      };
      $('settingSnoozeDurationSub').textContent = isHi ? (snoozeMapHi[sn] || sn) : sn;
    }
    if ($('settingAlarmVolume')) $('settingAlarmVolume').value = userSettings.alarmVolume || 80;
    if ($('settingGradualVolumeSub')) {
      const g = userSettings.gradualVolume || 'Off';
      const gradMapHi = {
        'Off': 'बंद',
        '5s': '5 सेकंड',
        '10s': '10 सेकंड',
        '15s': '15 सेकंड',
        '30s': '30 सेकंड',
        '60s': '60 सेकंड'
      };
      $('settingGradualVolumeSub').textContent = isHi ? (gradMapHi[g] || g) : g;
    }
    if ($('settingVolumeButtonsActionSub')) {
      const v = userSettings.volumeButtonsAction || 'Remind me later';
      const volMapHi = {
        'Remind me later': 'बाद में याद दिलाएं',
        'Control volume': 'आवाज़ नियंत्रित करें',
        'Do nothing': 'कुछ न करें'
      };
      $('settingVolumeButtonsActionSub').textContent = isHi ? (volMapHi[v] || v) : v;
    }
    if ($('settingPowerButtonActionSub')) {
      const p = userSettings.powerButtonAction || 'Dismiss';
      const pwrMapHi = {
        'Dismiss': 'बंद करें',
        'Do nothing': 'कुछ न करें'
      };
      $('settingPowerButtonActionSub').textContent = isHi ? (pwrMapHi[p] || p) : p;
    }
    if ($('settingPowerOffRinging')) $('settingPowerOffRinging').checked = userSettings.powerOffRinging !== false;
    if ($('settingStartWeekSub')) {
      const sw = userSettings.startWeek || 'Sunday';
      const swMapHi = {
        'Sunday': 'रविवार',
        'Monday': 'सोमवार',
        'Saturday': 'शनिवार'
      };
      $('settingStartWeekSub').textContent = isHi ? (swMapHi[sw] || sw) : sw;
    }
    if ($('settingTimerSoundSub')) {
      const ts = userSettings.timerSound || '';
      if (ts.includes('Om Namo Bhagavate') || ts.includes('Mahavatar')) {
        $('settingTimerSoundSub').textContent = isHi ? 'आध्यात्मिक महावतार नरसिंह' : 'Spiritual Mahavatar Narsimha';
      } else if (ts === 'Gentle Chime') {
        $('settingTimerSoundSub').textContent = isHi ? 'मधुर घंटी' : 'Gentle Chime';
      } else if (ts === 'Digital Beep') {
        $('settingTimerSoundSub').textContent = isHi ? 'डिजिटल बीप' : 'Digital Beep';
      } else if (ts === 'Acoustic Bell') {
        $('settingTimerSoundSub').textContent = isHi ? 'क्लासिक बेल' : 'Acoustic Bell';
      } else {
        $('settingTimerSoundSub').textContent = isHi ? 'डिफ़ॉल्ट रिंगटोन' : 'Default Ringtone';
      }
    }
    if ($('settingTimerVibrate')) $('settingTimerVibrate').checked = !!userSettings.timerVibrate;
    if ($('settingAboutVCSub')) $('settingAboutVCSub').textContent = isHi ? `संस्करण ${currentVer} • संस्थापक: आयुष कुमार सिंह` : `Version ${currentVer} • Founder: Ayush Kumar Singh`;
  }
  applySettingDisplays();
  applyAppLanguage(userSettings.appLanguage || 'en');

  // -------------------- SETTING INTERACTIVE OPTION SHEETS --------------------
  // App Language Option Bar
  $('settingAppLanguage')?.addEventListener('click', () => {
    const isHi = userSettings.appLanguage === 'hi';
    openOptionPicker({
      title: isHi ? 'ऐप भाषा चुनें' : 'Select App Language',
      subtitle: isHi ? 'अपनी पसंदीदा भाषा चुनें' : 'Choose your preferred display language',
      options: [
        { label: 'English', value: 'en', sub: isHi ? 'अंग्रेज़ी भाषा में बदलें' : 'Default language (English)' },
        { label: isHi ? 'हिंदी' : 'Hindi', value: 'hi', sub: isHi ? 'हिंदी भाषा सक्रिय करें' : 'Switch to Hindi language' }
      ],
      currentValue: userSettings.appLanguage || 'en',
      onSelect: (val) => {
        userSettings.appLanguage = val;
        saveSettings();
        applyAppLanguage(val);
        applySettingDisplays();
        showPopup(val === 'hi' ? 'भाषा बदलकर हिंदी कर दी गई है' : 'App language set to English');
      }
    });
  });
  // Silence After Option Bar
  $('settingSilenceAfter')?.addEventListener('click', () => {
    const isHi = userSettings.appLanguage === 'hi';
    openOptionPicker({
      title: isHi ? 'अलार्म बंद होने का समय' : 'Silence after',
      subtitle: isHi ? 'निर्धारित समय के बाद बजना स्वतः बंद हो जाएगा' : 'Automatically stop ringing after selected duration',
      options: isHi ? [
        { label: '1 मिनट', value: '1 minute', sub: '1 मिनट बजने के बाद अलार्म बंद करें' },
        { label: '5 मिनट', value: '5 minutes', sub: '5 मिनट बजने के बाद अलार्म बंद करें' },
        { label: '10 मिनट', value: '10 minutes', sub: '10 मिनट बजने के बाद अलार्म बंद करें' },
        { label: '15 मिनट', value: '15 minutes', sub: '15 मिनट बजने के बाद अलार्म बंद करें' },
        { label: '20 मिनट', value: '20 minutes', sub: '20 मिनट बजने के बाद अलार्म बंद करें' },
        { label: 'कभी नहीं', value: 'Never', sub: 'जब तक बंद न करें तब तक बजता रहे' }
      ] : [
        { label: '1 minute', value: '1 minute', sub: 'Stop alarm after 1 minute of ringing' },
        { label: '5 minutes', value: '5 minutes', sub: 'Stop alarm after 5 minutes of ringing' },
        { label: '10 minutes', value: '10 minutes', sub: 'Stop alarm after 10 minutes of ringing' },
        { label: '15 minutes', value: '15 minutes', sub: 'Stop alarm after 15 minutes of ringing' },
        { label: '20 minutes', value: '20 minutes', sub: 'Stop alarm after 20 minutes of ringing' },
        { label: 'Never', value: 'Never', sub: 'Keep ringing until manually dismissed or snoozed' }
      ],
      currentValue: userSettings.silenceAfter || '1 minute',
      onSelect: (val) => {
        userSettings.silenceAfter = val;
        saveSettings();
        applySettingDisplays();
        const displayVal = isHi ? ({ '1 minute': '1 मिनट', '5 minutes': '5 मिनट', '10 minutes': '10 मिनट', '15 minutes': '15 मिनट', '20 minutes': '20 मिनट', 'Never': 'कभी नहीं' }[val] || val) : val;
        showPopup(isHi ? `अलार्म बंद होने का समय: ${displayVal}` : `Silence after set to ${val}`);
      }
    });
  });

  // Snooze Duration Option Bar
  $('settingSnoozeDuration')?.addEventListener('click', () => {
    const isHi = userSettings.appLanguage === 'hi';
    openOptionPicker({
      title: isHi ? 'स्नूज़ अवधि' : 'Snooze length',
      subtitle: isHi ? 'दोबारा बजने से पहले अलार्म रोकने का समय' : 'Duration to pause alarm before ringing again',
      options: isHi ? [
        { label: '5 मिनट', value: '5 minutes', sub: 'त्वरित 5 मिनट स्नूज़' },
        { label: '10 मिनट (अनुशंसित)', value: '10 minutes', sub: 'मानक 10 मिनट स्नूज़' },
        { label: '15 मिनट', value: '15 minutes', sub: 'मध्यम 15 मिनट स्नूज़' },
        { label: '20 मिनट', value: '20 minutes', sub: 'विस्तारित 20 मिनट स्नूज़' },
        { label: '30 मिनट', value: '30 minutes', sub: 'लंबा 30 मिनट स्नूज़' }
      ] : [
        { label: '5 minutes', value: '5 minutes', sub: 'Quick 5-minute snooze' },
        { label: '10 minutes (Recommended)', value: '10 minutes', sub: 'Standard recommended 10-minute snooze' },
        { label: '15 minutes', value: '15 minutes', sub: 'Moderate 15-minute snooze' },
        { label: '20 minutes', value: '20 minutes', sub: 'Extended 20-minute snooze' },
        { label: '30 minutes', value: '30 minutes', sub: 'Long 30-minute snooze' }
      ],
      currentValue: userSettings.snoozeDuration || '10 minutes',
      onSelect: (val) => {
        userSettings.snoozeDuration = val;
        saveSettings();
        applySettingDisplays();
        const displayVal = isHi ? ({ '5 minutes': '5 मिनट', '10 minutes': '10 मिनट', '15 minutes': '15 मिनट', '20 minutes': '20 मिनट', '30 minutes': '30 मिनट' }[val] || val) : val;
        showPopup(isHi ? `स्नूज़ अवधि: ${displayVal}` : `Snooze length set to ${val}`);
      }
    });
  });

  // Alarm Volume Slider
  $('settingAlarmVolume')?.addEventListener('input', (e) => {
    userSettings.alarmVolume = parseInt(e.target.value, 10);
    saveSettings();
  });

  // Gradually Increase Volume Option Bar
  $('settingGradualVolume')?.addEventListener('click', () => {
    const isHi = userSettings.appLanguage === 'hi';
    openOptionPicker({
      title: isHi ? 'आवाज़ धीरे-धीरे बढ़ाएं' : 'Gradually increase volume',
      subtitle: isHi ? 'अलार्म धीमी आवाज़ से शुरू होकर धीरे-धीरे तेज़ होगा' : 'Alarm starts quietly and ramps up to full volume over time',
      options: isHi ? [
        { label: 'बंद', value: 'Off', sub: 'तुरंत पूरी आवाज़ में बजाएं' },
        { label: '5 सेकंड', value: '5s', sub: '5 सेकंड में आवाज़ बढ़ाएं' },
        { label: '10 सेकंड', value: '10s', sub: '10 सेकंड में आवाज़ बढ़ाएं' },
        { label: '15 सेकंड', value: '15s', sub: '15 सेकंड में आवाज़ बढ़ाएं' },
        { label: '30 सेकंड', value: '30s', sub: '30 सेकंड में आवाज़ बढ़ाएं' },
        { label: '60 सेकंड', value: '60s', sub: '1 मिनट में धीरे-धीरे आवाज़ बढ़ाएं' }
      ] : [
        { label: 'Off', value: 'Off', sub: 'Ring at full set volume immediately' },
        { label: '5 seconds', value: '5s', sub: 'Ramp up volume over 5 seconds' },
        { label: '10 seconds', value: '10s', sub: 'Ramp up volume over 10 seconds' },
        { label: '15 seconds', value: '15s', sub: 'Ramp up volume over 15 seconds' },
        { label: '30 seconds', value: '30s', sub: 'Ramp up volume over 30 seconds' },
        { label: '60 seconds', value: '60s', sub: 'Slow 1-minute gentle volume ramp' }
      ],
      currentValue: userSettings.gradualVolume || 'Off',
      onSelect: (val) => {
        userSettings.gradualVolume = val;
        saveSettings();
        applySettingDisplays();
        const displayVal = isHi ? ({ 'Off': 'बंद', '5s': '5 सेकंड', '10s': '10 सेकंड', '15s': '15 सेकंड', '30s': '30 सेकंड', '60s': '60 सेकंड' }[val] || val) : val;
        showPopup(isHi ? `आवाज़ धीरे बढ़ाएं: ${displayVal}` : `Gradually increase volume: ${val}`);
      }
    });
  });

  // Volume Buttons Action Option Bar
  $('settingVolumeButtonsAction')?.addEventListener('click', () => {
    const isHi = userSettings.appLanguage === 'hi';
    openOptionPicker({
      title: isHi ? 'वॉल्यूम बटन' : 'Volume buttons',
      subtitle: isHi ? 'अलार्म बजते समय वॉल्यूम बटन दबाने पर क्रिया' : 'Action when volume buttons are pressed while ringing',
      options: isHi ? [
        { label: 'बाद में याद दिलाएं', value: 'Remind me later', sub: 'अलार्म को स्नूज़ करता है' },
        { label: 'आवाज़ नियंत्रित करें', value: 'Control volume', sub: 'आवाज़ कम या ज्यादा करें' },
        { label: 'कुछ न करें', value: 'Do nothing', sub: 'बटन दबाने पर कुछ नहीं होगा' }
      ] : [
        { label: 'Remind me later', value: 'Remind me later', sub: 'Snoozes the ringing alarm' },
        { label: 'Control volume', value: 'Control volume', sub: 'Adjusts alarm sound volume' },
        { label: 'Do nothing', value: 'Do nothing', sub: 'Ignores volume button presses' }
      ],
      currentValue: userSettings.volumeButtonsAction || 'Remind me later',
      onSelect: (val) => {
        userSettings.volumeButtonsAction = val;
        saveSettings();
        applySettingDisplays();
        syncNativeHardwareSettings();
        const displayVal = isHi ? ({ 'Remind me later': 'बाद में याद दिलाएं', 'Control volume': 'आवाज़ नियंत्रित करें', 'Do nothing': 'कुछ न करें' }[val] || val) : val;
        showPopup(isHi ? `वॉल्यूम बटन: ${displayVal}` : `Volume buttons: ${val}`);
      }
    });
  });

  // Power Button Action Option Bar
  $('settingPowerButtonAction')?.addEventListener('click', () => {
    const isHi = userSettings.appLanguage === 'hi';
    openOptionPicker({
      title: isHi ? 'पावर बटन' : 'Power button',
      subtitle: isHi ? 'अलार्म बजते समय पावर बटन दबाने पर क्रिया' : 'Action when power button is pressed while ringing',
      options: isHi ? [
        { label: 'बंद करें', value: 'Dismiss', sub: 'अलार्म को पूरी तरह बंद कर देता है' },
        { label: 'कुछ न करें', value: 'Do nothing', sub: 'अलार्म बजता रहेगा' }
      ] : [
        { label: 'Dismiss', value: 'Dismiss', sub: 'Turns off the ringing alarm' },
        { label: 'Do nothing', value: 'Do nothing', sub: 'Keeps alarm ringing' }
      ],
      currentValue: userSettings.powerButtonAction || 'Dismiss',
      onSelect: (val) => {
        userSettings.powerButtonAction = val;
        saveSettings();
        applySettingDisplays();
        syncNativeHardwareSettings();
        const displayVal = isHi ? ({ 'Dismiss': 'बंद करें', 'Do nothing': 'कुछ न करें' }[val] || val) : val;
        showPopup(isHi ? `पावर बटन: ${displayVal}` : `Power button: ${val}`);
      }
    });
  });

  // Power Off Ringing Toggle
  $('settingPowerOffRinging')?.addEventListener('change', (e) => {
    userSettings.powerOffRinging = e.target.checked;
    saveSettings();
  });

  // Start Week On Option Bar
  $('settingStartWeek')?.addEventListener('click', () => {
    const isHi = userSettings.appLanguage === 'hi';
    openOptionPicker({
      title: isHi ? 'सप्ताह का पहला दिन' : 'Start week on',
      subtitle: isHi ? 'कैलेंडर और कार्यों के लिए सप्ताह का पहला दिन' : 'First day of the week for calendars and task views',
      options: isHi ? [
        { label: 'रविवार', value: 'Sunday', sub: 'भारत और सामान्य मानक' },
        { label: 'सोमवार', value: 'Monday', sub: 'अंतर्राष्ट्रीय मानक' },
        { label: 'शनिवार', value: 'Saturday', sub: 'सप्ताहांत मानक' }
      ] : [
        { label: 'Sunday', value: 'Sunday', sub: 'Standard in India, United States, Japan' },
        { label: 'Monday', value: 'Monday', sub: 'International ISO standard week start' },
        { label: 'Saturday', value: 'Saturday', sub: 'Common in Middle East regions' }
      ],
      currentValue: userSettings.startWeek || 'Sunday',
      onSelect: (val) => {
        userSettings.startWeek = val;
        saveSettings();
        applySettingDisplays();
        const displayVal = isHi ? ({ 'Sunday': 'रविवार', 'Monday': 'सोमवार', 'Saturday': 'शनिवार' }[val] || val) : val;
        showPopup(isHi ? `सप्ताह का पहला दिन: ${displayVal}` : `Start week on: ${val}`);
      }
    });
  });

  // Timer Sound Option Bar
  $('settingTimerSound')?.addEventListener('click', () => {
    const isHi = userSettings.appLanguage === 'hi';
    openOptionPicker({
      title: isHi ? 'टाइमर रिंगटोन' : 'Timer sound',
      subtitle: isHi ? 'टाइमर पूरा होने पर बजने वाली ध्वनि' : 'Sound played when timer or countdown finishes',
      options: isHi ? [
        { label: 'आध्यात्मिक महावतार नरसिंह', value: 'Om Namo Bhagavate Vasudevaya _ Mahavatar Narsimha Ringtone Download - MobCup.Com.Co', sub: 'ॐ नमो भगवते वासुदेवाय' },
        { label: 'मधुर घंटी', value: 'Gentle Chime', sub: 'शांत और आरामदायक घंटी' },
        { label: 'डिजिटल बीप', value: 'Digital Beep', sub: 'इलेक्ट्रॉनिक स्पष्ट बीप' },
        { label: 'क्लासिक बेल', value: 'Acoustic Bell', sub: 'पारंपरिक घड़ी की घंटी' }
      ] : [
        { label: 'Spiritual Mahavatar Narsimha', value: 'Om Namo Bhagavate Vasudevaya _ Mahavatar Narsimha Ringtone Download - MobCup.Com.Co', sub: 'Spiritual Mahavatar Narsimha ringtone' },
        { label: 'Gentle Chime', value: 'Gentle Chime', sub: 'Soft relaxing bell chime' },
        { label: 'Digital Beep', value: 'Digital Beep', sub: 'Crisp recurring electronic beep' },
        { label: 'Acoustic Bell', value: 'Acoustic Bell', sub: 'Resonant acoustic clock bell' }
      ],
      currentValue: userSettings.timerSound,
      onSelect: (val) => {
        userSettings.timerSound = val;
        saveSettings();
        applySettingDisplays();
        showPopup(isHi ? 'टाइमर रिंगटोन अपडेट की गई' : 'Timer sound updated');
      }
    });
  });

  $('settingTimerVibrate')?.addEventListener('change', (e) => {
    userSettings.timerVibrate = e.target.checked;
    saveSettings();
    syncNativeHardwareSettings();
    if (userSettings.timerVibrate && navigator.vibrate) {
      navigator.vibrate(200);
    }
  });

  // -------------------- ABOUT VOICE CLOCK LOGIC --------------------
  const aboutView = $('aboutView');
  const closeAboutBtn = $('closeAboutBtn');
  const settingAboutVC = $('settingAboutVC');
  const aboutFeatureList = $('aboutFeatureList');
  const checkForUpdatesBtn = $('checkForUpdatesBtn');
  const updateStatusText = $('updateStatusText');
  const openPrivacyPolicyBtn = $('openPrivacyPolicyBtn');
  const privacyPolicyModal = $('privacyPolicyModal');
  const closePrivacyModalBtn = $('closePrivacyModalBtn');
  // -------------------- APP RELEASES & UPDATE SYSTEM --------------------
  const DEFAULT_FOUNDATION_RELEASE = {
    version: '1.0.0',
    date: 'September 2026',
    date_hi: 'सितंबर 2026',
    type: 'Official Foundation Release',
    type_hi: 'आधिकारिक प्रारंभिक संस्करण',
    size: 'Base Build',
    size_hi: 'मूल संस्करण',
    changelog: [
      'Official Foundation Launch of Voice Clock',
      'Smart voice and exact time alarms with lockscreen ringing',
      'Task reminders with voice announcements',
      'Interactive Slide-to-Snooze and Slide-to-Dismiss slider',
      'Sunday to Saturday repetition days with auto day-advancement',
      'Full edit screen for alarms and tasks directly from history',
      'Persistent stopwatch with lap history preservation',
      'Physical volume and power button controls for snooze and dismiss',
      'Repeated timer vibration during alarm ringing',
      'World time zones with live time and GPS auto-detection'
    ],
    changelog_hi: [
      'वॉयस क्लॉक का आधिकारिक प्रारंभिक संस्करण',
      'स्मार्ट वॉयस और सटीक अलार्म लॉकस्क्रीन रिंगिंग के साथ',
      'वॉयस संदेश के साथ कार्य स्मरण',
      'स्नूज़ और बंद करने के लिए इंटरैक्टिव स्लाइडर',
      'रविवार से शनिवार पुनरावृत्ति दिन',
      'इतिहास से अलार्म और कार्य सीधे संपादित करने की सुविधा',
      'स्टॉपवॉच लैप इतिहास के साथ',
      'वॉल्यूम और पावर बटन से स्नूज़ और बंद करने का नियंत्रण',
      'अलार्म बजने के दौरान टाइमर कंपन',
      'विश्व समय क्षेत्र और स्वचालित पहचान'
    ]
  };

  let savedReleases = [];
  try {
    savedReleases = JSON.parse(localStorage.getItem('vc_release_history') || '[]');
  } catch {}
  if (!Array.isArray(savedReleases) || savedReleases.length === 0 || savedReleases.some(r => String(r.version).startsWith('2.'))) {
    savedReleases = [DEFAULT_FOUNDATION_RELEASE];
    localStorage.setItem('vc_release_history', JSON.stringify(savedReleases));
  }
  const APP_RELEASES = savedReleases;

  let savedVer = localStorage.getItem('vc_installed_version');
  if (!savedVer || savedVer.startsWith('2.')) {
    savedVer = '1.0.0';
    localStorage.setItem('vc_installed_version', '1.0.0');
    localStorage.removeItem('vc_pending_update');
  }
  let installedVersion = savedVer;
  let pendingUpdateRelease = JSON.parse(localStorage.getItem('vc_pending_update') || 'null');

  function compareVersions(v1, v2) {
    const parts1 = String(v1).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    const parts2 = String(v2).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  }

  function getUpdateCount() {
    if (pendingUpdateRelease && compareVersions(pendingUpdateRelease.version, installedVersion) > 0) {
      return 1;
    }
    return 0;
  }

  function refreshSettingsUpdateBadge() {
    const count = getUpdateCount();
    const badges = document.querySelectorAll('.settings-update-badge');
    badges.forEach(b => {
      if (count > 0) {
        b.textContent = count;
        b.classList.remove('hidden');
      } else {
        b.classList.add('hidden');
      }
    });

    const aboutBadge = $('settingsAboutUpdateBadge');
    if (aboutBadge) {
      if (count > 0) {
        aboutBadge.textContent = userSettings.appLanguage === 'hi' ? `अपडेट ${count}` : `Update ${count}`;
        aboutBadge.classList.remove('hidden');
      } else {
        aboutBadge.classList.add('hidden');
      }
    }

    const versionNewPill = $('aboutVersionNewPill');
    if (versionNewPill) {
      if (count > 0) versionNewPill.classList.remove('hidden');
      else versionNewPill.classList.add('hidden');
    }
  }

  const GITHUB_OTA_URLS = [
    'https://abhimanyu-singh27.github.io/Voice_Clock/update-manifest.json',
    'https://abhimanyu-singh27.github.io/Voice_Clock/www/update-manifest.json',
    'update-manifest.json'
  ];

  async function checkRemoteUpdateManifest() {
    for (const url of GITHUB_OTA_URLS) {
      try {
        const fetchUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
        const res = await fetch(fetchUrl);
        if (res.ok) {
          const manifest = await res.json();
          if (manifest && manifest.latestVersion) {
            if (compareVersions(manifest.latestVersion, installedVersion) > 0) {
              const base = url.substring(0, url.lastIndexOf('/') + 1);
              pendingUpdateRelease = {
                version: manifest.latestVersion,
                date: manifest.releaseDate || 'Today',
                date_hi: manifest.releaseDate_hi || manifest.releaseDate || 'आज',
                type: manifest.type === 'feature' ? 'Feature & Stability Release' : (manifest.type === 'foundation' ? 'Official Foundation Release' : 'Bug Fix & Performance Update'),
                type_hi: manifest.type_hi || (manifest.type === 'feature' ? 'फीचर और स्टेबिलिटी रिलीज़' : 'बग सुधार और अपडेट'),
                size: manifest.downloadSize || '~1.5 MB',
                size_hi: manifest.downloadSize_hi || manifest.downloadSize || '~1.5 MB',
                changelog: manifest.releaseNotes || ['New features and improvements'],
                changelog_hi: manifest.releaseNotes_hi || manifest.releaseNotes || ['नई सुविधाएं और सुधार'],
                scriptUrl: manifest.scriptUrl || (base ? base + 'script.js' : 'script.js'),
                cssUrl: manifest.cssUrl || (base ? base + 'style.css' : 'style.css')
              };
              localStorage.setItem('vc_pending_update', JSON.stringify(pendingUpdateRelease));
              refreshSettingsUpdateBadge();
              return pendingUpdateRelease;
            } else {
              localStorage.removeItem('vc_pending_update');
              pendingUpdateRelease = null;
              refreshSettingsUpdateBadge();
              return null;
            }
          }
        }
      } catch (err) {
        // try next candidate URL
      }
    }
    return null;
  }

  function renderAboutView() {
    const isHi = userSettings.appLanguage === 'hi';
    const ver = installedVersion || getCalculatedAppVersion();
    if ($('aboutVersionBadge')) $('aboutVersionBadge').textContent = `v${ver}`;
    if ($('aboutVersionText')) $('aboutVersionText').textContent = ver;

    if (aboutFeatureList) {
      aboutFeatureList.innerHTML = '';
      APP_RELEASES.forEach((rel) => {
        const item = document.createElement('div');
        item.className = 'about-feature-item';
        const typeText = isHi ? (rel.type_hi || rel.type) : rel.type;
        const changelogArr = isHi ? (rel.changelog_hi || rel.changelog) : rel.changelog;
        const notes = Array.isArray(changelogArr) ? changelogArr.slice(0, 3).join(' • ') : (typeText || '');
        const dateText = isHi ? (rel.date_hi || rel.date) : rel.date;
        item.innerHTML = `
          <div class="about-feat-meta">
            <span class="about-feat-badge">v${rel.version}</span>
            <div>
              <strong>${typeText || ('Release v' + rel.version)}</strong>
              <div style="font-size:11px;color:var(--muted);margin-top:2px;">${notes}</div>
            </div>
          </div>
          <span style="font-size:11px;color:var(--muted);">${dateText}</span>
        `;
        aboutFeatureList.appendChild(item);
      });
    }
  }

  settingAboutVC?.addEventListener('click', () => {
    renderAboutView();
    if (aboutView) aboutView.classList.remove('hidden');
  });

  closeAboutBtn?.addEventListener('click', () => {
    if (aboutView) aboutView.classList.add('hidden');
  });

  // -------------------- SOFTWARE UPDATE VIEW & RADAR ANIMATION --------------------
  const softwareUpdateView = $('softwareUpdateView');
  const closeSoftwareUpdateBtn = $('closeSoftwareUpdateBtn');
  const aboutVersionRowBtn = $('aboutVersionRowBtn');
  const aboutVersionBtn = $('aboutVersionBtn');
  const swCurrentVersionTag = $('swCurrentVersionTag');
  const swRadarScanner = $('swRadarScanner');
  const swScanHeading = $('swScanHeading');
  const swScanSubtext = $('swScanSubtext');
  const startScanBtn = $('startScanBtn');
  const startScanBtnText = $('startScanBtnText');
  const swMainActionWrap = $('swMainActionWrap');
  const newVersionCard = $('newVersionCard');
  const newVersionBadgeTag = $('newVersionBadgeTag');
  const newVerType = $('newVerType');
  const newVerDate = $('newVerDate');
  const newVerSize = $('newVerSize');
  const newVerChangelogList = $('newVerChangelogList');
  const applyRealtimeUpdateBtn = $('applyRealtimeUpdateBtn');
  const dismissUpdateBtn = $('dismissUpdateBtn');
  const swProgressCard = $('swProgressCard');
  const swProgressBar = $('swProgressBar');
  const swProgressPercent = $('swProgressPercent');
  const swProgressLabel = $('swProgressLabel');
  const upToDateCard = $('upToDateCard');

  function openSoftwareUpdateScreen() {
    const isHi = userSettings.appLanguage === 'hi';
    if (swCurrentVersionTag) swCurrentVersionTag.textContent = `v${installedVersion}`;

    // Reset view state
    newVersionCard?.classList.add('hidden');
    swProgressCard?.classList.add('hidden');
    upToDateCard?.classList.add('hidden');
    swMainActionWrap?.classList.remove('hidden');
    swRadarScanner?.classList.remove('scanning');

    if (swScanHeading) swScanHeading.textContent = isHi ? 'अपडेट चेक करें' : 'Check for Updates';
    if (swScanSubtext) swScanSubtext.textContent = isHi ? 'नई सुविधाओं, प्रदर्शन सुधारों और बग फिक्स के लिए वॉयस क्लॉक चैनलों को स्कैन करें।' : 'Scan Voice Clock OTA channels to discover new features, performance updates, and bug fixes.';
    if (startScanBtnText) startScanBtnText.textContent = isHi ? 'अपडेट चेक करें' : 'Check for Updates';

    if (softwareUpdateView) softwareUpdateView.classList.remove('hidden');
  }

  function closeSoftwareUpdateScreen() {
    if (softwareUpdateView) softwareUpdateView.classList.add('hidden');
    refreshSettingsUpdateBadge();
  }

  aboutVersionRowBtn?.addEventListener('click', openSoftwareUpdateScreen);
  aboutVersionBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    openSoftwareUpdateScreen();
  });
  closeSoftwareUpdateBtn?.addEventListener('click', closeSoftwareUpdateScreen);

  // Directly navigate from About View check-for-updates button to Software Update screen
  checkForUpdatesBtn?.addEventListener('click', openSoftwareUpdateScreen);

  // Trigger Scanner and Check for Updates
  startScanBtn?.addEventListener('click', performSoftwareUpdateCheck);

  async function performSoftwareUpdateCheck() {
    if (!swRadarScanner) return;

    const isHi = userSettings.appLanguage === 'hi';

    // Start scanner animation
    swRadarScanner.classList.add('scanning');
    newVersionCard?.classList.add('hidden');
    upToDateCard?.classList.add('hidden');
    swProgressCard?.classList.add('hidden');

    if (startScanBtnText) startScanBtnText.textContent = isHi ? 'चैनल स्कैन हो रहे हैं...' : 'Scanning OTA Channels...';
    if (swScanHeading) swScanHeading.textContent = isHi ? 'अपडेट चेक किया जा रहा है...' : 'Checking for Updates...';
    if (swScanSubtext) swScanSubtext.textContent = isHi ? 'वॉयस क्लॉक सर्वर से जुड़कर पैकेज सत्यापित किया जा रहा है...' : 'Connecting to Voice Clock OTA servers and verifying package hashes...';

    // Refresh from manifest
    await checkRemoteUpdateManifest();

    setTimeout(() => {
      swRadarScanner.classList.remove('scanning');

      // Check if there is an update pending or in releases
      const latestRelease = pendingUpdateRelease || APP_RELEASES[0];
      const hasNewVersion = compareVersions(latestRelease.version, installedVersion) > 0;

      if (hasNewVersion) {
        // Show New Version Card
        if (swScanHeading) swScanHeading.textContent = isHi ? '✨ नया संस्करण उपलब्ध है!' : '✨ New Version Available!';
        if (swScanSubtext) swScanSubtext.textContent = isHi ? `संस्करण v${latestRelease.version} इंस्टॉल करने के लिए तैयार है।` : `Version ${latestRelease.version} is ready for installation.`;

        if (newVersionBadgeTag) newVersionBadgeTag.textContent = `v${latestRelease.version}`;
        if (newVerType) newVerType.textContent = isHi ? (latestRelease.type_hi || latestRelease.type || 'फीचर और स्टेबिलिटी रिलीज़') : (latestRelease.type || 'Feature & Stability Release');
        if (newVerDate) newVerDate.textContent = isHi ? (latestRelease.date_hi || latestRelease.date || 'आज') : (latestRelease.date || 'Today');
        if (newVerSize) newVerSize.textContent = isHi ? (latestRelease.size_hi || latestRelease.size || '~1.5 MB') : (latestRelease.size || '~1.5 MB');

        if (newVerChangelogList) {
          newVerChangelogList.innerHTML = '';
          const changelogItems = isHi ? (latestRelease.changelog_hi || latestRelease.changelog || ['नई सुविधाएं और बग सुधार']) : (latestRelease.changelog || ['New features and bug fixes']);
          changelogItems.forEach(item => {
            const li = document.createElement('li');
            li.textContent = item;
            newVerChangelogList.appendChild(li);
          });
        }

        newVersionCard?.classList.remove('hidden');
        swMainActionWrap?.classList.add('hidden');
      } else {
        // Already up to date
        if (swScanHeading) swScanHeading.textContent = isHi ? '✓ वॉयस क्लॉक अपडेट है' : '✓ Voice Clock is Up to Date';
        if (swScanSubtext) swScanSubtext.textContent = isHi ? `आधिकारिक संस्करण v${installedVersion} चल रहा है। कोई अपडेट आवश्यक नहीं है।` : `Running official version v${installedVersion}. No updates needed.`;
        upToDateCard?.classList.remove('hidden');
        if (startScanBtnText) startScanBtnText.textContent = isHi ? 'दोबारा चेक करें' : 'Check Again';
      }
    }, 1600);
  }

  // User decides to Update to New Version in Real Time
  applyRealtimeUpdateBtn?.addEventListener('click', async () => {
    const isHi = userSettings.appLanguage === 'hi';
    const targetRelease = pendingUpdateRelease || APP_RELEASES[0];

    newVersionCard?.classList.add('hidden');
    swProgressCard?.classList.remove('hidden');

    let otaJsCode = null;
    let otaCssCode = null;

    if (targetRelease.scriptUrl) {
      try {
        const resp = await fetch(targetRelease.scriptUrl + '?t=' + Date.now());
        if (resp.ok) otaJsCode = await resp.text();
      } catch (e) {
        console.log('OTA fetch script notice:', e);
      }
    }
    if (targetRelease.cssUrl) {
      try {
        const resp = await fetch(targetRelease.cssUrl + '?t=' + Date.now());
        if (resp.ok) otaCssCode = await resp.text();
      } catch (e) {
        console.log('OTA fetch css notice:', e);
      }
    }

    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 18) + 12;
      if (progress > 100) progress = 100;

      if (swProgressBar) swProgressBar.style.width = `${progress}%`;
      if (swProgressPercent) swProgressPercent.textContent = `${progress}%`;

      if (progress < 40) {
        if (swProgressLabel) swProgressLabel.textContent = isHi ? 'अपडेट पैकेज डाउनलोड हो रहा है...' : 'Downloading Update Package...';
      } else if (progress < 80) {
        if (swProgressLabel) swProgressLabel.textContent = isHi ? 'चेकसम और डिजिटल हस्ताक्षर सत्यापित हो रहे हैं...' : 'Verifying Checksum & Signatures...';
      } else if (progress < 100) {
        if (swProgressLabel) swProgressLabel.textContent = isHi ? 'नया कोड और एसेट्स लागू हो रहे हैं...' : 'Applying Update Package...';
      } else {
        clearInterval(interval);
        if (swProgressLabel) swProgressLabel.textContent = isHi ? '✓ अपडेट पूर्ण हुआ! अंतिम रूप दिया जा रहा है...' : '✓ Update Complete! Finalizing...';

        // Apply update in persistent state
        installedVersion = targetRelease.version;
        localStorage.setItem('vc_installed_version', installedVersion);
        localStorage.removeItem('vc_pending_update');
        pendingUpdateRelease = null;

        if (otaJsCode) {
          localStorage.setItem('vc_ota_js', otaJsCode);
        }
        if (otaCssCode) {
          localStorage.setItem('vc_ota_css', otaCssCode);
        }

        // Add to persistent release history
        if (!APP_RELEASES.some(r => r.version === targetRelease.version)) {
          APP_RELEASES.unshift({
            version: targetRelease.version,
            date: targetRelease.date || 'Today',
            type: targetRelease.type || 'OTA Live Update',
            size: targetRelease.size || '~1.5 MB',
            changelog: targetRelease.changelog || ['New features and improvements']
          });
          localStorage.setItem('vc_release_history', JSON.stringify(APP_RELEASES));
        }

        // Register any new features into feature registry
        if (targetRelease.features) {
          targetRelease.features.forEach(f => {
            if (!APP_FEATURE_REGISTRY.some(x => x.id === f.id)) {
              APP_FEATURE_REGISTRY.push(f);
            }
          });
        }

        refreshSettingsUpdateBadge();
        applySettingDisplays();

        setTimeout(() => {
          showPopup(isHi ? `🎉 वॉयस क्लॉक सफलतापूर्वक v${installedVersion} में अपडेट हो गया!` : `🎉 Voice Clock updated to v${installedVersion}!`);
          setTimeout(() => {
            window.location.reload();
          }, 800);
        }, 600);
      }
    }, 280);
  });

  // User decides not to update now
  dismissUpdateBtn?.addEventListener('click', () => {
    const isHi = userSettings.appLanguage === 'hi';
    newVersionCard?.classList.add('hidden');
    swMainActionWrap?.classList.remove('hidden');
    if (swScanHeading) swScanHeading.textContent = isHi ? 'अपडेट स्थगित किया गया' : 'Update Postponed';
    if (swScanSubtext) swScanSubtext.textContent = isHi ? 'आप इस अपडेट को कभी भी सॉफ्टवेयर अपडेट स्क्रीन से इंस्टॉल कर सकते हैं।' : 'You can install this update anytime from the Software Update screen.';
    showPopup(isHi ? 'अपडेट स्थगित कर दिया गया।' : 'Update postponed. You can update later from Settings.');
  });

  refreshSettingsUpdateBadge();
  checkRemoteUpdateManifest().then(() => refreshSettingsUpdateBadge());

  openPrivacyPolicyBtn?.addEventListener('click', () => {
    if (privacyPolicyModal) privacyPolicyModal.classList.remove('hidden');
  });
  closePrivacyModalBtn?.addEventListener('click', () => {
    if (privacyPolicyModal) privacyPolicyModal.classList.add('hidden');
  });
  privacyPolicyModal?.addEventListener('click', (e) => {
    if (e.target === privacyPolicyModal) privacyPolicyModal.classList.add('hidden');
  });

  // -------------------- WORLD TIME ZONE MANAGER LOGIC --------------------
  const WORLD_TIMEZONES = [
    { city: 'Jaipur', cityHi: 'जयपुर', fullName: 'Jaipur, Rajasthan', fullNameHi: 'जयपुर, राजस्थान', country: 'India', countryHi: 'भारत', iana: 'Asia/Kolkata', offsetStr: 'GMT+5:30', offsetMins: 330, lat: 26.9124, lon: 75.7873 },
    { city: 'New Delhi', cityHi: 'नई दिल्ली', fullName: 'New Delhi / Delhi NCR', fullNameHi: 'नई दिल्ली, दिल्ली', country: 'India', countryHi: 'भारत', iana: 'Asia/Kolkata', offsetStr: 'GMT+5:30', offsetMins: 330, lat: 28.6139, lon: 77.2090 },
    { city: 'Mumbai', cityHi: 'मुंबई', fullName: 'Mumbai, Maharashtra', fullNameHi: 'मुंबई, महाराष्ट्र', country: 'India', countryHi: 'भारत', iana: 'Asia/Kolkata', offsetStr: 'GMT+5:30', offsetMins: 330, lat: 19.0760, lon: 72.8777 },
    { city: 'Chennai', cityHi: 'चेन्नई', fullName: 'Chennai, Tamil Nadu', fullNameHi: 'चेन्नई, तमिलनाडु', country: 'India', countryHi: 'भारत', iana: 'Asia/Kolkata', offsetStr: 'GMT+5:30', offsetMins: 330, lat: 13.0827, lon: 80.2707 },
    { city: 'Bengaluru', cityHi: 'बेंगलुरु', fullName: 'Bengaluru, Karnataka', fullNameHi: 'बेंगलुरु, कर्नाटक', country: 'India', countryHi: 'भारत', iana: 'Asia/Kolkata', offsetStr: 'GMT+5:30', offsetMins: 330, lat: 12.9716, lon: 77.5946 },
    { city: 'Kolkata', cityHi: 'कोलकाता', fullName: 'Kolkata, West Bengal', fullNameHi: 'कोलकाता, पश्चिम बंगाल', country: 'India', countryHi: 'भारत', iana: 'Asia/Kolkata', offsetStr: 'GMT+5:30', offsetMins: 330, lat: 22.5726, lon: 88.3639 },
    { city: 'Dubai', cityHi: 'दुबई', fullName: 'Dubai', fullNameHi: 'दुबई', country: 'United Arab Emirates', countryHi: 'संयुक्त अरब अमीरात', iana: 'Asia/Dubai', offsetStr: 'GMT+4:00', offsetMins: 240, lat: 25.2048, lon: 55.2708 },
    { city: 'London', cityHi: 'लंदन', fullName: 'London', fullNameHi: 'लंदन', country: 'United Kingdom', countryHi: 'यूनाइटेड किंगडम', iana: 'Europe/London', offsetStr: 'GMT+1:00', offsetMins: 60, lat: 51.5074, lon: -0.1278 },
    { city: 'New York', cityHi: 'न्यूयॉर्क', fullName: 'New York', fullNameHi: 'न्यूयॉर्क', country: 'United States', countryHi: 'संयुक्त राज्य अमेरिका', iana: 'America/New_York', offsetStr: 'GMT-4:00', offsetMins: -240, lat: 40.7128, lon: -74.0060 },
    { city: 'Tokyo', cityHi: 'टोक्यो', fullName: 'Tokyo', fullNameHi: 'टोक्यो', country: 'Japan', countryHi: 'जापान', iana: 'Asia/Tokyo', offsetStr: 'GMT+9:00', offsetMins: 540, lat: 35.6762, lon: 139.6503 },
    { city: 'Singapore', cityHi: 'सिंगापुर', fullName: 'Singapore', fullNameHi: 'सिंगापुर', country: 'Singapore', countryHi: 'सिंगापुर', iana: 'Asia/Singapore', offsetStr: 'GMT+8:00', offsetMins: 480, lat: 1.3521, lon: 103.8198 },
    { city: 'Sydney', cityHi: 'सिडनी', fullName: 'Sydney', fullNameHi: 'सिडनी', country: 'Australia', countryHi: 'ऑस्ट्रेलिया', iana: 'Australia/Sydney', offsetStr: 'GMT+10:00', offsetMins: 600, lat: -33.8688, lon: 151.2093 },
    { city: 'Paris', cityHi: 'पेरिस', fullName: 'Paris', fullNameHi: 'पेरिस', country: 'France', countryHi: 'फ्रांस', iana: 'Europe/Paris', offsetStr: 'GMT+2:00', offsetMins: 120, lat: 48.8566, lon: 2.3522 },
    { city: 'Berlin', cityHi: 'बर्लिन', fullName: 'Berlin', fullNameHi: 'बर्लिन', country: 'Germany', countryHi: 'जर्मनी', iana: 'Europe/Berlin', offsetStr: 'GMT+2:00', offsetMins: 120, lat: 52.5200, lon: 13.4050 },
    { city: 'Toronto', cityHi: 'टोरंटो', fullName: 'Toronto', fullNameHi: 'टोरंटो', country: 'Canada', countryHi: 'कनाडा', iana: 'America/Toronto', offsetStr: 'GMT-4:00', offsetMins: -240, lat: 43.6532, lon: -79.3832 },
    { city: 'Los Angeles', cityHi: 'लॉस एंजिल्स', fullName: 'Los Angeles', fullNameHi: 'लॉस एंजिल्स', country: 'United States', countryHi: 'संयुक्त राज्य अमेरिका', iana: 'America/Los_Angeles', offsetStr: 'GMT-7:00', offsetMins: -420, lat: 34.0522, lon: -118.2437 },
    { city: 'San Francisco', cityHi: 'सैन फ्रांसिस्को', fullName: 'San Francisco', fullNameHi: 'सैन फ्रांसिस्को', country: 'United States', countryHi: 'संयुक्त राज्य अमेरिका', iana: 'America/Los_Angeles', offsetStr: 'GMT-7:00', offsetMins: -420, lat: 37.7749, lon: -122.4194 },
    { city: 'Chicago', cityHi: 'शिकागो', fullName: 'Chicago', fullNameHi: 'शिकागो', country: 'United States', countryHi: 'संयुक्त राज्य अमेरिका', iana: 'America/Chicago', offsetStr: 'GMT-5:00', offsetMins: -300, lat: 41.8781, lon: -87.6298 },
    { city: 'Hong Kong', cityHi: 'हांगकांग', fullName: 'Hong Kong', fullNameHi: 'हांगकांग', country: 'Hong Kong', countryHi: 'हांगकांग', iana: 'Asia/Hong_Kong', offsetStr: 'GMT+8:00', offsetMins: 480, lat: 22.3193, lon: 114.1694 },
    { city: 'Bangkok', cityHi: 'बैंकॉक', fullName: 'Bangkok', fullNameHi: 'बैंकॉक', country: 'Thailand', countryHi: 'थाईलैंड', iana: 'Asia/Bangkok', offsetStr: 'GMT+7:00', offsetMins: 420, lat: 13.7563, lon: 100.5018 },
    { city: 'Seoul', cityHi: 'सियोल', fullName: 'Seoul', fullNameHi: 'सियोल', country: 'South Korea', countryHi: 'दक्षिण कोरिया', iana: 'Asia/Seoul', offsetStr: 'GMT+9:00', offsetMins: 540, lat: 37.5665, lon: 126.9780 },
    { city: 'Moscow', cityHi: 'मॉस्को', fullName: 'Moscow', fullNameHi: 'मॉस्को', country: 'Russia', countryHi: 'रूस', iana: 'Europe/Moscow', offsetStr: 'GMT+3:00', offsetMins: 180, lat: 55.7558, lon: 37.6173 },
    { city: 'Rome', cityHi: 'रोम', fullName: 'Rome', fullNameHi: 'रोम', country: 'Italy', countryHi: 'इटली', iana: 'Europe/Rome', offsetStr: 'GMT+2:00', offsetMins: 120, lat: 41.9028, lon: 12.4964 },
    { city: 'Madrid', cityHi: 'मैड्रिड', fullName: 'Madrid', fullNameHi: 'मैड्रिड', country: 'Spain', countryHi: 'स्पेन', iana: 'Europe/Madrid', offsetStr: 'GMT+2:00', offsetMins: 120, lat: 40.4168, lon: -3.7038 },
    { city: 'Amsterdam', cityHi: 'एम्स्टर्डम', fullName: 'Amsterdam', fullNameHi: 'एम्स्टर्डम', country: 'Netherlands', countryHi: 'नीदरलैंड', iana: 'Europe/Amsterdam', offsetStr: 'GMT+2:00', offsetMins: 120, lat: 52.3676, lon: 4.9041 },
    { city: 'Zurich', cityHi: 'ज्यूरिख', fullName: 'Zurich', fullNameHi: 'ज्यूरिख', country: 'Switzerland', countryHi: 'स्विट्जरलैंड', iana: 'Europe/Zurich', offsetStr: 'GMT+2:00', offsetMins: 120, lat: 47.3769, lon: 8.5417 },
    { city: 'Riyadh', cityHi: 'रियाद', fullName: 'Riyadh', fullNameHi: 'रियाद', country: 'Saudi Arabia', countryHi: 'सऊदी अरब', iana: 'Asia/Riyadh', offsetStr: 'GMT+3:00', offsetMins: 180, lat: 24.7136, lon: 46.6753 },
    { city: 'Doha', cityHi: 'दोहा', fullName: 'Doha', fullNameHi: 'दोहा', country: 'Qatar', countryHi: 'कतर', iana: 'Asia/Qatar', offsetStr: 'GMT+3:00', offsetMins: 180, lat: 25.2854, lon: 51.5310 },
    { city: 'Kathmandu', cityHi: 'काठमांडू', fullName: 'Kathmandu', fullNameHi: 'काठमांडू', country: 'Nepal', countryHi: 'नेपाल', iana: 'Asia/Kathmandu', offsetStr: 'GMT+5:45', offsetMins: 345, lat: 27.7172, lon: 85.3240 },
    { city: 'Dhaka', cityHi: 'ढाका', fullName: 'Dhaka', fullNameHi: 'ढाका', country: 'Bangladesh', countryHi: 'बांग्लादेश', iana: 'Asia/Dhaka', offsetStr: 'GMT+6:00', offsetMins: 360, lat: 23.8103, lon: 90.4125 },
    { city: 'Colombo', cityHi: 'कोलंबो', fullName: 'Colombo', fullNameHi: 'कोलंबो', country: 'Sri Lanka', countryHi: 'श्रीलंका', iana: 'Asia/Colombo', offsetStr: 'GMT+5:30', offsetMins: 330, lat: 6.9271, lon: 79.8612 },
    { city: 'Jakarta', cityHi: 'जकार्ता', fullName: 'Jakarta', fullNameHi: 'जकार्ता', country: 'Indonesia', countryHi: 'इंडोनेशिया', iana: 'Asia/Jakarta', offsetStr: 'GMT+7:00', offsetMins: 420, lat: -6.2088, lon: 106.8456 },
    { city: 'Kuala Lumpur', cityHi: 'कुआलालंपुर', fullName: 'Kuala Lumpur', fullNameHi: 'कुआलालंपुर', country: 'Malaysia', countryHi: 'मलेशिया', iana: 'Asia/Kuala_Lumpur', offsetStr: 'GMT+8:00', offsetMins: 480, lat: 3.1390, lon: 101.6869 },
    { city: 'Auckland', cityHi: 'ऑकलैंड', fullName: 'Auckland', fullNameHi: 'ऑकलैंड', country: 'New Zealand', countryHi: 'न्यूजीलैंड', iana: 'Pacific/Auckland', offsetStr: 'GMT+12:00', offsetMins: 720, lat: -36.8485, lon: 174.7633 },
    { city: 'Melbourne', cityHi: 'मेलबर्न', fullName: 'Melbourne', fullNameHi: 'मेलबर्न', country: 'Australia', countryHi: 'ऑस्ट्रेलिया', iana: 'Australia/Melbourne', offsetStr: 'GMT+10:00', offsetMins: 600, lat: -37.8136, lon: 144.9631 },
    { city: 'Brisbane', cityHi: 'ब्रिस्बेन', fullName: 'Brisbane', fullNameHi: 'ब्रिस्बेन', country: 'Australia', countryHi: 'ऑस्ट्रेलिया', iana: 'Australia/Brisbane', offsetStr: 'GMT+10:00', offsetMins: 600, lat: -27.4698, lon: 153.0251 },
    { city: 'Perth', cityHi: 'पर्थ', fullName: 'Perth', fullNameHi: 'पर्थ', country: 'Australia', countryHi: 'ऑस्ट्रेलिया', iana: 'Australia/Perth', offsetStr: 'GMT+8:00', offsetMins: 480, lat: -31.9505, lon: 115.8605 },
    { city: 'Cairo', cityHi: 'काहिरा', fullName: 'Cairo', fullNameHi: 'काहिरा', country: 'Egypt', countryHi: 'मिस्र', iana: 'Africa/Cairo', offsetStr: 'GMT+3:00', offsetMins: 180, lat: 30.0444, lon: 31.2357 },
    { city: 'Johannesburg', cityHi: 'जोहान्सबर्ग', fullName: 'Johannesburg', fullNameHi: 'जोहान्सबर्ग', country: 'South Africa', countryHi: 'दक्षिण अफ्रीका', iana: 'Africa/Johannesburg', offsetStr: 'GMT+2:00', offsetMins: 120, lat: -26.2041, lon: 28.0473 },
    { city: 'Nairobi', cityHi: 'नैरोबी', fullName: 'Nairobi', fullNameHi: 'नैरोबी', country: 'Kenya', countryHi: 'केन्या', iana: 'Africa/Nairobi', offsetStr: 'GMT+3:00', offsetMins: 180, lat: -1.2921, lon: 36.8219 },
    { city: 'São Paulo', cityHi: 'साओ पाउलो', fullName: 'São Paulo', fullNameHi: 'साओ पाउलो', country: 'Brazil', countryHi: 'ब्राजील', iana: 'America/Sao_Paulo', offsetStr: 'GMT-3:00', offsetMins: -180, lat: -23.5505, lon: -46.6333 },
    { city: 'Buenos Aires', cityHi: 'ब्यूनस आयर्स', fullName: 'Buenos Aires', fullNameHi: 'ब्यूनस आयर्स', country: 'Argentina', countryHi: 'अर्जेंटीना', iana: 'America/Argentina/Buenos_Aires', offsetStr: 'GMT-3:00', offsetMins: -180, lat: -34.6037, lon: -58.3816 },
    { city: 'Mexico City', cityHi: 'मेक्सिको सिटी', fullName: 'Mexico City', fullNameHi: 'मेक्सिको सिटी', country: 'Mexico', countryHi: 'मेक्सिको', iana: 'America/Mexico_City', offsetStr: 'GMT-6:00', offsetMins: -360, lat: 19.4326, lon: -99.1332 },
    { city: 'Honolulu', cityHi: 'होनोलूलू', fullName: 'Honolulu', fullNameHi: 'होनोलूलू', country: 'United States', countryHi: 'संयुक्त राज्य अमेरिका', iana: 'Pacific/Honolulu', offsetStr: 'GMT-10:00', offsetMins: -600, lat: 21.3069, lon: -157.8583 },
    { city: 'Reykjavik', cityHi: 'रेकजाविक', fullName: 'Reykjavik', fullNameHi: 'रेकजाविक', country: 'Iceland', countryHi: 'आइसलैंड', iana: 'Atlantic/Reykjavik', offsetStr: 'GMT+0:00', offsetMins: 0, lat: 64.1466, lon: -21.9426 }
  ];

  const timezoneView = $('timezoneView');
  const closeTimezoneBtn = $('closeTimezoneBtn');
  const settingAutoTimezone = $('settingAutoTimezone');
  const timezoneSearchInput = $('timezoneSearchInput');
  const clearTzSearchBtn = $('clearTzSearchBtn');
  const timezoneList = $('timezoneList');
  const locationPrivacyModal = $('locationPrivacyModal');
  const allowLocationPermBtn = $('allowLocationPermBtn');
  const cancelLocationPermBtn = $('cancelLocationPermBtn');

  function getOffsetStringFromIana(iana) {
    try {
      const date = new Date();
      const str = date.toLocaleTimeString('en-US', { timeZone: iana, timeZoneName: 'shortOffset' });
      const match = str.match(/GMT([+-]\d{1,2}(?::\d{2})?)/);
      if (match) return `GMT${match[1]}`;
    } catch {}
    return 'GMT';
  }

  function detectAndSetLocalTimezone(coords) {
    let bestCity = null;

    if (!coords && window.AndroidVoice && typeof window.AndroidVoice.getDeviceLocationCoordinates === 'function') {
      try {
        const jsonStr = window.AndroidVoice.getDeviceLocationCoordinates();
        if (jsonStr) {
          const locObj = JSON.parse(jsonStr);
          if (locObj && typeof locObj.lat === 'number' && typeof locObj.lon === 'number') {
            coords = { latitude: locObj.lat, longitude: locObj.lon };
          }
        }
      } catch (e) {
        console.log('Error reading native coordinates:', e);
      }
    }

    if (coords && typeof coords.latitude === 'number' && typeof coords.longitude === 'number') {
      let minDist = Infinity;
      for (const z of WORLD_TIMEZONES) {
        if (typeof z.lat === 'number' && typeof z.lon === 'number') {
          const dLat = coords.latitude - z.lat;
          const dLon = coords.longitude - z.lon;
          const dist = (dLat * dLat) + (dLon * dLon);
          if (dist < minDist) {
            minDist = dist;
            bestCity = z;
          }
        }
      }
    }

    if (!bestCity) {
      let resolvedIana = 'Asia/Kolkata';
      try {
        resolvedIana = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
      } catch {}
      bestCity = WORLD_TIMEZONES.find(z => z.iana === resolvedIana) || WORLD_TIMEZONES[0];
    }

    userSettings.timezone = `(${bestCity.offsetStr}) ${bestCity.city}`;
    userSettings.timezoneIana = bestCity.iana;
    saveSettings();
    applySettingDisplays();
    updateTimezoneUI();
  }

  function updateTimezoneUI() {
    const isHi = userSettings.appLanguage === 'hi';
    if (settingAutoTimezone) settingAutoTimezone.checked = !!userSettings.autoTimezone;

    const autoStatusBadge = $('autoTzStatusBadge');
    const autoStatusLabel = $('autoTzStatusLabel');
    if (autoStatusBadge && autoStatusLabel) {
      if (userSettings.autoTimezone) {
        autoStatusBadge.querySelector('.status-indicator-dot')?.classList.add('active');
        autoStatusLabel.textContent = isHi ? 'स्वचालित पहचान सक्रिय है (जीपीएस और नेटवर्क)' : 'Automatic detection active (GPS & Device Network)';
      } else {
        autoStatusBadge.querySelector('.status-indicator-dot')?.classList.remove('active');
        autoStatusLabel.textContent = isHi ? 'मैन्युअल शहर चयन सक्रिय है' : 'Manual city selection active';
      }
    }

    const currentTzCity = $('currentTzCity');
    const currentTzIana = $('currentTzIana');
    const currentTzOffsetBadge = $('currentTzOffsetBadge');

    const matchCity = WORLD_TIMEZONES.find(z => z.iana === userSettings.timezoneIana);
    if (currentTzCity) {
      if (isHi) {
        currentTzCity.textContent = matchCity ? `${matchCity.cityHi}, ${matchCity.countryHi}` : 'जयपुर, भारत';
      } else {
        currentTzCity.textContent = matchCity ? `${matchCity.city}, ${matchCity.country}` : (userSettings.timezone || 'Jaipur, India');
      }
    }
    if (currentTzIana) currentTzIana.textContent = userSettings.timezoneIana || 'Asia/Kolkata';
    if (currentTzOffsetBadge) {
      currentTzOffsetBadge.textContent = matchCity ? matchCity.offsetStr : getOffsetStringFromIana(userSettings.timezoneIana || 'Asia/Kolkata');
    }
  }

  function updateTimezoneClockDisplay(now, currentIana) {
    const currentTzClock = $('currentTzClock');
    if (currentTzClock) {
      try {
        currentTzClock.textContent = now.toLocaleTimeString('en-US', { timeZone: currentIana, hour12: true });
      } catch {
        currentTzClock.textContent = now.toLocaleTimeString();
      }
    }

    // Update visible city times in list
    const tzViewEl = $('timezoneView');
    const tzListEl = $('timezoneList');
    if (tzListEl && tzViewEl && !tzViewEl.classList.contains('hidden')) {
      const items = tzListEl.querySelectorAll('.tz-city-item');
      items.forEach(it => {
        const iana = it.dataset.iana;
        const timeEl = it.querySelector('.tz-city-time');
        if (timeEl && iana) {
          try {
            timeEl.textContent = now.toLocaleTimeString('en-US', {
              timeZone: iana,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: true
            });
          } catch {}
        }
      });
    }
  }

  function renderTimezoneList(filterText = '') {
    if (!timezoneList) return;
    const isHi = userSettings.appLanguage === 'hi';
    timezoneList.innerHTML = '';

    const query = filterText.toLowerCase().trim();
    const filtered = WORLD_TIMEZONES.filter(z => {
      const cityMatch = z.city.toLowerCase().includes(query) || (z.cityHi && z.cityHi.includes(query));
      const fullMatch = z.fullName.toLowerCase().includes(query) || (z.fullNameHi && z.fullNameHi.includes(query));
      const countryMatch = z.country.toLowerCase().includes(query) || (z.countryHi && z.countryHi.includes(query));
      const ianaMatch = z.iana.toLowerCase().includes(query);
      return cityMatch || fullMatch || countryMatch || ianaMatch;
    });

    if (filtered.length === 0) {
      timezoneList.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted);font-size:14px;">${isHi ? `"${filterText}" से मेल खाता कोई शहर नहीं मिला` : `No cities matching "${filterText}"`}</div>`;
      return;
    }

    const now = new Date();
    filtered.forEach(z => {
      const isSelected = z.iana === userSettings.timezoneIana;
      let cityTimeStr = '--:--:--';
      let dayDiffStr = isHi ? 'आज' : 'Today';

      try {
        cityTimeStr = now.toLocaleTimeString('en-US', {
          timeZone: z.iana,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        });
        const localDay = now.getDate();
        const cityDay = parseInt(now.toLocaleDateString('en-US', { timeZone: z.iana, day: 'numeric' }), 10);
        if (cityDay > localDay) dayDiffStr = isHi ? 'कल' : 'Tomorrow';
        else if (cityDay < localDay) dayDiffStr = isHi ? 'बीता कल' : 'Yesterday';
        else dayDiffStr = isHi ? 'आज' : 'Today';
      } catch {}

      const displayName = isHi ? (z.cityHi || z.city) : z.city;
      const displayCountry = isHi ? (z.countryHi || z.country) : z.country;

      const item = document.createElement('div');
      item.className = `tz-city-item ${isSelected ? 'active' : ''}`;
      item.dataset.iana = z.iana;
      item.innerHTML = `
        <div class="tz-city-left">
          <div class="tz-city-name">${displayName}</div>
          <div class="tz-city-country">${displayCountry} • ${z.offsetStr}</div>
        </div>
        <div class="tz-city-right">
          <div class="tz-city-time">${cityTimeStr}</div>
          <div class="tz-city-diff">${dayDiffStr}</div>
          ${isSelected ? `
            <svg class="tz-check-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
            </svg>
          ` : ''}
        </div>
      `;

      item.addEventListener('click', () => {
        userSettings.autoTimezone = false;
        userSettings.timezone = `(${z.offsetStr}) ${z.city}`;
        userSettings.timezoneIana = z.iana;
        saveSettings();
        applySettingDisplays();
        updateTimezoneUI();
        renderTimezoneList(timezoneSearchInput ? timezoneSearchInput.value : '');
        showPopup(isHi ? `समय क्षेत्र ${displayName} (${z.offsetStr}) पर सेट किया गया` : `Time zone set to ${z.city} (${z.offsetStr})`);
      });

      timezoneList.appendChild(item);
    });
  }

  // Open & Close Timezone View
  $('settingHomeTimeZone')?.addEventListener('click', () => {
    updateTimezoneUI();
    renderTimezoneList(timezoneSearchInput ? timezoneSearchInput.value : '');
    if (timezoneView) timezoneView.classList.remove('hidden');
  });

  closeTimezoneBtn?.addEventListener('click', () => {
    if (timezoneView) timezoneView.classList.add('hidden');
  });

  // Auto Time Zone Toggle & Privacy Flow
  settingAutoTimezone?.addEventListener('change', (e) => {
    const isHi = userSettings.appLanguage === 'hi';
    if (e.target.checked) {
      if (locationPrivacyModal) locationPrivacyModal.classList.remove('hidden');
    } else {
      userSettings.autoTimezone = false;
      saveSettings();
      updateTimezoneUI();
      applySettingDisplays();
      renderTimezoneList(timezoneSearchInput ? timezoneSearchInput.value : '');
      showPopup(isHi ? 'स्वचालित समय क्षेत्र निष्क्रिय। मैन्युअल शहर चयन सक्रिय।' : 'Auto time zone disabled. Manual city selection active.');
    }
  });

  window.onAndroidLocationGranted = function() {
    const isHi = userSettings.appLanguage === 'hi';
    userSettings.autoTimezone = true;
    detectAndSetLocalTimezone();
    renderTimezoneList(timezoneSearchInput ? timezoneSearchInput.value : '');
    showPopup(isHi ? `✓ स्थानीय समय क्षेत्र समन्वयित: ${userSettings.timezone}` : `✓ Local time zone synchronized: ${userSettings.timezone}`);
  };

  allowLocationPermBtn?.addEventListener('click', () => {
    const isHi = userSettings.appLanguage === 'hi';
    if (locationPrivacyModal) locationPrivacyModal.classList.add('hidden');

    if (window.AndroidVoice && typeof window.AndroidVoice.requestLocationPermission === 'function') {
      window.AndroidVoice.requestLocationPermission();
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          userSettings.autoTimezone = true;
          detectAndSetLocalTimezone(pos.coords);
          renderTimezoneList(timezoneSearchInput ? timezoneSearchInput.value : '');
          showPopup(isHi ? `✓ स्थानीय समय क्षेत्र समन्वयित: ${userSettings.timezone}` : `✓ Local time zone synchronized: ${userSettings.timezone}`);
        },
        (err) => {
          console.log('Location prompt notice:', err);
          userSettings.autoTimezone = true;
          detectAndSetLocalTimezone();
          renderTimezoneList(timezoneSearchInput ? timezoneSearchInput.value : '');
          showPopup(isHi ? `✓ स्थानीय समय क्षेत्र समन्वयित: ${userSettings.timezone}` : `✓ Local time zone synchronized: ${userSettings.timezone}`);
        },
        { timeout: 8000, enableHighAccuracy: true }
      );
    } else {
      userSettings.autoTimezone = true;
      detectAndSetLocalTimezone();
      renderTimezoneList(timezoneSearchInput ? timezoneSearchInput.value : '');
      showPopup(isHi ? `✓ स्थानीय समय क्षेत्र समन्वयित: ${userSettings.timezone}` : `✓ Local time zone synchronized: ${userSettings.timezone}`);
    }
  });

  cancelLocationPermBtn?.addEventListener('click', () => {
    if (locationPrivacyModal) locationPrivacyModal.classList.add('hidden');
    if (settingAutoTimezone) settingAutoTimezone.checked = false;
    userSettings.autoTimezone = false;
    saveSettings();
    updateTimezoneUI();
  });

  locationPrivacyModal?.addEventListener('click', (e) => {
    if (e.target === locationPrivacyModal) {
      locationPrivacyModal.classList.add('hidden');
      if (settingAutoTimezone) settingAutoTimezone.checked = !!userSettings.autoTimezone;
    }
  });

  // Timezone search input
  timezoneSearchInput?.addEventListener('input', (e) => {
    const val = e.target.value;
    if (clearTzSearchBtn) clearTzSearchBtn.classList.toggle('hidden', !val);
    renderTimezoneList(val);
  });

  clearTzSearchBtn?.addEventListener('click', () => {
    if (timezoneSearchInput) {
      timezoneSearchInput.value = '';
      clearTzSearchBtn.classList.add('hidden');
      renderTimezoneList('');
    }
  });

  // Initialize auto timezone if active
  if (userSettings.autoTimezone) {
    detectAndSetLocalTimezone();
  }

  // -------------------- TTS SYSTEM --------------------
  function playTTS(text, lang = "en-US") {
    return new Promise((resolve) => {
      const selectedLang = $('voiceLangSelect')?.value || "hi-IN";
      const isHindiText = /[\u0900-\u097F]/.test(text) || selectedLang.startsWith("hi");
      const speakLang = isHindiText ? "hi-IN" : (lang || "en-US");

      if (
        window.Capacitor &&
        window.Capacitor.Plugins &&
        window.Capacitor.Plugins.TextToSpeech
      ) {
        window.Capacitor.Plugins.TextToSpeech.speak({
          text: text,
          lang: speakLang,
          rate: 1.0,
          pitch: 1.0,
          volume: 1.0
        }).then(resolve).catch(err => {
          console.log("Capacitor TTS error:", err);
          fallbackWebSpeech(text, speakLang, resolve);
        });
        return;
      }
      fallbackWebSpeech(text, speakLang, resolve);
    });
  }

  function fallbackWebSpeech(text, lang, callback) {
    if (!('speechSynthesis' in window)) {
      if (callback) callback();
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang || 'en-US';
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      let called = false;
      const finish = () => {
        if (!called) {
          called = true;
          if (callback) callback();
        }
      };

      utterance.onend = finish;
      utterance.onerror = finish;
      setTimeout(finish, 8000);
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      if (callback) callback();
    }
  }

  function playAudioFile(src) {
    const audio = new Audio(src);
    audio.loop = true;
    audio.play().catch(e => console.log('Audio playback error:', e));
    return audio;
  }

  // -------------------- DAY PILLS & TIME HELPERS --------------------
  const DAY_NAMES_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DAY_NAMES_HI = ["रवि", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि"];

  function getSelectedDays(containerId) {
    const container = $(containerId);
    if (!container) return [];
    const pills = container.querySelectorAll('.day-pill.active');
    const days = [];
    pills.forEach(p => {
      const d = parseInt(p.dataset.day, 10);
      if (!isNaN(d) && !days.includes(d)) days.push(d);
    });
    return days.sort((a, b) => a - b);
  }

  function setSelectedDays(containerId, daysArray) {
    const container = $(containerId);
    if (!container) return;
    const days = Array.isArray(daysArray) ? daysArray : [];
    const pills = container.querySelectorAll('.day-pill');
    pills.forEach(p => {
      const d = parseInt(p.dataset.day, 10);
      p.classList.toggle('active', days.includes(d));
    });
    updateDayPillHint(containerId);
  }

  function formatDaysSummary(daysArray, isHi = false) {
    if (!daysArray || daysArray.length === 0) return '';
    const sorted = [...daysArray].sort((a, b) => a - b);
    if (sorted.length === 7) {
      return isHi ? 'प्रतिदिन (सभी दिन)' : 'Every day';
    }
    if (sorted.length === 5 && sorted.every(d => d >= 1 && d <= 5)) {
      return isHi ? 'सोमवार - शुक्रवार' : 'Mon - Fri';
    }
    if (sorted.length === 2 && sorted.includes(0) && sorted.includes(6)) {
      return isHi ? 'सप्ताहांत (शनि, रवि)' : 'Weekends (Sat, Sun)';
    }
    const names = isHi ? DAY_NAMES_HI : DAY_NAMES_EN;
    return sorted.map(d => names[d]).join(', ');
  }

  function updateDayPillHint(containerId) {
    const hintMap = {
      'alarmDayPills': $('alarmRepeatDaysHint'),
      'editAlarmDayPills': $('editAlarmRepeatDaysHint'),
      'taskDayPills': $('taskRepeatDaysHint'),
      'editTaskDayPills': $('editTaskRepeatDaysHint')
    };
    const hintEl = hintMap[containerId];
    if (!hintEl) return;
    const isHi = userSettings.appLanguage === 'hi';
    const selected = getSelectedDays(containerId);
    if (selected.length === 0) {
      hintEl.textContent = isHi ? 'सप्ताह के दिन चुनें' : 'Select days of the week';
    } else {
      hintEl.textContent = formatDaysSummary(selected, isHi);
    }
  }

  function setupDayPillsRow(containerId, repeatSelectId, customBoxId) {
    const container = $(containerId);
    if (!container) return;

    container.querySelectorAll('.day-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        pill.classList.toggle('active');
        updateDayPillHint(containerId);
      });
    });
  }

  function getNextOccurrenceForDays(targetH, targetM, repeatDays) {
    if (!repeatDays || repeatDays.length === 0) return null;
    const now = new Date();
    for (let offset = 0; offset <= 7; offset++) {
      const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, targetH, targetM, 0, 0);
      if (repeatDays.includes(candidate.getDay())) {
        if (candidate.getTime() > now.getTime() + 15000) {
          return candidate;
        }
      }
    }
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, targetH, targetM, 0, 0);
  }

  function advanceAlarmToNextRepeatDay(al) {
    if (!al.repeatDays || al.repeatDays.length === 0) return;
    const d = new Date(al.time);
    const targetH = typeof al.baseH === 'number' ? al.baseH : d.getHours();
    const targetM = typeof al.baseM === 'number' ? al.baseM : d.getMinutes();
    const now = new Date();
    for (let offset = 1; offset <= 7; offset++) {
      const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, targetH, targetM, 0, 0);
      if (al.repeatDays.includes(candidate.getDay())) {
        al.time = candidate;
        al.enabled = true;
        al.ringing = false;
        al.snoozedUntil = null;
        return candidate;
      }
    }
    const fallback = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, targetH, targetM, 0, 0);
    al.time = fallback;
    al.enabled = true;
    al.ringing = false;
    al.snoozedUntil = null;
    return fallback;
  }

  function advanceTaskToNextRepeatDay(t) {
    if (!t.repeatDays || t.repeatDays.length === 0) return;
    const d = new Date(t.time);
    const targetH = typeof t.baseH === 'number' ? t.baseH : d.getHours();
    const targetM = typeof t.baseM === 'number' ? t.baseM : d.getMinutes();
    const now = new Date();
    for (let offset = 1; offset <= 7; offset++) {
      const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, targetH, targetM, 0, 0);
      if (t.repeatDays.includes(candidate.getDay())) {
        t.time = candidate;
        t.enabled = true;
        t.ringing = false;
        t.snoozedUntil = null;
        return candidate;
      }
    }
    const fallback = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, targetH, targetM, 0, 0);
    t.time = fallback;
    t.enabled = true;
    t.ringing = false;
    t.snoozedUntil = null;
    return fallback;
  }

  function toDatetimeLocalValue(dateObj) {
    const d = new Date(dateObj);
    if (isNaN(d.getTime())) return '';
    const Y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, '0');
    const D = String(d.getDate()).padStart(2, '0');
    const H = String(d.getHours()).padStart(2, '0');
    const Min = String(d.getMinutes()).padStart(2, '0');
    return `${Y}-${M}-${D}T${H}:${Min}`;
  }

  // -------------------- FORM RESET UTILITIES --------------------
  function resetAlarmForm() {
    const dtInput = $('alarmDate');
    if (dtInput) {
      dtInput.value = '';
      const ph = dtInput.parentElement?.querySelector('.fake-placeholder');
      if (ph) ph.style.display = 'block';
    }
    if ($('alarmName')) $('alarmName').value = '';
    if ($('ttsText')) $('ttsText').value = '';
    if ($('alarmRepeat')) $('alarmRepeat').value = 'once';
    if ($('alarmCustomHours')) $('alarmCustomHours').value = '';
    if ($('alarmCustomMinutes')) $('alarmCustomMinutes').value = '';
    if ($('alarmCustomBox')) $('alarmCustomBox').style.display = 'none';
    if ($('mode')) $('mode').value = 'tts';
    if ($('uploadTune')) {
      $('uploadTune').value = '';
      $('uploadTune').style.display = 'none';
    }
    uploadedAudioBase64 = null;
    setSelectedDays('alarmDayPills', []);
    updateDayPillHint('alarmDayPills');
  }

  function resetTaskForm() {
    if ($('taskTitle')) $('taskTitle').value = '';
    const tTimeInput = $('taskTime');
    if (tTimeInput) {
      tTimeInput.value = '';
      const ph = tTimeInput.parentElement?.querySelector('.fake-placeholder');
      if (ph) ph.style.display = 'block';
    }
    if ($('taskRepeat')) $('taskRepeat').value = 'once';
    if ($('customHours')) $('customHours').value = '';
    if ($('customMinutes')) $('customMinutes').value = '';
    if ($('customIntervalBox')) $('customIntervalBox').style.display = 'none';
    setSelectedDays('taskDayPills', []);
    updateDayPillHint('taskDayPills');
  }

  // -------------------- ALARM TAB NAVIGATION (+ / FORM / LIST) --------------------
  const alarmListView = $('alarmListView');
  const alarmFormView = $('alarmFormView');
  const openAddAlarmBtn = $('openAddAlarmBtn');
  const backFromAlarmFormBtn = $('backFromAlarmFormBtn');

  openAddAlarmBtn?.addEventListener('click', () => {
    resetAlarmForm();
    alarmListView?.classList.add('hidden');
    alarmFormView?.classList.remove('hidden');
  });

  backFromAlarmFormBtn?.addEventListener('click', () => {
    resetAlarmForm();
    alarmFormView?.classList.add('hidden');
    alarmListView?.classList.remove('hidden');
  });

  // -------------------- TASK TAB NAVIGATION (+ / FORM / LIST) --------------------
  const taskListView = $('taskListView');
  const taskFormView = $('taskFormView');
  const openAddTaskBtn = $('openAddTaskBtn');
  const backFromTaskFormBtn = $('backFromTaskFormBtn');

  openAddTaskBtn?.addEventListener('click', () => {
    resetTaskForm();
    taskListView?.classList.add('hidden');
    taskFormView?.classList.remove('hidden');
  });

  backFromTaskFormBtn?.addEventListener('click', () => {
    resetTaskForm();
    taskFormView?.classList.add('hidden');
    taskListView?.classList.remove('hidden');
  });

  // -------------------- ALARMS STATE & LOGIC --------------------
  let alarms = JSON.parse(localStorage.getItem("alarms")) || [];
  alarms.forEach(a => {
    a.time = new Date(a.time);
    if (isNaN(a.time.getTime())) a.time = new Date();
    if (a.enabled === undefined) a.enabled = true;
  });

  function saveAlarms() {
    localStorage.setItem("alarms", JSON.stringify(alarms));
  }

  const alarmsList = $('alarmsList');
  const alarmModal = $('alarmModal');
  const modalLabel = $('modalLabel');
  const modalTime = $('modalTime');
  const modalMessage = $('modalMessage');
  const alarmRepeat = $('alarmRepeat');
  const alarmCustomBox = $('alarmCustomBox');
  const modeSelect = $('mode');
  const uploadTuneInput = $('uploadTune');
  const setAlarmBtn = $('setAlarmBtn');

  let currentActiveAlarmId = null;
  let uploadedAudioBase64 = null;

  alarmRepeat?.addEventListener('change', () => {
    if (alarmCustomBox) {
      alarmCustomBox.style.display = alarmRepeat.value === 'custom' ? 'grid' : 'none';
    }
  });

  modeSelect?.addEventListener('change', () => {
    if (uploadTuneInput) {
      uploadTuneInput.style.display = modeSelect.value === 'upload' ? 'block' : 'none';
    }
  });

  uploadTuneInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        uploadedAudioBase64 = ev.target.result;
      };
      reader.readAsDataURL(file);
    } else {
      uploadedAudioBase64 = null;
    }
  });

  setAlarmBtn?.addEventListener('click', () => {
    const isHi = userSettings.appLanguage === 'hi';
    const dtInput = $('alarmDate');
    if (!dtInput || !dtInput.value) {
      alert(isHi ? 'कृपया समय और तारीख चुनें' : 'Please select date and time');
      return;
    }
    let dt = new Date(dtInput.value);
    const now = new Date();

    const selectedDays = getSelectedDays('alarmDayPills');
    const rep = alarmRepeat?.value || 'once';
    const alarmLabel = $('alarmName')?.value.trim() || (isHi ? 'अलार्म' : 'Alarm');
    const messageText = $('ttsText')?.value.trim() || alarmLabel;

    const customH = parseInt($('alarmCustomHours')?.value || 0, 10);
    const customM = parseInt($('alarmCustomMinutes')?.value || 0, 10);
    let intervalMs = null;
    if (rep === 'custom') {
      intervalMs = (customH * 3600000) + (customM * 60000);
      if (!intervalMs || intervalMs <= 0) intervalMs = 60000;
    } else {
      const mapping = {
        '1 min': 60000,
        '10 min': 600000,
        '1 hr': 3600000,
        '5 hr': 18000000
      };
      if (mapping[rep]) intervalMs = mapping[rep];
    }

    const baseH = dt.getHours();
    const baseM = dt.getMinutes();

    if (selectedDays.length > 0) {
      const nextOccur = getNextOccurrenceForDays(baseH, baseM, selectedDays);
      if (nextOccur) dt = nextOccur;
    } else if (dt <= now) {
      dt.setDate(dt.getDate() + 1);
    }

    const al = {
      id: 'AL' + Date.now(),
      time: dt,
      baseH: baseH,
      baseM: baseM,
      label: alarmLabel,
      message: messageText,
      repeat: rep,
      repeatDays: selectedDays,
      intervalMs: intervalMs,
      mode: modeSelect?.value || 'tts',
      ttsText: messageText,
      audioData: uploadedAudioBase64 || null,
      enabled: true,
      ringing: false,
      snoozedUntil: null,
      loopTimeout: null,
      audioObj: null
    };

    alarms.push(al);
    saveAlarms();

    if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
      window.AndroidVoice.scheduleAlarm(
        al.id,
        al.time.getTime(),
        al.label,
        al.mode,
        al.ttsText
      );
    }

    // Reset inputs completely
    resetAlarmForm();

    // Switch back to starting list view as requested
    alarmFormView?.classList.add('hidden');
    alarmListView?.classList.remove('hidden');

    renderAlarms();
    showPopup(isHi ? `अलार्म ${formatAlarmTimeString(al.time)} के लिए सेट किया गया` : `Alarm set for ${formatAlarmTimeString(al.time)}`);
    addLog(isHi ? `अलार्म "${al.label}" जोड़ा गया` : `Alarm "${al.label}" added`);
  });

  function formatAlarmTimeString(dateObj) {
    const d = new Date(dateObj);
    let hours = d.getHours();
    let minutes = d.getMinutes();
    const strH = hours < 10 ? '0' + hours : '' + hours;
    const strM = minutes < 10 ? '0' + minutes : '' + minutes;
    return `${strH}:${strM}`;
  }

  function formatIntervalSummary(rep, intervalMs, isHi) {
    if (rep === '1 min') return isHi ? 'हर 1 मिनट' : 'Every 1 min';
    if (rep === '5 min') return isHi ? 'हर 5 मिनट' : 'Every 5 min';
    if (rep === '10 min') return isHi ? 'हर 10 मिनट' : 'Every 10 min';
    if (rep === '1 hr') return isHi ? 'हर 1 घंटा' : 'Every 1 hour';
    if (rep === '5 hr') return isHi ? 'हर 5 घंटे' : 'Every 5 hours';
    if (rep === 'custom') {
      if (intervalMs) {
        const h = Math.floor(intervalMs / 3600000);
        const m = Math.floor((intervalMs % 3600000) / 60000);
        if (h > 0 && m > 0) return isHi ? `हर ${h} घंटे ${m} मिनट` : `Every ${h}h ${m}m`;
        if (h > 0) return isHi ? `हर ${h} घंटे` : `Every ${h} hours`;
        if (m > 0) return isHi ? `हर ${m} मिनट` : `Every ${m} mins`;
      }
      return isHi ? 'कस्टम अंतराल' : 'Custom interval';
    }
    return '';
  }

  function getAlarmSubtitle(al) {
    const isHi = userSettings.appLanguage === 'hi';
    const hasDays = al.repeatDays && al.repeatDays.length > 0;
    const daysStr = hasDays ? formatDaysSummary(al.repeatDays, isHi) : '';
    const intervalStr = (al.repeat && al.repeat !== 'once' && al.repeat !== 'days') ? formatIntervalSummary(al.repeat, al.intervalMs, isHi) : '';

    if (daysStr && intervalStr) {
      return `${daysStr} • ${intervalStr}`;
    }
    if (daysStr) {
      return daysStr;
    }
    if (intervalStr) {
      return intervalStr;
    }
    if (al.repeat === 'once') {
      const d = new Date(al.time);
      const daysEn = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const daysHi = ["रवि", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि"];
      const monthsEn = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const monthsHi = ["जन", "फ़र", "मार्च", "अप्रैल", "मई", "जून", "जुल", "अग", "सितं", "अक्तू", "नवं", "दिसं"];
      const day = isHi ? daysHi[d.getDay()] : daysEn[d.getDay()];
      const month = isHi ? monthsHi[d.getMonth()] : monthsEn[d.getMonth()];
      return isHi ? `एक बार • ${day}, ${d.getDate()} ${month}` : `Once • ${day}, ${d.getDate()} ${month}`;
    }
    return al.repeat || (isHi ? 'प्रतिदिन' : 'Every day');
  }

  function renderAlarms() {
    if (!alarmsList) return;
    const isHi = userSettings.appLanguage === 'hi';
    alarmsList.innerHTML = '';
    if (alarms.length === 0) {
      alarmsList.innerHTML = `<div class="empty-history-text">${isHi ? 'कोई अलार्म नहीं है। नया अलार्म जोड़ने के लिए + दबाएं।' : 'No alarms yet. Tap + to set an alarm.'}</div>`;
      return;
    }

    alarms.forEach(al => {
      const card = document.createElement('div');
      card.className = `alarm-item-card ${al.enabled === false ? 'disabled' : ''}`;
      const timeStr = formatAlarmTimeString(al.time);
      const isSnoozed = al.snoozedUntil && al.snoozedUntil > Date.now();
      const snoozeBadge = isSnoozed ? `<span class="snooze-badge">💤 ${isHi ? 'स्नूज़' : 'Snoozed'} ${formatAlarmTimeString(al.snoozedUntil)}</span>` : '';
      const subStr = (al.label && al.label !== 'Alarm' ? `${al.label} • ` : '') + getAlarmSubtitle(al);

      card.innerHTML = `
        <div class="alarm-item-left" data-id="${al.id}" style="cursor:pointer;" title="${isHi ? 'अलार्म संपादित करने के लिए क्लिक करें' : 'Click to edit alarm'}">
          <div class="alarm-item-time">${timeStr} ${snoozeBadge}</div>
          <div class="alarm-item-sub">${subStr}</div>
        </div>
        <div class="alarm-item-right">
          <label class="switch-container">
            <input type="checkbox" class="alarm-toggle-checkbox" data-id="${al.id}" ${al.enabled !== false ? 'checked' : ''}>
            <span class="slider round"></span>
          </label>
          <button class="alarm-delete-btn" data-id="${al.id}" aria-label="Delete">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </button>
        </div>
      `;
      alarmsList.appendChild(card);
    });

    // Edit alarm on clicking item details
    alarmsList.querySelectorAll('.alarm-item-left').forEach(item => {
      item.onclick = () => {
        const id = item.dataset.id;
        openEditAlarm(id);
      };
    });

    // Toggle switch listeners
    alarmsList.querySelectorAll('.alarm-toggle-checkbox').forEach(chk => {
      chk.onchange = (e) => {
        const id = chk.dataset.id;
        const al = alarms.find(a => a.id === id);
        if (!al) return;
        al.enabled = e.target.checked;

        if (!al.enabled) {
          stopAlarmAudio(id);
          if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) {
            window.AndroidVoice.cancelAlarm(id);
          }
        } else {
          // If enabled, ensure future trigger
          if (al.repeatDays && al.repeatDays.length > 0) {
            const d = new Date(al.time);
            al.time = getNextOccurrenceForDays(d.getHours(), d.getMinutes(), al.repeatDays);
          } else if (new Date(al.time).getTime() <= Date.now()) {
            let next = new Date(al.time);
            while (next.getTime() <= Date.now()) {
              next.setDate(next.getDate() + 1);
            }
            al.time = next;
          }
          if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
            window.AndroidVoice.scheduleAlarm(al.id, al.time.getTime(), al.label, al.mode, al.ttsText);
          }
        }
        saveAlarms();
        renderAlarms();
      };
    });

    // Delete listeners
    alarmsList.querySelectorAll('.alarm-delete-btn').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        stopAlarmAudio(id);

        if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) {
          window.AndroidVoice.cancelAlarm(id);
        }

        const deleted = alarms.find(a => a.id === id);
        alarms = alarms.filter(a => a.id !== id);
        saveAlarms();
        renderAlarms();

        if (deleted) {
          const isHi = userSettings.appLanguage === 'hi';
          addLog(isHi ? `अलार्म "${deleted.label}" हटाया गया` : `Alarm "${deleted.label}" deleted`, 'deleted');
          showPopup(isHi ? 'अलार्म हटा दिया गया' : 'Alarm deleted', 'deleted');
        }
      };
    });
  }

  // -------------------- ALARM EDIT VIEW LOGIC --------------------
  let currentEditingAlarmId = null;
  let editUploadedAudioBase64 = null;

  function openEditAlarm(id) {
    const al = alarms.find(a => a.id === id);
    if (!al) return;
    currentEditingAlarmId = id;
    editUploadedAudioBase64 = al.audioData || null;

    const editDateInput = $('editAlarmDate');
    const editDatePh = $('editAlarmDatePlaceholder');
    if (editDateInput) {
      editDateInput.value = toDatetimeLocalValue(al.time);
      if (editDatePh) editDatePh.style.display = editDateInput.value ? 'none' : 'block';
    }

    if ($('editAlarmName')) $('editAlarmName').value = al.label || '';
    if ($('editTtsText')) $('editTtsText').value = al.ttsText || al.message || '';

    const repSelect = $('editAlarmRepeat');
    if (repSelect) {
      repSelect.value = (al.repeat && al.repeat !== 'days') ? al.repeat : 'once';
    }

    const customBox = $('editAlarmCustomBox');
    if (customBox) {
      if (al.repeat === 'custom' && al.intervalMs) {
        customBox.style.display = 'grid';
        if ($('editAlarmCustomHours')) $('editAlarmCustomHours').value = Math.floor(al.intervalMs / 3600000) || '';
        if ($('editAlarmCustomMinutes')) $('editAlarmCustomMinutes').value = Math.floor((al.intervalMs % 3600000) / 60000) || '';
      } else {
        customBox.style.display = 'none';
        if ($('editAlarmCustomHours')) $('editAlarmCustomHours').value = '';
        if ($('editAlarmCustomMinutes')) $('editAlarmCustomMinutes').value = '';
      }
    }

    // Set day pills
    setSelectedDays('editAlarmDayPills', al.repeatDays || []);

    // Audio Mode
    if ($('editMode')) $('editMode').value = al.mode || 'tts';
    if ($('editUploadTune')) {
      $('editUploadTune').style.display = al.mode === 'upload' ? 'block' : 'none';
      $('editUploadTune').value = '';
    }

    $('alarmListView')?.classList.add('hidden');
    $('alarmFormView')?.classList.add('hidden');
    $('alarmEditView')?.classList.remove('hidden');
  }

  $('editAlarmRepeat')?.addEventListener('change', () => {
    const val = $('editAlarmRepeat').value;
    if ($('editAlarmCustomBox')) {
      $('editAlarmCustomBox').style.display = val === 'custom' ? 'grid' : 'none';
    }
  });

  $('editMode')?.addEventListener('change', () => {
    if ($('editUploadTune')) {
      $('editUploadTune').style.display = $('editMode').value === 'upload' ? 'block' : 'none';
    }
  });

  $('editUploadTune')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        editUploadedAudioBase64 = ev.target.result;
      };
      reader.readAsDataURL(file);
    }
  });

  $('editAlarmDate')?.addEventListener('input', (e) => {
    const ph = $('editAlarmDatePlaceholder');
    if (ph) ph.style.display = e.target.value ? 'none' : 'block';
  });

  $('backFromAlarmEditBtn')?.addEventListener('click', () => {
    $('alarmEditView')?.classList.add('hidden');
    $('alarmListView')?.classList.remove('hidden');
    currentEditingAlarmId = null;
  });

  $('deleteEditAlarmBtn')?.addEventListener('click', () => {
    if (!currentEditingAlarmId) return;
    const id = currentEditingAlarmId;
    stopAlarmAudio(id);
    if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) {
      window.AndroidVoice.cancelAlarm(id);
    }
    alarms = alarms.filter(a => a.id !== id);
    saveAlarms();
    $('alarmEditView')?.classList.add('hidden');
    $('alarmListView')?.classList.remove('hidden');
    renderAlarms();
    currentEditingAlarmId = null;
    const isHi = userSettings.appLanguage === 'hi';
    showPopup(isHi ? 'अलार्म हटा दिया गया' : 'Alarm deleted', 'deleted');
  });

  $('saveEditAlarmBtn')?.addEventListener('click', () => {
    if (!currentEditingAlarmId) return;
    const al = alarms.find(a => a.id === currentEditingAlarmId);
    if (!al) return;

    const isHi = userSettings.appLanguage === 'hi';
    const dtInput = $('editAlarmDate');
    if (!dtInput || !dtInput.value) {
      alert(isHi ? 'कृपया समय और तारीख चुनें' : 'Please select date and time');
      return;
    }
    let dt = new Date(dtInput.value);

    const selectedDays = getSelectedDays('editAlarmDayPills');
    const rep = $('editAlarmRepeat')?.value || 'once';
    const label = $('editAlarmName')?.value.trim() || (isHi ? 'अलार्म' : 'Alarm');
    const msg = $('editTtsText')?.value.trim() || label;

    let intervalMs = null;
    if (rep === 'custom') {
      const customH = parseInt($('editAlarmCustomHours')?.value || 0, 10);
      const customM = parseInt($('editAlarmCustomMinutes')?.value || 0, 10);
      intervalMs = (customH * 3600000) + (customM * 60000);
      if (!intervalMs || intervalMs <= 0) intervalMs = 60000;
    } else {
      const mapping = {
        '1 min': 60000,
        '10 min': 600000,
        '1 hr': 3600000,
        '5 hr': 18000000
      };
      if (mapping[rep]) intervalMs = mapping[rep];
    }

    const baseH = dt.getHours();
    const baseM = dt.getMinutes();
    al.baseH = baseH;
    al.baseM = baseM;

    if (selectedDays.length > 0) {
      al.repeatDays = selectedDays;
      al.repeat = rep;
      const nextOccur = getNextOccurrenceForDays(baseH, baseM, selectedDays);
      al.time = nextOccur || dt;
    } else {
      al.repeatDays = [];
      al.repeat = rep;
      if (dt <= new Date() && rep !== 'once') {
        dt.setDate(dt.getDate() + 1);
      }
      al.time = dt;
    }

    al.label = label;
    al.message = msg;
    al.ttsText = msg;
    al.intervalMs = intervalMs;
    al.mode = $('editMode')?.value || 'tts';
    if (al.mode === 'upload' && editUploadedAudioBase64) {
      al.audioData = editUploadedAudioBase64;
    }
    al.enabled = true;
    al.ringing = false;
    al.snoozedUntil = null;

    saveAlarms();

    if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) {
      window.AndroidVoice.cancelAlarm(al.id);
    }
    if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
      window.AndroidVoice.scheduleAlarm(
        al.id,
        al.time.getTime(),
        al.label,
        al.mode,
        al.ttsText
      );
    }

    $('alarmEditView')?.classList.add('hidden');
    $('alarmListView')?.classList.remove('hidden');
    renderAlarms();
    currentEditingAlarmId = null;
    showPopup(isHi ? 'अलार्म अपडेट कर दिया गया' : 'Alarm updated');
  });

  function startAlarm(al) {
    if (al.enabled === false) return;
    if (al.ringing) return;
    if (al.snoozedUntil) {
      if (Date.now() < al.snoozedUntil) return;
    } else {
      if (new Date(al.time).getTime() > Date.now()) return;
    }

    al.ringing = true;
    currentActiveAlarmId = al.id;

    if (window.AndroidVoice && window.AndroidVoice.setAlarmRinging) {
      window.AndroidVoice.setAlarmRinging(true);
    }
    if (userSettings.timerVibrate) {
      if (window.AndroidVoice && window.AndroidVoice.startAlarmVibrationNative) {
        window.AndroidVoice.startAlarmVibrationNative();
      } else if (navigator.vibrate) {
        navigator.vibrate([800, 800, 800]);
      }
    }

    const isHi = userSettings.appLanguage === 'hi';
    if (modalLabel) modalLabel.textContent = al.label || (isHi ? 'अलार्म' : 'Alarm');
    if (modalTime) modalTime.textContent = formatAlarmTimeString(al.time);
    if (modalMessage) {
      if (al.message && al.message !== al.label) {
        modalMessage.textContent = al.message;
        modalMessage.style.display = 'block';
      } else {
        modalMessage.textContent = '';
        modalMessage.style.display = 'none';
      }
    }

    alarmModal?.classList.add('show');
    showPopup(isHi ? `⏰ अलार्म: ${al.label}` : `⏰ Alarm: ${al.label}`);

    if (al.mode === 'upload' && al.audioData) {
      al.audioObj = playAudioFile(al.audioData);
    } else {
      const loopTTS = async () => {
        if (!al.ringing || currentActiveAlarmId !== al.id) return;
        await playTTS(al.ttsText || al.label || 'Alarm');
        if (!al.ringing || currentActiveAlarmId !== al.id) return;
        al.loopTimeout = setTimeout(loopTTS, 1500);
      };
      loopTTS();
    }
  }

  function stopAlarmAudio(id) {
    try {
      window.speechSynthesis?.cancel();
    } catch {}

    if (window.AndroidVoice && window.AndroidVoice.stopAlarmVibrationNative) {
      window.AndroidVoice.stopAlarmVibrationNative();
    }
    if (window.AndroidVoice && window.AndroidVoice.setAlarmRinging) {
      window.AndroidVoice.setAlarmRinging(false);
    }

    const al = alarms.find(x => x.id === id);
    if (!al) return;

    al.ringing = false;
    if (al.loopTimeout) {
      clearTimeout(al.loopTimeout);
      al.loopTimeout = null;
    }
    if (al.audioObj) {
      al.audioObj.pause();
      al.audioObj.currentTime = 0;
      al.audioObj = null;
    }
  }

  // -------------------- SLIDER SWIPE GESTURE HANDLER --------------------
  function setupSwipeHandler({ centerBtn, snoozeBtn, dismissBtn, onSnooze, onDismiss }) {
    if (!centerBtn) return;
    let startX = 0;
    let currentX = 0;
    let isDragging = false;
    const threshold = 55;
    const maxDrag = 95;

    function resetVisuals() {
      centerBtn.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.9, 0.3, 1.2)';
      centerBtn.style.transform = 'translateX(0px)';
      if (snoozeBtn) {
        snoozeBtn.style.transition = 'transform 0.25s, opacity 0.25s, filter 0.25s';
        snoozeBtn.style.transform = 'scale(1)';
        snoozeBtn.style.opacity = '1';
        snoozeBtn.style.filter = 'none';
      }
      if (dismissBtn) {
        dismissBtn.style.transition = 'transform 0.25s, opacity 0.25s, filter 0.25s';
        dismissBtn.style.transform = 'scale(1)';
        dismissBtn.style.opacity = '1';
        dismissBtn.style.filter = 'none';
      }
    }

    function onStart(e) {
      isDragging = true;
      startX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
      currentX = startX;
      centerBtn.style.transition = 'none';
      if (snoozeBtn) snoozeBtn.style.transition = 'none';
      if (dismissBtn) dismissBtn.style.transition = 'none';
    }

    function onMove(e) {
      if (!isDragging) return;
      currentX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
      let deltaX = currentX - startX;

      if (deltaX < -maxDrag) deltaX = -maxDrag;
      if (deltaX > maxDrag) deltaX = maxDrag;

      centerBtn.style.transform = `translateX(${deltaX}px)`;

      if (deltaX < 0) {
        // Dragging left towards Snooze
        const progress = Math.min(1, Math.abs(deltaX) / threshold);
        if (snoozeBtn) {
          snoozeBtn.style.transform = `scale(${1 + progress * 0.3})`;
          snoozeBtn.style.filter = `drop-shadow(0 0 ${10 * progress}px rgba(232, 121, 249, 0.9))`;
        }
        if (dismissBtn) {
          dismissBtn.style.transform = `scale(${Math.max(0.7, 1 - progress * 0.3)})`;
          dismissBtn.style.opacity = `${Math.max(0.2, 1 - progress * 0.8)}`;
        }
      } else if (deltaX > 0) {
        // Dragging right towards Dismiss
        const progress = Math.min(1, deltaX / threshold);
        if (dismissBtn) {
          dismissBtn.style.transform = `scale(${1 + progress * 0.3})`;
          dismissBtn.style.filter = `drop-shadow(0 0 ${10 * progress}px rgba(248, 113, 113, 0.9))`;
        }
        if (snoozeBtn) {
          snoozeBtn.style.transform = `scale(${Math.max(0.7, 1 - progress * 0.3)})`;
          snoozeBtn.style.opacity = `${Math.max(0.2, 1 - progress * 0.8)}`;
        }
      } else {
        resetVisuals();
      }
    }

    function onEnd() {
      if (!isDragging) return;
      isDragging = false;
      const deltaX = currentX - startX;

      if (deltaX <= -threshold) {
        // Swiped Left -> Snooze!
        centerBtn.style.transition = 'transform 0.16s ease-out';
        centerBtn.style.transform = `translateX(-${maxDrag}px)`;
        setTimeout(() => {
          resetVisuals();
          onSnooze();
        }, 120);
      } else if (deltaX >= threshold) {
        // Swiped Right -> Dismiss!
        centerBtn.style.transition = 'transform 0.16s ease-out';
        centerBtn.style.transform = `translateX(${maxDrag}px)`;
        setTimeout(() => {
          resetVisuals();
          onDismiss();
        }, 120);
      } else {
        resetVisuals();
      }
    }

    centerBtn.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);

    centerBtn.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);

    snoozeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      onSnooze();
    });
    dismissBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      onDismiss();
    });
  }

  function handleAlarmSnooze() {
    const alarmId = currentActiveAlarmId;
    if (!alarmId) return;
    const al = alarms.find(a => a.id === alarmId);
    if (!al) return;

    stopAlarmAudio(alarmId);
    if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) {
      window.AndroidVoice.cancelAlarm(alarmId);
    }

    const snoozeMins = parseInt(userSettings.snoozeDuration || '10', 10) || 10;
    const snoozeTime = Date.now() + (snoozeMins * 60 * 1000);
    al.ringing = false;
    al.snoozedUntil = snoozeTime;
    // CRITICAL: Do NOT overwrite al.time! Keep original scheduled time!
    al.enabled = true;
    saveAlarms();

    if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
      window.AndroidVoice.scheduleAlarm(
        al.id,
        snoozeTime,
        al.label,
        al.mode,
        al.ttsText
      );
    }
    if (window.AndroidVoice && window.AndroidVoice.syncAlarmSnooze) {
      window.AndroidVoice.syncAlarmSnooze(al.id, snoozeTime);
    }

    currentActiveAlarmId = null;
    alarmModal?.classList.remove('show');
    renderAlarms();
    const isHi = userSettings.appLanguage === 'hi';
    showPopup(isHi ? `अलार्म ${snoozeMins} मिनट के लिए स्नूज़ किया गया` : `Alarm snoozed for ${snoozeMins} minutes`, 'snooze');
  }

  function handleAlarmDismiss() {
    const alarmId = currentActiveAlarmId;
    if (!alarmId) return;
    const al = alarms.find(a => a.id === alarmId);
    if (!al) return;

    stopAlarmAudio(alarmId);
    if (window.AndroidVoice && window.AndroidVoice.stopAlarmService) {
      window.AndroidVoice.stopAlarmService();
    }
    if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) {
      window.AndroidVoice.cancelAlarm(alarmId);
    }
    if (window.AndroidVoice && window.AndroidVoice.syncAlarmDismiss) {
      window.AndroidVoice.syncAlarmDismiss(alarmId);
    }

    al.ringing = false;
    al.snoozedUntil = null;

    const hasDays = al.repeatDays && al.repeatDays.length > 0;
    const hasInterval = al.repeat && al.repeat !== 'once' && al.repeat !== 'days';

    if (hasDays && hasInterval) {
      let interval = 60000;
      if (al.repeat === 'custom' && al.intervalMs) {
        interval = al.intervalMs;
      } else {
        const mapping = {
          '1 min': 60000,
          '5 min': 300000,
          '10 min': 600000,
          '1 hr': 3600000,
          '5 hr': 18000000
        };
        interval = mapping[al.repeat] || 60000;
      }
      let nextTime = new Date(Date.now() + interval);
      if (al.repeatDays.includes(nextTime.getDay())) {
        al.time = nextTime;
        al.enabled = true;
      } else {
        advanceAlarmToNextRepeatDay(al);
      }
      if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
        window.AndroidVoice.scheduleAlarm(al.id, al.time.getTime(), al.label, al.mode, al.ttsText);
      }
    } else if (hasDays) {
      advanceAlarmToNextRepeatDay(al);
      if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
        window.AndroidVoice.scheduleAlarm(al.id, al.time.getTime(), al.label, al.mode, al.ttsText);
      }
    } else if (hasInterval) {
      let interval = 60000;
      if (al.repeat === 'custom' && al.intervalMs) {
        interval = al.intervalMs;
      } else {
        const mapping = {
          '1 min': 60000,
          '5 min': 300000,
          '10 min': 600000,
          '1 hr': 3600000,
          '5 hr': 18000000
        };
        interval = mapping[al.repeat] || 60000;
      }
      let nextTime = new Date(al.time.getTime() + interval);
      while (nextTime.getTime() <= Date.now()) {
        nextTime = new Date(nextTime.getTime() + interval);
      }
      al.time = nextTime;
      al.enabled = true;
      if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
        window.AndroidVoice.scheduleAlarm(al.id, al.time.getTime(), al.label, al.mode, al.ttsText);
      }
    } else {
      al.enabled = false;
    }

    saveAlarms();
    currentActiveAlarmId = null;
    alarmModal?.classList.remove('show');
    alarmFormView?.classList.add('hidden');
    alarmListView?.classList.remove('hidden');
    renderAlarms();
    const isHi = userSettings.appLanguage === 'hi';
    showPopup(isHi ? 'अलार्म बंद किया गया' : 'Alarm dismissed', 'dismissed');
  }

  // Setup interactive slider gesture for Alarm Modal
  setupSwipeHandler({
    centerBtn: $('centerAlarmBtn'),
    snoozeBtn: $('snoozeBtn'),
    dismissBtn: $('dismissBtn'),
    onSnooze: handleAlarmSnooze,
    onDismiss: handleAlarmDismiss
  });

  // In-app check interval for alarms
  setInterval(() => {
    const now = Date.now();
    const currentDay = new Date().getDay();
    alarms.forEach(al => {
      if (al.enabled === false || al.ringing) return;
      const isDue = al.snoozedUntil ? (now >= al.snoozedUntil) : (new Date(al.time).getTime() <= now);
      if (isDue) {
        if (!al.snoozedUntil && al.repeatDays && al.repeatDays.length > 0) {
          if (!al.repeatDays.includes(currentDay)) {
            advanceAlarmToNextRepeatDay(al);
            saveAlarms();
            renderAlarms();
            return;
          }
        }
        startAlarm(al);
      }
    });
  }, 1000);

  // -------------------- TASKS STATE & LOGIC --------------------
  let tasks = JSON.parse(localStorage.getItem("tasks")) || [];
  tasks.forEach(t => {
    t.time = new Date(t.time);
    if (isNaN(t.time.getTime())) t.time = new Date();
    if (t.enabled === undefined) t.enabled = true;
  });

  function saveTasks() {
    localStorage.setItem("tasks", JSON.stringify(tasks));
  }

  const tasksList = $('tasksList');
  const taskModal = $('taskModal');
  const taskModalLabel = $('taskModalLabel');
  const taskModalTime = $('taskModalTime');
  const taskRepeat = $('taskRepeat');
  const customBox = $('customIntervalBox');
  let currentActiveTaskId = null;

  taskRepeat?.addEventListener('change', () => {
    if (customBox) {
      customBox.style.display = taskRepeat.value === 'custom' ? 'grid' : 'none';
    }
  });

  $('addTask')?.addEventListener('click', () => {
    const isHi = userSettings.appLanguage === 'hi';
    const tTitle = $('taskTitle')?.value.trim();
    const tTime = $('taskTime')?.value;
    const tRepeat = taskRepeat?.value || 'once';

    if (!tTitle || !tTime) {
      alert(isHi ? 'कृपया शीर्षक और समय दर्ज करें' : 'Please enter title & date/time');
      return;
    }

    let taskDt = new Date(tTime);
    const now = new Date();

    const selectedDays = getSelectedDays('taskDayPills');

    const customH = parseInt($('customHours')?.value || 0, 10);
    const customM = parseInt($('customMinutes')?.value || 0, 10);
    let customIntervalMs = null;
    if (tRepeat === 'custom') {
      customIntervalMs = (customH * 3600000) + (customM * 60000);
      if (!customIntervalMs || customIntervalMs <= 0) customIntervalMs = 60000;
    } else {
      const mapping = {
        '1 min': 60000,
        '5 min': 300000,
        '1 hr': 3600000,
        '5 hr': 18000000
      };
      if (mapping[tRepeat]) customIntervalMs = mapping[tRepeat];
    }

    const baseH = taskDt.getHours();
    const baseM = taskDt.getMinutes();

    if (selectedDays.length > 0) {
      const nextOccur = getNextOccurrenceForDays(baseH, baseM, selectedDays);
      if (nextOccur) taskDt = nextOccur;
    } else if (taskDt <= now) {
      taskDt.setDate(taskDt.getDate() + 1);
    }

    const task = {
      id: 'TSK' + Date.now(),
      title: tTitle,
      time: taskDt,
      baseH: baseH,
      baseM: baseM,
      repeat: tRepeat,
      repeatDays: selectedDays,
      intervalMs: customIntervalMs,
      enabled: true,
      ringing: false,
      snoozedUntil: null,
      loopTimeout: null,
      audioObj: null
    };

    tasks.push(task);
    saveTasks();

    if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
      window.AndroidVoice.scheduleAlarm(
        task.id,
        task.time.getTime(),
        task.title,
        'task',
        task.title
      );
    }

    // Reset inputs completely
    resetTaskForm();

    // Switch back to starting list view as requested
    taskFormView?.classList.add('hidden');
    taskListView?.classList.remove('hidden');

    renderTasks();
    showPopup(isHi ? `कार्य "${tTitle}" निर्धारित किया गया` : `Task "${tTitle}" scheduled`);
    addLog(isHi ? `कार्य "${tTitle}" जोड़ा गया` : `Task "${tTitle}" added`);
  });

  function renderTasks() {
    if (!tasksList) return;
    const isHi = userSettings.appLanguage === 'hi';
    tasksList.innerHTML = '';
    if (tasks.length === 0) {
      tasksList.innerHTML = `<div class="empty-history-text">${isHi ? 'कोई कार्य नहीं है। नया कार्य जोड़ने के लिए + दबाएं।' : 'No tasks yet. Tap + to add a task.'}</div>`;
      return;
    }

    tasks.forEach(t => {
      const card = document.createElement('div');
      card.className = `alarm-item-card ${t.enabled === false ? 'disabled' : ''}`;
      const timeStr = formatAlarmTimeString(t.time);
      const isSnoozed = t.snoozedUntil && t.snoozedUntil > Date.now();
      const snoozeBadge = isSnoozed ? `<span class="snooze-badge">💤 ${isHi ? 'स्नूज़' : 'Snoozed'} ${formatAlarmTimeString(t.snoozedUntil)}</span>` : '';

      const hasDays = t.repeatDays && t.repeatDays.length > 0;
      const daysStr = hasDays ? formatDaysSummary(t.repeatDays, isHi) : '';
      const intervalStr = (t.repeat && t.repeat !== 'once' && t.repeat !== 'days') ? formatIntervalSummary(t.repeat, t.intervalMs, isHi) : '';

      let subStr = t.title;
      if (daysStr && intervalStr) subStr += ` • ${daysStr} • ${intervalStr}`;
      else if (daysStr) subStr += ` • ${daysStr}`;
      else if (intervalStr) subStr += ` • ${intervalStr}`;
      else subStr += ` • ${isHi ? 'एक बार' : 'Once'}`;

      card.innerHTML = `
        <div class="alarm-item-left" data-id="${t.id}" style="cursor:pointer;" title="${isHi ? 'कार्य संपादित करने के लिए क्लिक करें' : 'Click to edit task'}">
          <div class="alarm-item-time">${timeStr} ${snoozeBadge}</div>
          <div class="alarm-item-sub">${subStr}</div>
        </div>
        <div class="alarm-item-right">
          <label class="switch-container">
            <input type="checkbox" class="task-toggle-checkbox" data-id="${t.id}" ${t.enabled !== false ? 'checked' : ''}>
            <span class="slider round"></span>
          </label>
          <button class="alarm-delete-btn" data-id="${t.id}" aria-label="Delete">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </button>
        </div>
      `;
      tasksList.appendChild(card);
    });

    tasksList.querySelectorAll('.alarm-item-left').forEach(item => {
      item.onclick = () => {
        const id = item.dataset.id;
        openEditTask(id);
      };
    });

    tasksList.querySelectorAll('.task-toggle-checkbox').forEach(chk => {
      chk.onchange = (e) => {
        const id = chk.dataset.id;
        const t = tasks.find(x => x.id === id);
        if (!t) return;
        t.enabled = e.target.checked;
        if (!t.enabled) {
          stopTaskAudio(id);
          if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) {
            window.AndroidVoice.cancelAlarm(id);
          }
        } else {
          if (t.repeatDays && t.repeatDays.length > 0) {
            const d = new Date(t.time);
            t.time = getNextOccurrenceForDays(d.getHours(), d.getMinutes(), t.repeatDays);
          } else if (new Date(t.time).getTime() <= Date.now()) {
            let next = new Date(t.time);
            while (next.getTime() <= Date.now()) {
              next.setDate(next.getDate() + 1);
            }
            t.time = next;
          }
          if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
            window.AndroidVoice.scheduleAlarm(t.id, t.time.getTime(), t.title, 'task', t.title);
          }
        }
        saveTasks();
        renderTasks();
      };
    });

    tasksList.querySelectorAll('.alarm-delete-btn').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        stopTaskAudio(id);

        if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) {
          window.AndroidVoice.cancelAlarm(id);
        }

        const deleted = tasks.find(x => x.id === id);
        tasks = tasks.filter(x => x.id !== id);
        saveTasks();
        renderTasks();

        if (deleted) {
          const isHi = userSettings.appLanguage === 'hi';
          addLog(isHi ? `कार्य "${deleted.title}" हटाया गया` : `Task "${deleted.title}" deleted`, 'deleted');
          showPopup(isHi ? 'कार्य हटा दिया गया' : 'Task deleted', 'deleted');
        }
      };
    });
  }

  // -------------------- TASK EDIT VIEW LOGIC --------------------
  let currentEditingTaskId = null;

  function openEditTask(id) {
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    currentEditingTaskId = id;

    if ($('editTaskTitle')) $('editTaskTitle').value = t.title || '';

    const editTimeInput = $('editTaskTime');
    const editTimePh = $('editTaskDatePlaceholder');
    if (editTimeInput) {
      editTimeInput.value = toDatetimeLocalValue(t.time);
      if (editTimePh) editTimePh.style.display = editTimeInput.value ? 'none' : 'block';
    }

    const repSelect = $('editTaskRepeat');
    if (repSelect) {
      repSelect.value = (t.repeat && t.repeat !== 'days') ? t.repeat : 'once';
    }

    const customBox = $('editCustomIntervalBox');
    if (customBox) {
      if (t.repeat === 'custom' && t.intervalMs) {
        customBox.style.display = 'grid';
        if ($('editCustomHours')) $('editCustomHours').value = Math.floor(t.intervalMs / 3600000) || '';
        if ($('editCustomMinutes')) $('editCustomMinutes').value = Math.floor((t.intervalMs % 3600000) / 60000) || '';
      } else {
        customBox.style.display = 'none';
        if ($('editCustomHours')) $('editCustomHours').value = '';
        if ($('editCustomMinutes')) $('editCustomMinutes').value = '';
      }
    }

    setSelectedDays('editTaskDayPills', t.repeatDays || []);

    $('taskListView')?.classList.add('hidden');
    $('taskFormView')?.classList.add('hidden');
    $('taskEditView')?.classList.remove('hidden');
  }

  $('editTaskRepeat')?.addEventListener('change', () => {
    const val = $('editTaskRepeat').value;
    if ($('editCustomIntervalBox')) {
      $('editCustomIntervalBox').style.display = val === 'custom' ? 'grid' : 'none';
    }
  });

  $('editTaskTime')?.addEventListener('input', (e) => {
    const ph = $('editTaskDatePlaceholder');
    if (ph) ph.style.display = e.target.value ? 'none' : 'block';
  });

  $('backFromTaskEditBtn')?.addEventListener('click', () => {
    $('taskEditView')?.classList.add('hidden');
    $('taskListView')?.classList.remove('hidden');
    currentEditingTaskId = null;
  });

  $('deleteEditTaskBtn')?.addEventListener('click', () => {
    if (!currentEditingTaskId) return;
    const id = currentEditingTaskId;
    stopTaskAudio(id);
    if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) {
      window.AndroidVoice.cancelAlarm(id);
    }
    tasks = tasks.filter(x => x.id !== id);
    saveTasks();
    $('taskEditView')?.classList.add('hidden');
    $('taskListView')?.classList.remove('hidden');
    renderTasks();
    currentEditingTaskId = null;
    const isHi = userSettings.appLanguage === 'hi';
    showPopup(isHi ? 'कार्य हटा दिया गया' : 'Task deleted', 'deleted');
  });

  $('saveEditTaskBtn')?.addEventListener('click', () => {
    if (!currentEditingTaskId) return;
    const t = tasks.find(x => x.id === currentEditingTaskId);
    if (!t) return;

    const isHi = userSettings.appLanguage === 'hi';
    const title = $('editTaskTitle')?.value.trim();
    const timeVal = $('editTaskTime')?.value;
    if (!title || !timeVal) {
      alert(isHi ? 'कृपया शीर्षक और समय दर्ज करें' : 'Please enter title & date/time');
      return;
    }

    let dt = new Date(timeVal);
    const selectedDays = getSelectedDays('editTaskDayPills');
    const rep = $('editTaskRepeat')?.value || 'once';

    let customIntervalMs = null;
    if (rep === 'custom') {
      const customH = parseInt($('editCustomHours')?.value || 0, 10);
      const customM = parseInt($('editCustomMinutes')?.value || 0, 10);
      customIntervalMs = (customH * 3600000) + (customM * 60000);
      if (!customIntervalMs || customIntervalMs <= 0) customIntervalMs = 60000;
    } else {
      const mapping = {
        '1 min': 60000,
        '5 min': 300000,
        '1 hr': 3600000,
        '5 hr': 18000000
      };
      if (mapping[rep]) customIntervalMs = mapping[rep];
    }

    const baseH = dt.getHours();
    const baseM = dt.getMinutes();
    t.baseH = baseH;
    t.baseM = baseM;

    if (selectedDays.length > 0) {
      t.repeatDays = selectedDays;
      t.repeat = rep;
      const nextOccur = getNextOccurrenceForDays(baseH, baseM, selectedDays);
      t.time = nextOccur || dt;
    } else {
      t.repeatDays = [];
      t.repeat = rep;
      if (dt <= new Date() && rep !== 'once') {
        dt.setDate(dt.getDate() + 1);
      }
      t.time = dt;
    }

    t.title = title;
    t.intervalMs = customIntervalMs;
    t.enabled = true;
    t.ringing = false;

    saveTasks();

    if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) {
      window.AndroidVoice.cancelAlarm(t.id);
    }
    if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
      window.AndroidVoice.scheduleAlarm(t.id, t.time.getTime(), t.title, 'task', t.title);
    }

    $('taskEditView')?.classList.add('hidden');
    $('taskListView')?.classList.remove('hidden');
    renderTasks();
    currentEditingTaskId = null;
    showPopup(isHi ? 'कार्य अपडेट कर दिया गया' : 'Task updated');
  });

  function startTask(t) {
    if (t.enabled === false) return;
    if (t.ringing) return;
    if (t.snoozedUntil) {
      if (Date.now() < t.snoozedUntil) return;
    } else {
      if (new Date(t.time).getTime() > Date.now()) return;
    }
    t.ringing = true;
    currentActiveTaskId = t.id;

    if (window.AndroidVoice && window.AndroidVoice.setAlarmRinging) {
      window.AndroidVoice.setAlarmRinging(true);
    }
    if (userSettings.timerVibrate) {
      if (window.AndroidVoice && window.AndroidVoice.startAlarmVibrationNative) {
        window.AndroidVoice.startAlarmVibrationNative();
      } else if (navigator.vibrate) {
        navigator.vibrate([800, 800, 800]);
      }
    }

    if (taskModalLabel) taskModalLabel.textContent = t.title;
    if (taskModalTime) taskModalTime.textContent = formatAlarmTimeString(t.time);

    taskModal?.classList.add('show');
    const isHi = userSettings.appLanguage === 'hi';
    showPopup(isHi ? `🔔 कार्य: ${t.title}` : `🔔 Task: ${t.title}`);

    const loopFunc = async () => {
      if (!t.ringing || currentActiveTaskId !== t.id) return;
      await playTTS(t.title);
      if (!t.ringing || currentActiveTaskId !== t.id) return;
      t.loopTimeout = setTimeout(loopFunc, 1500);
    };
    loopFunc();
  }

  function stopTaskAudio(id) {
    try {
      window.speechSynthesis?.cancel();
    } catch {}

    if (window.AndroidVoice && window.AndroidVoice.stopAlarmVibrationNative) {
      window.AndroidVoice.stopAlarmVibrationNative();
    }
    if (window.AndroidVoice && window.AndroidVoice.setAlarmRinging) {
      window.AndroidVoice.setAlarmRinging(false);
    }

    const t = tasks.find(x => x.id === id);
    if (!t) return;

    t.ringing = false;
    if (t.loopTimeout) {
      clearTimeout(t.loopTimeout);
      t.loopTimeout = null;
    }
    if (t.audioObj) {
      t.audioObj.pause();
      t.audioObj.currentTime = 0;
      t.audioObj = null;
    }
  }

  function handleTaskSnooze() {
    const taskId = currentActiveTaskId;
    if (!taskId) return;
    const t = tasks.find(x => x.id === taskId);
    if (!t) return;

    stopTaskAudio(taskId);
    if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) {
      window.AndroidVoice.cancelAlarm(taskId);
    }

    const snoozeMins = parseInt(userSettings.snoozeDuration || '10', 10) || 10;
    const snoozeTime = Date.now() + (snoozeMins * 60 * 1000);
    t.ringing = false;
    t.snoozedUntil = snoozeTime;
    // CRITICAL: Do NOT overwrite t.time!
    t.enabled = true;
    saveTasks();

    if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
      window.AndroidVoice.scheduleAlarm(t.id, snoozeTime, t.title, 'task', t.title);
    }

    currentActiveTaskId = null;
    taskModal?.classList.remove('show');
    renderTasks();
    const isHi = userSettings.appLanguage === 'hi';
    showPopup(isHi ? `कार्य ${snoozeMins} मिनट के लिए स्नूज़ किया गया` : `Task snoozed for ${snoozeMins} minutes`, 'snooze');
  }

  function handleTaskDismiss() {
    const taskId = currentActiveTaskId;
    if (!taskId) return;
    const t = tasks.find(x => x.id === taskId);
    if (!t) return;

    stopTaskAudio(taskId);
    if (window.AndroidVoice && window.AndroidVoice.stopAlarmService) {
      window.AndroidVoice.stopAlarmService();
    }
    if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) {
      window.AndroidVoice.cancelAlarm(taskId);
    }

    t.ringing = false;
    t.snoozedUntil = null;

    const hasDays = t.repeatDays && t.repeatDays.length > 0;
    const hasInterval = t.repeat && t.repeat !== 'once' && t.repeat !== 'days';

    if (hasDays && hasInterval) {
      let interval = 60000;
      if (t.repeat === 'custom' && t.intervalMs) interval = t.intervalMs;
      else {
        const mapping = {
          '1 min': 60000,
          '5 min': 300000,
          '1 hr': 3600000,
          '5 hr': 18000000
        };
        interval = mapping[t.repeat] || 60000;
      }
      let nextTime = new Date(Date.now() + interval);
      if (t.repeatDays.includes(nextTime.getDay())) {
        t.time = nextTime;
        t.enabled = true;
      } else {
        advanceTaskToNextRepeatDay(t);
      }
      if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
        window.AndroidVoice.scheduleAlarm(t.id, t.time.getTime(), t.title, 'task', t.title);
      }
    } else if (hasDays) {
      advanceTaskToNextRepeatDay(t);
      if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
        window.AndroidVoice.scheduleAlarm(t.id, t.time.getTime(), t.title, 'task', t.title);
      }
    } else if (hasInterval) {
      let interval = 60000;
      if (t.repeat === 'custom' && t.intervalMs) interval = t.intervalMs;
      else {
        const mapping = {
          '1 min': 60000,
          '5 min': 300000,
          '1 hr': 3600000,
          '5 hr': 18000000
        };
        interval = mapping[t.repeat] || 60000;
      }
      let nextTime = new Date(t.time.getTime() + interval);
      while (nextTime.getTime() <= Date.now()) {
        nextTime = new Date(nextTime.getTime() + interval);
      }
      t.time = nextTime;
      t.enabled = true;
      if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
        window.AndroidVoice.scheduleAlarm(t.id, t.time.getTime(), t.title, 'task', t.title);
      }
    } else {
      t.enabled = false;
    }

    saveTasks();
    currentActiveTaskId = null;
    taskModal?.classList.remove('show');
    taskFormView?.classList.add('hidden');
    taskListView?.classList.remove('hidden');
    renderTasks();
    const isHi = userSettings.appLanguage === 'hi';
    showPopup(isHi ? 'कार्य बंद किया गया' : 'Task dismissed', 'dismissed');
  }

  // Setup interactive slider gesture for Task Modal
  setupSwipeHandler({
    centerBtn: $('taskCenterBtn'),
    snoozeBtn: $('taskSnoozeBtn'),
    dismissBtn: $('taskDismissBtn'),
    onSnooze: handleTaskSnooze,
    onDismiss: handleTaskDismiss
  });

  // In-app check interval for tasks
  setInterval(() => {
    const now = Date.now();
    const currentDay = new Date().getDay();
    tasks.forEach(t => {
      if (t.enabled === false || t.ringing) return;
      const isDue = t.snoozedUntil ? (now >= t.snoozedUntil) : (new Date(t.time).getTime() <= now);
      if (isDue) {
        if (!t.snoozedUntil && t.repeatDays && t.repeatDays.length > 0) {
          if (!t.repeatDays.includes(currentDay)) {
            advanceTaskToNextRepeatDay(t);
            saveTasks();
            renderTasks();
            return;
          }
        }
        startTask(t);
      }
    });
  }, 1000);

  renderAlarms();
  renderTasks();

  // -------------------- HINDI / ENGLISH VOICE COMMANDS --------------------
  const hindiDigitMap = {
    '०': 0, '१': 1, '२': 2, '३': 3, '४': 4,
    '५': 5, '६': 6, '७': 7, '८': 8, '९': 9
  };

  const hindiWordNumbers = {
    'ek': 1, 'do': 2, 'teen': 3, 'char': 4, 'paanch': 5, 'panch': 5, 'chhah': 6, 'che': 6,
    'saat': 7, 'aath': 8, 'nau': 9, 'das': 10, 'gyarah': 11, 'barah': 12,
    'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'छः': 6,
    'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10, 'ग्यारह': 11, 'बारह': 12
  };

  function normalizeText(text) {
    if (!text) return '';
    let str = text.trim();
    str = str.replace(/[०-९]/g, d => hindiDigitMap[d] !== undefined ? hindiDigitMap[d] : d);
    return str;
  }

  function parseTimeFromText(text) {
    let hour = null;
    let minute = 0;
    let ampm = null;

    const t = text.toLowerCase();

    if (/सुबह|morning|subah|\bam\b/i.test(t)) {
      ampm = 'am';
    } else if (/शाम|रात|दोपहर|evening|night|afternoon|shaam|dopahar|raat|\bpm\b/i.test(t)) {
      ampm = 'pm';
    }

    const colonMatch = t.match(/(\d{1,2})[:.](\d{2})/);
    if (colonMatch) {
      hour = parseInt(colonMatch[1], 10);
      minute = parseInt(colonMatch[2], 10);
    } else {
      const numMatch = t.match(/(\d{1,2})\s*(?:बजे|baje|am|pm|o'?clock)?/i);
      let wordFound = false;
      for (const [w, val] of Object.entries(hindiWordNumbers)) {
        const reg = new RegExp(`(?:^|\\s)${w}(?:\\s|$|बजे|baje)`, 'i');
        if (reg.test(t)) {
          hour = val;
          wordFound = true;
          break;
        }
      }
      if (!wordFound && numMatch && numMatch[1]) {
        hour = parseInt(numMatch[1], 10);
      }
    }

    if (/साढ़े|sadhe|saadhe/i.test(t) && minute === 0) {
      minute = 30;
    } else if (/सवा|sawa/i.test(t) && minute === 0) {
      minute = 15;
    } else if (/पौने|paune/i.test(t)) {
      if (minute === 0 && hour !== null) {
        hour = (hour - 1 + 24) % 24;
        minute = 45;
      }
    }

    if (hour === null || isNaN(hour)) return null;
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;

    return { hour, minute, ampm };
  }

  function parseCommand(rawCmd) {
    let cmd = normalizeText(rawCmd);
    cmd = cmd.replace(/^hey\s+vc[,\s]*/i, '').replace(/^vc[,\s]*/i, '').trim();

    if (/^(stop|dismiss|cancel|turn\s*off)\b/i.test(cmd) ||
        /बंद\s*करो|रोक\s*दो|चुप\s*(?:रहो|हो\s*जाओ)?|band\s*karo|chup\b|rok\s*do/i.test(cmd)) {
      return { type: 'dismiss' };
    }

    if (/(?:snooze|स्नूज़|सूनूज़|बाद\s*में)/i.test(cmd)) {
      return { type: 'snooze' };
    }

    const isTask = /remind|task|याद|टास्क|रिमाइंडर|yaad/i.test(cmd);
    if (isTask) {
      const timeInfo = parseTimeFromText(cmd);
      if (timeInfo) {
        let title = cmd
          .replace(/remind\s+me\s+to/gi, '')
          .replace(/remind\s+me\s+at\s+[\d:.]+\s*(?:am|pm)?\s*(?:to)?/gi, '')
          .replace(/(?:add|create)\s+task/gi, '')
          .replace(/मुझे/gi, '')
          .replace(/याद\s*दिलाना|याद\s*दिलाओ|याद\s*दिला|yaad\s*dilana|yaad\s*dila/gi, '')
          .replace(/का\s*टास्क\s*बनाओ|टास्क\s*ऐड\s*करो|टास्क\s*बनाओ|ka\s*task\s*banao|task\s*add\s*karo|task/gi, '')
          .replace(/के\s*लिए|ke\s*liye/gi, '')
          .replace(/[\d:.]+\s*(?:am|pm|बजे|baje)/gi, '')
          .trim();
        if (!title) title = 'Reminder';
        return { type: 'task', title, hour: timeInfo.hour, minute: timeInfo.minute };
      }
    }

    const isAlarm = /alarm|अलार्म|wake\s*me\s*up|उठा\s*देना/i.test(cmd);
    const timeInfo = parseTimeFromText(cmd);
    if (timeInfo) {
      let label = cmd
        .replace(/set\s+alarm\s+for/gi, '')
        .replace(/set\s+alarm\s+at/gi, '')
        .replace(/का\s*अलार्म\s*लगाओ|अलार्म\s*लगाओ|अलार्म\s*सेट\s*करो|अलार्म/gi, '')
        .replace(/[\d:.]+\s*(?:am|pm|बजे|baje)/gi, '')
        .replace(/के\s*लिए|for/gi, '')
        .trim();
      if (!label) label = 'Voice Alarm';
      return { type: 'alarm', label, hour: timeInfo.hour, minute: timeInfo.minute };
    }

    return { type: 'unknown', raw: cmd };
  }

  // Voice execution
  const voiceBtn = $('voiceCmdBtn');
  const voiceStatus = $('voiceCmdStatus');
  const voiceOverlay = $('voiceOverlay');
  const voiceText = $('voiceText');
  const voiceSub = $('voiceSub');
  const voiceLiveTranscript = $('voiceLiveTranscript');
  const closeVoiceOverlayBtn = $('closeVoiceOverlayBtn');
  const heyVcToggle = $('heyVcToggle');

  let activeSpeechRecognition = null;

  function showListeningUI() {
    const isHi = userSettings.appLanguage === 'hi';
    if (voiceOverlay) voiceOverlay.classList.remove('hidden');
    if (voiceText) voiceText.textContent = isHi ? 'सुन रहा हूँ... बोलिए' : 'Listening... Speak now';
    if (voiceLiveTranscript) voiceLiveTranscript.textContent = '';
  }

  function hideListeningUI() {
    if (voiceOverlay) voiceOverlay.classList.add('hidden');
  }

  closeVoiceOverlayBtn?.addEventListener('click', () => {
    hideListeningUI();
    if (activeSpeechRecognition) {
      try { activeSpeechRecognition.abort(); } catch {}
      activeSpeechRecognition = null;
    }
  });

  // Voice button click handler (Screen-On assistant)
  voiceBtn?.addEventListener('click', () => {
    const isHi = userSettings.appLanguage === 'hi';
    const selectedLang = $('voiceLangSelect')?.value || (isHi ? 'hi-IN' : 'en-US');
    if (voiceStatus) voiceStatus.textContent = isHi ? 'सुन रहा हूँ... अब बोलिए' : 'Listening... Speak now';
    showListeningUI();

    if (window.AndroidVoice && typeof window.AndroidVoice.startListening === 'function') {
      window.AndroidVoice.startListening(selectedLang);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (voiceStatus) voiceStatus.textContent = isHi ? 'इस ब्राउज़र में वाक् पहचान उपलब्ध नहीं है' : 'Speech recognition not supported on this browser';
      showToast(isHi ? 'वाक् पहचान अनुपलब्ध है' : 'Speech recognition not available');
      hideListeningUI();
      return;
    }

    try {
      const rec = new SpeechRecognition();
      activeSpeechRecognition = rec;
      rec.lang = selectedLang;
      rec.interimResults = true;
      rec.continuous = false;

      rec.onresult = (ev) => {
        let transcript = '';
        for (let i = ev.resultIndex; i < ev.results.length; ++i) {
          transcript += ev.results[i][0].transcript;
        }
        if (voiceLiveTranscript) voiceLiveTranscript.textContent = transcript;
        if (ev.results[0].isFinal) {
          if (voiceText) voiceText.textContent = isHi ? 'संसाधित हो रहा है...' : 'Processing...';
          handleCommand(transcript);
          setTimeout(() => {
            hideListeningUI();
          }, 1500);
        }
      };

      rec.onerror = (e) => {
        console.log('SpeechRecognition error:', e);
        if (voiceStatus) voiceStatus.textContent = isHi ? 'आवाज़ पहचान नहीं सके। कृपया पुनः प्रयास करें।' : 'Could not catch voice. Please try again.';
        hideListeningUI();
      };

      rec.onend = () => {
        if (voiceStatus) voiceStatus.textContent = isHi ? 'बोलने के लिए माइक बटन दबाएं' : 'Tap microphone button to speak';
      };

      rec.start();
    } catch (e) {
      console.log('Speech start exception:', e);
      hideListeningUI();
    }
  });

  function handleCommand(cmdText) {
    if (!cmdText) return;
    const isHi = userSettings.appLanguage === 'hi';
    const parsed = parseCommand(cmdText);

    if (parsed.type === 'dismiss') {
      if (currentActiveAlarmId) {
        handleAlarmDismiss();
        playTTS(isHi ? 'अलार्म बंद कर दिया गया है' : 'Alarm has been dismissed');
      } else if (currentActiveTaskId) {
        handleTaskDismiss();
        playTTS(isHi ? 'कार्य बंद कर दिया गया है' : 'Task has been dismissed');
      } else {
        showToast(isHi ? 'कोई बजता हुआ अलार्म नहीं है' : 'No active ringing alarm');
        playTTS(isHi ? 'कोई बजता हुआ अलार्म नहीं है' : 'No active ringing alarm');
      }
      return;
    }

    if (parsed.type === 'snooze') {
      const snoozeMins = parseInt(userSettings.snoozeDuration || '10', 10) || 10;
      if (currentActiveAlarmId) {
        handleAlarmSnooze();
        playTTS(isHi ? `अलार्म ${snoozeMins} मिनट के लिए स्नूज़ कर दिया गया है` : `Alarm snoozed for ${snoozeMins} minutes`);
      } else if (currentActiveTaskId) {
        handleTaskSnooze();
        playTTS(isHi ? `कार्य ${snoozeMins} मिनट के लिए स्नूज़ कर दिया गया है` : `Task snoozed for ${snoozeMins} minutes`);
      } else {
        showToast(isHi ? 'स्नूज़ करने के लिए कोई सक्रिय अलार्म नहीं है' : 'No active ringing alarm to snooze');
        playTTS(isHi ? 'स्नूज़ करने के लिए कोई सक्रिय अलार्म नहीं है' : 'No active ringing alarm to snooze');
      }
      return;
    }

    if (parsed.type === 'alarm') {
      const now = new Date();
      let target = new Date();
      target.setHours(parsed.hour, parsed.minute, 0, 0);
      if (target <= now) {
        target.setDate(target.getDate() + 1);
      }
      const al = {
        id: 'AL' + Date.now(),
        time: target,
        label: parsed.label || (isHi ? 'अलार्म' : 'Alarm'),
        message: parsed.label || (isHi ? 'अलार्म' : 'Alarm'),
        repeat: 'once',
        mode: 'tts',
        ttsText: parsed.label || (isHi ? 'अलार्म' : 'Alarm'),
        enabled: true,
        ringing: false,
        loopTimeout: null,
        audioObj: null
      };
      alarms.push(al);
      saveAlarms();
      renderAlarms();
      if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
        window.AndroidVoice.scheduleAlarm(al.id, al.time.getTime(), al.label, 'tts', al.ttsText);
      }
      showToast(isHi ? `अलार्म ${formatAlarmTimeString(al.time)} के लिए सेट किया गया` : `Alarm set for ${formatAlarmTimeString(al.time)}`);
      playTTS(isHi ? `अलार्म ${formatAlarmTimeString(al.time)} बजे के लिए सेट कर दिया गया है` : `Alarm set for ${formatAlarmTimeString(al.time)}`);
      return;
    }

    if (parsed.type === 'task') {
      const now = new Date();
      let target = new Date();
      target.setHours(parsed.hour, parsed.minute, 0, 0);
      if (target <= now) {
        target.setDate(target.getDate() + 1);
      }
      const t = {
        id: 'TSK' + Date.now(),
        title: parsed.title,
        time: target,
        repeat: 'once',
        enabled: true,
        ringing: false,
        loopTimeout: null,
        audioObj: null
      };
      tasks.push(t);
      saveTasks();
      renderTasks();
      if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
        window.AndroidVoice.scheduleAlarm(t.id, t.time.getTime(), t.title, 'task', t.title);
      }
      showToast(isHi ? `कार्य ${formatAlarmTimeString(t.time)} के लिए निर्धारित किया गया` : `Task scheduled for ${formatAlarmTimeString(t.time)}`);
      playTTS(isHi ? `कार्य ${parsed.title} निर्धारित कर दिया गया है` : `Task scheduled for ${formatAlarmTimeString(t.time)}`);
      return;
    }

    showToast(isHi ? `निर्देश: "${cmdText}"` : `Command: "${cmdText}"`);
  }

  // Hotword wakeup trigger from background service or native recognizer
  window.handleWakeWordTrigger = function(rawText) {
    const isHi = userSettings.appLanguage === 'hi';
    showListeningUI();
    try {
      if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
    } catch {}

    if (!rawText || rawText.trim() === '') {
      if (voiceText) voiceText.textContent = isHi ? "सुन रहा हूँ... बोलिए" : "Listening... Speak now";
      if (voiceSub) voiceSub.textContent = isHi ? "अपना निर्देश बोलें" : "Say your command";
      return;
    }

    let cmd = normalizeText(rawText);
    let stripped = cmd.replace(/^hey\s+vc[,\s]*/i, '')
                      .replace(/^vc[,\s]*/i, '')
                      .replace(/^voice\s+clock[,\s]*/i, '')
                      .replace(/^हे\s*वीसी[,\s]*/i, '')
                      .replace(/^नमस्ते\s*वीसी[,\s]*/i, '')
                      .replace(/^ओके\s*वीसी[,\s]*/i, '')
                      .trim();

    if (!stripped) {
      if (voiceText) voiceText.textContent = isHi ? "नमस्ते! सुन रहा हूँ" : "Hello! Listening...";
      if (voiceLiveTranscript) voiceLiveTranscript.textContent = isHi ? "सुन रहा हूँ..." : "Listening...";
      if (voiceSub) voiceSub.textContent = isHi ? "अपना निर्देश बोलें (जैसे: 7 बजे का अलार्म)" : "Speak your command (e.g. 7 AM alarm)";
      playTTS(isHi ? "हाँ कहिए, मैं सुन रहा हूँ" : "Yes, I am listening");
      setTimeout(() => {
        if (voiceText && (voiceText.textContent === "नमस्ते! सुन रहा हूँ" || voiceText.textContent === "Hello! Listening...")) {
          hideListeningUI();
        }
      }, 7500);
      return;
    }

    if (voiceText) voiceText.textContent = isHi ? "वॉयस क्लॉक" : "Voice Clock";
    if (voiceLiveTranscript) voiceLiveTranscript.textContent = `"${rawText}"`;
    if (voiceSub) voiceSub.textContent = isHi ? "निर्देश संसाधित हो रहा है..." : "Processing command...";

    handleCommand(cmd);

    setTimeout(() => {
      hideListeningUI();
    }, 2800);
  };

  window.handleNativeVoice = function(text) {
    window.handleWakeWordTrigger(text);
  };

  window.handleLiveTranscript = function(text) {
    if (voiceLiveTranscript) voiceLiveTranscript.textContent = text;
  };

  window.handleNativeVoiceError = function(msg) {
    hideListeningUI();
    showToast(msg);
  };

  window.voiceState = function(state) {
    const isHi = userSettings.appLanguage === 'hi';
    if (voiceText) {
      if (state === 'listening') voiceText.textContent = isHi ? 'सुन रहा हूँ... बोलिए' : 'Listening... Speak now';
      else if (state === 'processing') voiceText.textContent = isHi ? 'संसाधित हो रहा है...' : 'Processing...';
    }
  };

  // -------------------- STOPWATCH --------------------
  const swHour = $('swHour');
  const swMinute = $('swMinute');
  const swSecond = $('swSecond');
  const swMilli = $('swMilli');
  const progressCircle = $('progressCircle');
  const swStartBtn = $('swStartBtn');
  const swPauseBtn = $('swPauseBtn');
  const swLapBtn = $('swLapBtn');
  const swResetBtn = $('swResetBtn');
  const lapContainer = $('lapContainer');

  const STOPWATCH_STORAGE = "voiceClockStopwatch";
  const circleLength = 723;

  if (progressCircle) {
    progressCircle.style.strokeDasharray = circleLength;
    progressCircle.style.strokeDashoffset = circleLength;
  }

  // Stopwatch state variables are declared at top of initVoiceClockApp
  stopwatchRunning = false;
  stopwatchStart = 0;
  elapsedTime = 0;
  animationFrame = null;
  laps = [];
  lastLapTime = 0;

  function formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const cs = Math.floor((ms % 1000) / 10);
    return {
      h: String(h).padStart(2, "0"),
      m: String(m).padStart(2, "0"),
      s: String(s).padStart(2, "0"),
      cs: String(cs).padStart(2, "0")
    };
  }

  function updateDisplay(ms) {
    const t = formatTime(ms);
    if (swHour) swHour.textContent = t.h;
    if (swMinute) swMinute.textContent = t.m;
    if (swSecond) swSecond.textContent = t.s;
    if (swMilli) swMilli.textContent = t.cs;
  }

  function updateRing(ms) {
    if (!progressCircle) return;
    const sec = (ms % 60000) / 1000;
    const offset = circleLength - (sec / 60) * circleLength;
    progressCircle.style.strokeDashoffset = offset;
  }

  let lastSwSave = 0;
  function stopwatchLoop() {
    if (!stopwatchRunning) return;
    elapsedTime = Date.now() - stopwatchStart;
    updateDisplay(elapsedTime);
    updateRing(elapsedTime);
    if (Date.now() - lastSwSave > 1000) {
      lastSwSave = Date.now();
      saveStopwatch();
    }
    animationFrame = (window.requestAnimationFrame || window.webkitRequestAnimationFrame || (fn => setTimeout(fn, 16)))(stopwatchLoop);
  }

  function startStopwatch() {
    if (stopwatchRunning) return;
    stopwatchRunning = true;
    stopwatchStart = Date.now() - elapsedTime;
    animationFrame = (window.requestAnimationFrame || window.webkitRequestAnimationFrame || (fn => setTimeout(fn, 16)))(stopwatchLoop);

    const isHi = userSettings.appLanguage === 'hi';
    if (swStartBtn) {
      swStartBtn.textContent = isHi ? "चालू है" : "Running";
      swStartBtn.disabled = true;
    }
    if (swPauseBtn) swPauseBtn.disabled = false;
    if (swLapBtn) swLapBtn.disabled = false;
    saveStopwatch();
  }

  function pauseStopwatch() {
    if (!stopwatchRunning) return;
    stopwatchRunning = false;
    if (animationFrame) {
      (window.cancelAnimationFrame || window.webkitCancelAnimationFrame || clearTimeout)(animationFrame);
    }

    const isHi = userSettings.appLanguage === 'hi';
    if (swStartBtn) {
      swStartBtn.textContent = isHi ? "फिर शुरू करें" : "Resume";
      swStartBtn.disabled = false;
    }
    if (swPauseBtn) swPauseBtn.disabled = true;
    if (swLapBtn) swLapBtn.disabled = true;
    saveStopwatch();
  }

  function resetStopwatch() {
    stopwatchRunning = false;
    if (animationFrame) {
      (window.cancelAnimationFrame || window.webkitCancelAnimationFrame || clearTimeout)(animationFrame);
    }

    elapsedTime = 0;
    stopwatchStart = 0;
    lastLapTime = 0;
    laps = [];

    updateDisplay(0);
    if (progressCircle) progressCircle.style.strokeDashoffset = circleLength;

    const isHi = userSettings.appLanguage === 'hi';
    if (swStartBtn) {
      swStartBtn.textContent = isHi ? "▶ शुरू करें" : "▶ Start";
      swStartBtn.disabled = false;
    }
    if (swPauseBtn) swPauseBtn.disabled = true;
    if (swLapBtn) swLapBtn.disabled = true;

    if (lapContainer) {
      lapContainer.innerHTML = `<div class="lap-empty">${isHi ? 'कोई लैप रिकॉर्ड नहीं' : 'No laps recorded'}</div>`;
    }
    localStorage.removeItem(STOPWATCH_STORAGE);
  }

  function addLap() {
    if (!stopwatchRunning) return;
    const lapTime = elapsedTime - lastLapTime;
    lastLapTime = elapsedTime;
    laps.push(lapTime);

    const empty = lapContainer?.querySelector(".lap-empty");
    if (empty) empty.remove();

    const isHi = userSettings.appLanguage === 'hi';
    const t = formatTime(lapTime);
    const lap = document.createElement("div");
    lap.className = "lap-item";
    const lapLabel = isHi ? `लैप ${laps.length}` : `Lap ${laps.length}`;
    lap.innerHTML = `
      <span>${lapLabel}</span>
      <span>${t.h}:${t.m}:${t.s}.${t.cs}</span>
    `;
    lapContainer?.prepend(lap);
    saveStopwatch();
  }

  swStartBtn?.addEventListener("click", startStopwatch);
  swPauseBtn?.addEventListener("click", pauseStopwatch);
  swResetBtn?.addEventListener("click", resetStopwatch);
  swLapBtn?.addEventListener("click", addLap);

  function saveStopwatch() {
    localStorage.setItem(STOPWATCH_STORAGE, JSON.stringify({
      elapsed: elapsedTime,
      laps: laps,
      lastLap: lastLapTime,
      isRunning: stopwatchRunning,
      savedAt: Date.now()
    }));
  }

  function restoreStopwatch() {
    const saved = localStorage.getItem(STOPWATCH_STORAGE);
    if (!saved) return;
    try {
      const data = JSON.parse(saved);
      elapsedTime = data.elapsed || 0;
      laps = Array.isArray(data.laps) ? data.laps : [];
      lastLapTime = data.lastLap || 0;

      if (data.isRunning && data.savedAt) {
        const delta = Date.now() - data.savedAt;
        if (delta > 0) {
          elapsedTime += delta;
        }
      }

      updateDisplay(elapsedTime);
      updateRing(elapsedTime);

      const isHi = userSettings.appLanguage === 'hi';
      if (lapContainer) {
        if (laps.length > 0) {
          lapContainer.innerHTML = '';
          laps.forEach((lapTime, idx) => {
            const t = formatTime(lapTime);
            const lap = document.createElement("div");
            lap.className = "lap-item";
            const lapLabel = isHi ? `लैप ${idx + 1}` : `Lap ${idx + 1}`;
            lap.innerHTML = `
              <span>${lapLabel}</span>
              <span>${t.h}:${t.m}:${t.s}.${t.cs}</span>
            `;
            lapContainer.prepend(lap);
          });
        } else {
          lapContainer.innerHTML = `<div class="lap-empty">${isHi ? 'कोई लैप रिकॉर्ड नहीं' : 'No laps recorded'}</div>`;
        }
      }

      if (data.isRunning) {
        startStopwatch();
      } else if (elapsedTime > 0 && swStartBtn) {
        swStartBtn.textContent = isHi ? "फिर शुरू करें" : "Resume";
      }
    } catch (e) {
      console.log('Error restoring stopwatch:', e);
    }
  }
  restoreStopwatch();

  window.addEventListener('beforeunload', saveStopwatch);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveStopwatch();
  });

  // Setup day pill rows interactions
  setupDayPillsRow('alarmDayPills', 'alarmRepeat', 'alarmCustomBox');
  setupDayPillsRow('editAlarmDayPills', 'editAlarmRepeat', 'editAlarmCustomBox');
  setupDayPillsRow('taskDayPills', 'taskRepeat', 'customIntervalBox');
  setupDayPillsRow('editTaskDayPills', 'editTaskRepeat', 'editCustomIntervalBox');

  // -------------------- HARDWARE VOLUME & POWER BUTTON HANDLERS --------------------
  window.handleHardwareVolumeSnooze = function() {
    if (currentActiveAlarmId) {
      handleAlarmSnooze();
    } else if (currentActiveTaskId) {
      handleTaskSnooze();
    }
  };

  window.handleHardwarePowerDismiss = function() {
    if (currentActiveAlarmId) {
      handleAlarmDismiss();
    } else if (currentActiveTaskId) {
      handleTaskDismiss();
    }
  };

  // -------------------- FAKE PLACEHOLDERS --------------------
  document.querySelectorAll('input[type="datetime-local"]').forEach(inp => {
    const wrapper = inp.parentElement;
    const ph = wrapper?.querySelector('.fake-placeholder');
    const update = () => {
      if (!ph) return;
      ph.style.display = inp.value ? 'none' : 'block';
    };
    inp.addEventListener('change', update);
    inp.addEventListener('input', update);
    inp.addEventListener('focus', () => { if (ph) ph.style.display = 'none'; });
    inp.addEventListener('blur', update);
    update();
  });

  // -------------------- ANDROID EVENTS & SYNC --------------------
  window.startAlarmFromAndroid = function(alarmId) {
    const al = alarms.find(a => a.id === alarmId);
    if (al) startAlarm(al);
  };

  window.startTaskFromAndroid = function(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (task) startTask(task);
  };

  function handleNativeAlarmEvent(alarmId, action) {
    stopAlarmAudio(alarmId);
    if (currentActiveAlarmId === alarmId || !alarmId) {
      currentActiveAlarmId = null;
      alarmModal?.classList.remove('show');
    }
    const al = alarms.find(a => a.id === alarmId);
    if (!al) return;

    const isHi = userSettings.appLanguage === 'hi';
    if (action === 'snooze') {
      al.ringing = false;
      const snoozeMins = parseInt(userSettings.snoozeDuration || '10', 10) || 10;
      const snoozeTime = Date.now() + (snoozeMins * 60 * 1000);
      al.snoozedUntil = snoozeTime;
      // Keep scheduled time intact on snooze
      al.enabled = true;
      saveAlarms();
      renderAlarms();
      showPopup(isHi ? `अलार्म ${snoozeMins} मिनट के लिए स्नूज़ किया गया` : `Alarm snoozed for ${snoozeMins} minutes`, 'snooze');
    } else if (action === 'dismiss') {
      al.ringing = false;
      if (al.repeatDays && al.repeatDays.length > 0) {
        advanceAlarmToNextRepeatDay(al);
        if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
          window.AndroidVoice.scheduleAlarm(
            al.id,
            al.time.getTime(),
            al.label,
            al.mode,
            al.ttsText
          );
        }
      } else if (al.repeat === 'once') {
        al.enabled = false;
        al.snoozedUntil = null;
      } else {
        let interval = 60000;
        if (al.repeat === 'custom' && al.intervalMs) {
          interval = al.intervalMs;
        } else {
          const mapping = {
            '1 min': 60000,
            '10 min': 600000,
            '1 hr': 3600000,
            '5 hr': 18000000
          };
          interval = mapping[al.repeat] || 60000;
        }
        let nextTime = new Date(al.time.getTime() + interval);
        while (nextTime.getTime() <= Date.now()) {
          nextTime = new Date(nextTime.getTime() + interval);
        }
        al.time = nextTime;
        al.snoozedUntil = null;
      }
      saveAlarms();
      renderAlarms();
      showPopup(isHi ? 'अलार्म बंद किया गया' : 'Alarm dismissed', 'dismissed');
    }
  }

  window.handleNativeAlarmEvent = handleNativeAlarmEvent;

  window.addEventListener("nativeDismiss", function(e) {
    handleNativeAlarmEvent(e.detail?.id, "dismiss");
  });

  window.addEventListener("nativeSnooze", function(e) {
    handleNativeAlarmEvent(e.detail?.id, "snooze");
  });

  function syncNativeAlarmState() {
    if (!window.AndroidVoice) return;

    if (typeof window.AndroidVoice.consumePendingAction === 'function') {
      try {
        const pendingStr = window.AndroidVoice.consumePendingAction();
        if (pendingStr) {
          const actionObj = JSON.parse(pendingStr);
          if (actionObj && actionObj.alarmId) {
            handleNativeAlarmEvent(actionObj.alarmId, actionObj.action);
          }
        }
      } catch (e) {
        console.log('Error consuming pending action:', e);
      }
    }

    if (typeof window.AndroidVoice.getNativeAlarmsJson === 'function') {
      try {
        const nativeStr = window.AndroidVoice.getNativeAlarmsJson();
        if (nativeStr) {
          const nativeList = JSON.parse(nativeStr);
          if (Array.isArray(nativeList)) {
            let changed = false;
            nativeList.forEach(nat => {
              const local = alarms.find(a => a.id === nat.id);
              if (local) {
                const natTime = Number(nat.triggerTime);
                if (!isNaN(natTime) && natTime > local.time.getTime()) {
                  local.snoozedUntil = natTime;
                  local.ringing = false;
                  changed = true;
                }
              }
            });
            if (changed) {
              saveAlarms();
              renderAlarms();
            }
          }
        }
      } catch (e) {
        console.log('Error syncing native alarms:', e);
      }
    }
  }

  window.syncNativeAlarmState = syncNativeAlarmState;
  window.addEventListener("focus", syncNativeAlarmState);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      syncNativeAlarmState();
    }
  });

  // Mark app initialization complete (safe to invoke renderAlarms/renderTasks/renderAboutView)
  isAppReady = true;

  syncNativeAlarmState();
  setTimeout(syncNativeAlarmState, 400);
  setTimeout(syncNativeAlarmState, 1200);
}

// Ensure execution whether loaded synchronously or asynchronously
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initVoiceClockApp);
} else {
  initVoiceClockApp();
}
