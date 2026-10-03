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
    if (window.AndroidVoice) {
      if (typeof window.AndroidVoice.checkAllAlarmPermissions === 'function') {
        window.AndroidVoice.checkAllAlarmPermissions();
      } else {
        if (typeof window.AndroidVoice.checkAndRequestExactAlarmPermission === 'function') {
          window.AndroidVoice.checkAndRequestExactAlarmPermission();
        }
        if (typeof window.AndroidVoice.checkAndRequestBatteryOptimization === 'function') {
          window.AndroidVoice.checkAndRequestBatteryOptimization();
        }
      }
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
    },
    {
      id: 'remind_family_and_friends',
      title: 'Remind Family & Friends and Live Notifications',
      title_hi: 'परिवार और दोस्तों को याद दिलाएं व लाइव सूचनाएं',
      description: 'Cross-device caring reminders with cryptographically non-guessable VC IDs, 8-digit OTP verification, real-time push sync, and system notification bar Accept/Reject action buttons',
      description_hi: 'अभेद्य VC आईडी, 8-अंकीय ओटीपी, रियल-टाइम सिंक और फोन नोटिफिकेशन बार से स्वीकार/अस्वीकार बटनों के साथ परिजनों को रिमाइंडर भेजें',
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
    const snoozeMins = parseInt(userSettings.snoozeDuration || '10', 10) || 10;
    const vol = parseInt(userSettings.alarmVolume, 10) || 80;
    const manualOffset = parseInt(userSettings.manualTimeOffset, 10) || 0;
    const manualEnabled = !!userSettings.manualTimeEnabled;

    if (window.AndroidVoice) {
      if (typeof window.AndroidVoice.syncAllSettings === 'function') {
        window.AndroidVoice.syncAllSettings(
          userSettings.volumeButtonsAction || 'Remind me later',
          userSettings.powerButtonAction || 'Dismiss',
          !!userSettings.timerVibrate,
          snoozeMins,
          userSettings.silenceAfter || '1 minute',
          vol,
          userSettings.gradualVolume || 'Off',
          userSettings.timerSound || '',
          userSettings.timezoneIana || 'Asia/Kolkata',
          manualOffset,
          manualEnabled
        );
      } else if (typeof window.AndroidVoice.syncHardwareSettings === 'function') {
        window.AndroidVoice.syncHardwareSettings(
          userSettings.volumeButtonsAction || 'Remind me later',
          userSettings.powerButtonAction || 'Dismiss',
          !!userSettings.timerVibrate,
          snoozeMins
        );
      }
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
      settingCheckUpdateLabel: 'Check for Updates',
      settingCheckUpdateSub: 'Scan GitHub Releases for latest APK version',
      settingAboutVCLabel: 'About Voice Clock',

      secFamilyTitle: 'Family & Friends Connect',
      settingNotificationsLabel: 'Notifications',
      settingNotificationsSub: 'Incoming reminders, requests & responses',
      notificationsViewTitle: 'Notifications',
      clearAllNotifsBtn: 'Clear',
      settingRemindFamilyLabel: 'Remind Family and Friends',
      settingRemindFamilySub: 'Send caring reminders to loved ones anywhere',
      settingEmailConfigLabel: 'Email Service (Brevo API)',
      settingEmailConfigSub: 'Configure API key for real verification OTP emails',
      emailConfigModalTitle: 'Email Service Settings',
      emailConfigModalSub: 'Brevo (Sendinblue) REST API for authentic OTP delivery',
      lblBrevoApiKey: 'Brevo API Key (xkeysib-...):',
      lblBrevoSenderEmail: 'Sender Email (verified in Brevo):',
      lblBrevoSenderName: 'Sender Name:',
      btnOpenEmailConfig: '⚙ Email Service Settings (Brevo)',
      otpStatusHeading: 'OTP Sent to Email',
      otpStatusDesc: 'Check your inbox and spam folder for the 8-digit verification code.',
      vcCreateTitle: 'Create VC Account',
      familyHeroHeading: 'Stay Connected with Family',
      familyHeroDesc: 'Remind parents to take medicine, ask kids if they had lunch, or schedule caring tasks for friends anywhere in the world.',
      lblVcName: 'Your Name:',
      lblVcEmail: 'Email Address (for verification):',
      btnCreateVcAccountText: 'Create Account & Send OTP',
      linkLoginVcAccount: 'Already have a VC ID? Log In / Restore Account',
      lblLoginVcId: 'Your Existing VC ID:',
      lblLoginUserName: 'Your Name:',
      btnSubmitVcLoginText: 'Log In to Account',
      linkBackToCreateAccount: 'New User? Create Account & Get VC ID',
      vcOtpTitle: 'Verify Email',
      vcOtpHeroHeading: 'Enter 8-Digit OTP',
      lblVcOtp: 'Enter 8-Digit Code:',
      btnVerifyVcOtpText: 'Verify Email',
      btnResendVcOtpText: 'Resend OTP',
      familyHubTitle: 'Remind Family & Friends',
      navSendReminderText: 'Send Reminder',
      navSentRemindersText: 'Sent Reminders',
      navReceivedRemindersText: 'Received Reminders',
      navTrustedVcText: 'Trusted VC IDs',
      trustedVcHeading: 'Trusted VC IDs',
      trustedVcSub: 'Add VC IDs of your loved ones and trusted contacts. Reminders from them will be automatically accepted and scheduled in your Tasks without manual approval.',
      lblAddTrustedVcId: 'Trusted VC ID:',
      lblTrustedVcName: 'Name / Relationship (Optional):',
      btnAddTrustedVcText: 'Add to Trusted Contacts',
      trustedVcGuaranteeDesc: 'Whenever a reminder is sent by any of these trusted contacts, Voice Clock automatically verifies the VC ID, accepts it without prompting for approval, and immediately schedules it in your Tasks.',
      trustedListHeading: 'Saved Trusted Contacts',
      navMyAccountText: 'My VC Account',
      navNotificationsText: 'Notifications',
      sidebarSyncStatus: 'Real-Time Cloud Sync Active',
      sendReminderHeading: 'Send a Caring Reminder',
      sendReminderSub: 'The reminder will alert your family member\'s phone and add to their Voice Clock tasks upon acceptance.',
      lblTargetVcId: 'Recipient VC ID:',
      lblReminderTitle: 'Reminder Message / Task:',
      lblReminderTime: 'Date & Time:',
      lblFamilyRepeat: 'Repetition Time (Optional):',
      familyRepeatDaysLabel: 'Repeat on Days (Optional):',
      familyVoiceSelectLabel: 'Speak With Voice:',
      btnSendFamilyReminderText: 'Send Reminder',
      sentRemindersHeading: 'Sent Reminders',
      sentRemindersSub: 'Track all reminders sent to your loved ones and their real-time acceptance status.',
      receivedRemindersHeading: 'Received Reminders',
      receivedRemindersSub: 'Reminders sent to you by family and friends. Accept to add them to your tasks.',

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
      taskSwipeHintRight: 'Slide to Dismiss ▸',
      alarmVoiceLabel: 'Choose Voice:',
      editAlarmVoiceLabel: 'Choose Voice:',
      taskVoiceLabel: 'Choose Voice:',
      editTaskVoiceLabel: 'Choose Voice:'
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
      settingCheckUpdateLabel: 'अपडेट चेक करें',
      settingCheckUpdateSub: 'नवीनतम APK संस्करण के लिए गिटहब रिलीज़ स्कैन करें',
      settingAboutVCLabel: 'वॉयस क्लॉक के बारे में',

      secFamilyTitle: 'परिवार और मित्र जुड़ाव',
      settingNotificationsLabel: 'सूचनाएं (Notifications)',
      settingNotificationsSub: 'आने वाले रिमाइंडर, अनुरोध और उत्तर',
      notificationsViewTitle: 'सूचनाएं (Notifications)',
      clearAllNotifsBtn: 'हटाएं',
      settingRemindFamilyLabel: 'परिवार और दोस्तों को याद दिलाएं',
      settingRemindFamilySub: 'दूर रहने वाले प्रियजनों को देखभाल भरे रिमाइंडर भेजें',
      settingEmailConfigLabel: 'ईमेल सेवा (Brevo API)',
      settingEmailConfigSub: 'वास्तविक OTP ईमेल भेजने के लिए API की दर्ज करें',
      emailConfigModalTitle: 'ईमेल सेवा सेटिंग्स',
      emailConfigModalSub: 'प्रामाणिक OTP वितरण हेतु Brevo (Sendinblue) REST API',
      lblBrevoApiKey: 'Brevo API Key (xkeysib-...):',
      lblBrevoSenderEmail: 'प्रेषक ईमेल (Brevo में सत्यापित):',
      lblBrevoSenderName: 'प्रेषक का नाम:',
      btnOpenEmailConfig: '⚙ ईमेल सेवा सेटिंग्स (Brevo)',
      otpStatusHeading: 'OTP ईमेल पर भेजा गया',
      otpStatusDesc: '8-अंकीय सत्यापन कोड के लिए अपना इनबॉक्स और स्पैम फ़ोल्डर देखें।',
      vcCreateTitle: 'VC खाता बनाएं',
      familyHeroHeading: 'परिवार से हमेशा जुड़े रहें',
      familyHeroDesc: 'माता-पिता को दवा लेने, बच्चों को खाना खाने याद दिलाएं या दुनिया में कहीं भी दोस्तों के लिए कार्य निर्धारित करें।',
      lblVcName: 'आपका नाम:',
      lblVcEmail: 'ईमेल पता (सत्यापन के लिए):',
      btnCreateVcAccountText: 'खाता बनाएं और OTP भेजें',
      linkLoginVcAccount: 'पहले से VC ID है? खाते में लॉग इन करें',
      lblLoginVcId: 'आपकी मौजूदा VC ID:',
      lblLoginUserName: 'आपका नाम:',
      btnSubmitVcLoginText: 'खाते में लॉग इन करें',
      linkBackToCreateAccount: 'नया खाता बनाएं और VC ID प्राप्त करें',
      vcOtpTitle: 'ईमेल सत्यापित करें',
      vcOtpHeroHeading: '8-अंकीय OTP दर्ज करें',
      lblVcOtp: '8-अंकीय कोड दर्ज करें:',
      btnVerifyVcOtpText: 'ईमेल सत्यापित करें',
      btnResendVcOtpText: 'दोबारा OTP भेजें',
      familyHubTitle: 'परिवार और मित्रों को याद दिलाएं',
      navSendReminderText: 'रिमाइंडर भेजें',
      navSentRemindersText: 'भेजे गए रिमाइंडर',
      navReceivedRemindersText: 'प्राप्त रिमाइंडर',
      navTrustedVcText: 'विश्वसनीय VC ID',
      trustedVcHeading: 'विश्वसनीय VC ID',
      trustedVcSub: 'अपने प्रियजनों और विश्वसनीय संपर्कों की VC ID जोड़ें। उनके द्वारा भेजे गए रिमाइंडर बिना अनुमति पूछे स्वतः टास्क में जुड़ जाएंगे।',
      lblAddTrustedVcId: 'विश्वसनीय VC ID:',
      lblTrustedVcName: 'नाम / संबंध (वैकल्पिक):',
      btnAddTrustedVcText: 'विश्वसनीय संपर्क में जोड़ें',
      trustedVcGuaranteeDesc: 'इन विश्वसनीय संपर्कों से आने वाले रिमाइंडर बिना किसी मैन्युअल पुष्टि के स्वतः स्वीकार होकर आपके टास्क में जुड़ जाएंगे।',
      trustedListHeading: 'सहेजे गए विश्वसनीय संपर्क',
      navMyAccountText: 'मेरा VC खाता',
      navNotificationsText: 'सूचनाएं',
      sidebarSyncStatus: 'रियल-टाइम क्लाउड सिंक सक्रिय है',
      sendReminderHeading: 'देखभाल भरा रिमाइंडर भेजें',
      sendReminderSub: 'स्वीकार करने पर यह रिमाइंडर उनके फोन पर बजेगा और उनके टास्क में स्वतः जुड़ जाएगा।',
      lblTargetVcId: 'प्राप्तकर्ता का VC ID:',
      lblReminderTitle: 'रिमाइंडर संदेश / कार्य:',
      lblReminderTime: 'दिनांक और समय:',
      lblFamilyRepeat: 'दोहराने का समय (वैकल्पिक):',
      familyRepeatDaysLabel: 'दोहराने के दिन (वैकल्पिक):',
      familyVoiceSelectLabel: 'इस आवाज़ में बुलवाएं:',
      btnSendFamilyReminderText: 'रिमाइंडर भेजें',
      sentRemindersHeading: 'भेजे गए रिमाइंडर',
      sentRemindersSub: 'अपने प्रियजनों को भेजे गए सभी रिमाइंडर और उनकी स्वीकृति स्थिति देखें।',
      receivedRemindersHeading: 'प्राप्त रिमाइंडर',
      receivedRemindersSub: 'परिवार और दोस्तों द्वारा आपको भेजे गए रिमाइंडर। अपने टास्क में जोड़ने के लिए स्वीकार करें।',

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
      taskSwipeHintRight: 'बंद करने के लिए स्लाइड करें ▸',
      alarmVoiceLabel: 'आवाज़ चुनें:',
      editAlarmVoiceLabel: 'आवाज़ चुनें:',
      taskVoiceLabel: 'आवाज़ चुनें:',
      editTaskVoiceLabel: 'आवाज़ चुनें:'
    }
  };

  // -------------------- 6 DIVERSE HIGH-QUALITY VOICES (MEN & WOMEN) --------------------
  const VOICE_OPTIONS = [
    {
      id: 'female_1',
      nameEn: 'Aria (Female - Clear & Soft)',
      nameHi: 'आर्या (महिला - सौम्य और स्पष्ट)',
      gender: 'female',
      pitch: 1.15,
      rate: 1.0
    },
    {
      id: 'male_1',
      nameEn: 'Guy (Male - Deep & Bold)',
      nameHi: 'अजय (पुरुष - गंभीर और स्पष्ट)',
      gender: 'male',
      pitch: 0.65,
      rate: 0.95
    },
    {
      id: 'female_2',
      nameEn: 'Jenny (Female - Friendly & Bright)',
      nameHi: 'जेनी (महिला - मधुर और सक्रिय)',
      gender: 'female',
      pitch: 1.30,
      rate: 1.05
    },
    {
      id: 'male_2',
      nameEn: 'David (Male - Calm & Confident)',
      nameHi: 'डेविड (पुरुष - शांत और आत्मविश्वास)',
      gender: 'male',
      pitch: 0.76,
      rate: 0.92
    },
    {
      id: 'female_in',
      nameEn: 'Pooja (Female - Warm Indian Accent)',
      nameHi: 'पूजा (महिला - भारतीय शैली)',
      gender: 'female',
      pitch: 1.12,
      rate: 1.0
    },
    {
      id: 'male_in',
      nameEn: 'Rohan (Male - Gentle Indian Accent)',
      nameHi: 'रोहन (पुरुष - भारतीय शैली)',
      gender: 'male',
      pitch: 0.72,
      rate: 0.95
    }
  ];

  function updateVoiceDropdownOptions(isHi) {
    const dropdownIds = ['alarmVoice', 'editAlarmVoice', 'taskVoice', 'editTaskVoice'];
    dropdownIds.forEach(id => {
      const el = $(id);
      if (!el) return;
      const currentVal = el.value || 'female_1';
      el.innerHTML = '';
      VOICE_OPTIONS.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = isHi ? v.nameHi : v.nameEn;
        if (v.id === currentVal) opt.selected = true;
        el.appendChild(opt);
      });
    });
  }

  function updateDayPillsLanguage(isHi) {
    const dayLabelsEn = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const dayLabelsHi = ['र', 'सो', 'मं', 'बु', 'गु', 'शु', 'श'];
    const labels = isHi ? dayLabelsHi : dayLabelsEn;

    ['alarmDayPills', 'editAlarmDayPills', 'taskDayPills', 'editTaskDayPills', 'familyDayPills'].forEach(containerId => {
      const container = $(containerId);
      if (container) {
        const pills = container.querySelectorAll('.day-pill');
        pills.forEach((p) => {
          const dayNum = parseInt(p.dataset.day, 10);
          if (!isNaN(dayNum) && labels[dayNum]) p.textContent = labels[dayNum];
        });
        if (typeof updateDayPillHint === 'function') {
          updateDayPillHint(containerId);
        }
      }
    });
  }

  function applyStartWeekOnDayPills() {
    const startWeek = (userSettings && userSettings.startWeek) ? userSettings.startWeek : 'Sunday';
    let order = [0, 1, 2, 3, 4, 5, 6];
    if (startWeek === 'Monday') {
      order = [1, 2, 3, 4, 5, 6, 0];
    } else if (startWeek === 'Saturday') {
      order = [6, 0, 1, 2, 3, 4, 5];
    }

    ['alarmDayPills', 'editAlarmDayPills', 'taskDayPills', 'editTaskDayPills', 'familyDayPills'].forEach(containerId => {
      const container = $(containerId);
      if (!container) return;
      const pills = Array.from(container.querySelectorAll('.day-pill'));
      if (pills.length === 0) return;
      order.forEach(dayIndex => {
        const pill = pills.find(p => parseInt(p.dataset.day, 10) === dayIndex);
        if (pill) {
          container.appendChild(pill);
        }
      });
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
      'settingCheckUpdateLabel',
      'settingCheckUpdateSub',
      'settingAboutVCLabel',
      'secFamilyTitle',
      'settingNotificationsLabel',
      'settingNotificationsSub',
      'notificationsViewTitle',
      'clearAllNotifsBtn',
      'settingRemindFamilyLabel',
      'settingRemindFamilySub',
      'settingEmailConfigLabel',
      'settingEmailConfigSub',
      'emailConfigModalTitle',
      'emailConfigModalSub',
      'lblBrevoApiKey',
      'lblBrevoSenderEmail',
      'lblBrevoSenderName',
      'btnOpenEmailConfig',
      'otpStatusHeading',
      'otpStatusDesc',
      'vcCreateTitle',
      'familyHeroHeading',
      'familyHeroDesc',
      'lblVcName',
      'lblVcEmail',
      'btnCreateVcAccountText',
      'linkLoginVcAccount',
      'lblLoginVcId',
      'lblLoginUserName',
      'btnSubmitVcLoginText',
      'linkBackToCreateAccount',
      'vcOtpTitle',
      'vcOtpHeroHeading',
      'lblVcOtp',
      'btnVerifyVcOtpText',
      'btnResendVcOtpText',
      'familyHubTitle',
      'navSendReminderText',
      'navSentRemindersText',
      'navReceivedRemindersText',
      'navTrustedVcText',
      'trustedVcHeading',
      'trustedVcSub',
      'lblAddTrustedVcId',
      'lblTrustedVcName',
      'btnAddTrustedVcText',
      'trustedVcGuaranteeDesc',
      'trustedListHeading',
      'navMyAccountText',
      'navNotificationsText',
      'sidebarSyncStatus',
      'sendReminderHeading',
      'sendReminderSub',
      'lblTargetVcId',
      'lblReminderTitle',
      'lblReminderTime',
      'lblFamilyRepeat',
      'familyRepeatDaysLabel',
      'familyVoiceSelectLabel',
      'btnSendFamilyReminderText',
      'sentRemindersHeading',
      'sentRemindersSub',
      'receivedRemindersHeading',
      'receivedRemindersSub',
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
      'editTaskRepeatDaysLabel',
      'alarmVoiceLabel',
      'editAlarmVoiceLabel',
      'taskVoiceLabel',
      'editTaskVoiceLabel'
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
           <p><strong>5. निर्माता:</strong> <span class="owner-secret-tap">आयुष कुमार सिंह</span> (2026)।</p>`
        : `<p><strong>1. Zero Voice Recording Retention:</strong> Voice Clock does not record or store your voice audio on disk or upload it to any third-party cloud.</p>
           <p><strong>2. Local Speech Recognition:</strong> Voice commands are analyzed directly on your device using native speech recognizers.</p>
           <p><strong>3. Location Privacy:</strong> When automatic time zone detection is enabled, geolocation coordinates are used strictly in local memory to match timezone offsets and are discarded immediately.</p>
           <p><strong>4. Battery Efficiency:</strong> Voice Clock automatically shuts down microphone listeners when your device screen turns off, saving battery.</p>
           <p><strong>5. Created By:</strong> <span class="owner-secret-tap">Ayush Kumar Singh</span> (2026).</p>`;
    }

    updateDayPillsLanguage(isHi);
    updateVoiceDropdownOptions(isHi);

    ['btnPreviewAlarmVoice', 'btnPreviewEditAlarmVoice', 'btnPreviewTaskVoice', 'btnPreviewEditTaskVoice'].forEach(btnId => {
      const btn = $(btnId);
      if (btn) {
        const span = btn.querySelector('span');
        if (span) span.textContent = isHi ? 'सुनें' : 'Listen';
      }
    });

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
    ['settingsView', 'aboutView', 'softwareUpdateView', 'timezoneView', 'optionsDialogModal', 'locationPrivacyModal', 'privacyPolicyModal', 'dateTimeModal', 'notificationsView', 'vcAccountCreateView', 'vcOtpVerifyView', 'remindFamilyHubView'].forEach(id => {
      const el = $(id);
      if (el) el.classList.add('hidden');
    });
    const sb = $('remindFamilySidebar');
    if (sb) sb.classList.add('hidden');
    const sbOv = $('familySidebarOverlay');
    if (sbOv) sbOv.classList.add('hidden');

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

    // 2. Subpages inside Settings / Family Hub
    const sidebar = $('remindFamilySidebar');
    if (sidebar && !sidebar.classList.contains('hidden')) {
      sidebar.classList.add('hidden');
      $('familySidebarOverlay')?.classList.add('hidden');
      return true;
    }
    const notifView = $('notificationsView');
    if (notifView && !notifView.classList.contains('hidden')) {
      notifView.classList.add('hidden');
      return true;
    }
    const familyHub = $('remindFamilyHubView');
    if (familyHub && !familyHub.classList.contains('hidden')) {
      familyHub.classList.add('hidden');
      return true;
    }
    const otpView = $('vcOtpVerifyView');
    if (otpView && !otpView.classList.contains('hidden')) {
      otpView.classList.add('hidden');
      return true;
    }
    const createView = $('vcAccountCreateView');
    if (createView && !createView.classList.contains('hidden')) {
      createView.classList.add('hidden');
      return true;
    }
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
        'Dismiss': 'बंद करें',
        'Control volume': 'आवाज़ नियंत्रित करें',
        'Do nothing': 'कुछ न करें'
      };
      $('settingVolumeButtonsActionSub').textContent = isHi ? (volMapHi[v] || v) : v;
    }
    if ($('settingPowerButtonActionSub')) {
      const p = userSettings.powerButtonAction || 'Dismiss';
      const pwrMapHi = {
        'Dismiss': 'बंद करें',
        'Remind me later': 'बाद में याद दिलाएं',
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
  applyStartWeekOnDayPills();

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
        { label: 'बंद करें', value: 'Dismiss', sub: 'अलार्म को पूरी तरह बंद कर देता है' },
        { label: 'आवाज़ नियंत्रित करें', value: 'Control volume', sub: 'आवाज़ कम या ज्यादा करें' },
        { label: 'कुछ न करें', value: 'Do nothing', sub: 'बटन दबाने पर कुछ नहीं होगा' }
      ] : [
        { label: 'Remind me later', value: 'Remind me later', sub: 'Snoozes the ringing alarm' },
        { label: 'Dismiss', value: 'Dismiss', sub: 'Turns off the ringing alarm' },
        { label: 'Control volume', value: 'Control volume', sub: 'Adjusts alarm sound volume' },
        { label: 'Do nothing', value: 'Do nothing', sub: 'Ignores volume button presses' }
      ],
      currentValue: userSettings.volumeButtonsAction || 'Remind me later',
      onSelect: (val) => {
        userSettings.volumeButtonsAction = val;
        saveSettings();
        applySettingDisplays();
        syncNativeHardwareSettings();
        const displayVal = isHi ? ({ 'Remind me later': 'बाद में याद दिलाएं', 'Dismiss': 'बंद करें', 'Control volume': 'आवाज़ नियंत्रित करें', 'Do nothing': 'कुछ न करें' }[val] || val) : val;
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
        { label: 'बाद में याद दिलाएं', value: 'Remind me later', sub: 'अलार्म को स्नूज़ करता है' },
        { label: 'कुछ न करें', value: 'Do nothing', sub: 'अलार्म बजता रहेगा' }
      ] : [
        { label: 'Dismiss', value: 'Dismiss', sub: 'Turns off the ringing alarm' },
        { label: 'Remind me later', value: 'Remind me later', sub: 'Snoozes the ringing alarm' },
        { label: 'Do nothing', value: 'Do nothing', sub: 'Keeps alarm ringing' }
      ],
      currentValue: userSettings.powerButtonAction || 'Dismiss',
      onSelect: (val) => {
        userSettings.powerButtonAction = val;
        saveSettings();
        applySettingDisplays();
        syncNativeHardwareSettings();
        const displayVal = isHi ? ({ 'Dismiss': 'बंद करें', 'Remind me later': 'बाद में याद दिलाएं', 'Do nothing': 'कुछ न करें' }[val] || val) : val;
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
        applyStartWeekOnDayPills();
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

  const RELEASE_V1_1_0 = {
    version: '1.1.0',
    date: 'October 2026',
    date_hi: 'अक्टूबर 2026',
    type: 'Official Feature & Performance Release',
    type_hi: 'आधिकारिक फीचर एवं सुधार संस्करण',
    size: 'Native Build',
    size_hi: 'मूल संस्करण',
    changelog: [
      'Remind Family & Friends: Send remote reminders to loved ones',
      'Realistic male & female distinct voice selections (6 voices)',
      'Reliable full-screen lock screen alarm & task UI with snooze/dismiss',
      'Instant snooze and dismiss responsiveness without lingering audio',
      'Seamless in-app over-the-air update support'
    ],
    changelog_hi: [
      'रिमाइंड फैमिली और फ्रेंड्स: प्रियजनों को दूर से रिमाइंडर भेजें',
      'वास्तविक पुरुष और महिला की अलग-अलग 6 आवाजें',
      'स्नूज़ और बंद करने के विकल्प के साथ लॉक स्क्रीन अलार्म इंटरफेस',
      'तुरंत स्नूज़ और बंद करने की त्वरित प्रतिक्रिया',
      'सहज इन-ऐप ओवर-द-एयर अपडेट'
    ]
  };

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
  if (!Array.isArray(savedReleases) || savedReleases.length === 0 || savedReleases.some(r => String(r.version).startsWith('2.')) || !savedReleases.some(r => r.version === '1.1.0')) {
    savedReleases = [RELEASE_V1_1_0, DEFAULT_FOUNDATION_RELEASE];
    localStorage.setItem('vc_release_history', JSON.stringify(savedReleases));
  }
  const APP_RELEASES = savedReleases;

  let savedVer = localStorage.getItem('vc_installed_version');
  if (!savedVer || savedVer.startsWith('2.') || compareVersions(savedVer, '1.1.0') < 0) {
    savedVer = '1.1.0';
    localStorage.setItem('vc_installed_version', '1.1.0');
    localStorage.removeItem('vc_pending_update');
  }
  let installedVersion = savedVer;
  let pendingUpdateRelease = JSON.parse(localStorage.getItem('vc_pending_update') || 'null');
  if (pendingUpdateRelease && compareVersions(pendingUpdateRelease.version, installedVersion) <= 0) {
    localStorage.removeItem('vc_pending_update');
    pendingUpdateRelease = null;
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

    const checkBadge = $('settingsCheckUpdateBadge');
    if (checkBadge) {
      if (count > 0) {
        checkBadge.textContent = userSettings.appLanguage === 'hi' ? `अपडेट ${count}` : `Update ${count}`;
        checkBadge.classList.remove('hidden');
      } else {
        checkBadge.classList.add('hidden');
      }
    }

    const versionNewPill = $('aboutVersionNewPill');
    if (versionNewPill) {
      if (count > 0) versionNewPill.classList.remove('hidden');
      else versionNewPill.classList.add('hidden');
    }
  }

  const GITHUB_RELEASES_API = 'https://api.github.com/repos/Abhimanyu-Singh27/Voice_Clock/releases/latest';
  const GITHUB_OTA_URLS = [
    'https://raw.githubusercontent.com/Abhimanyu-Singh27/Voice_Clock/main/update-manifest.json',
    'https://abhimanyu-singh27.github.io/Voice_Clock/update-manifest.json',
    'https://abhimanyu-singh27.github.io/Voice_Clock/www/update-manifest.json',
    'update-manifest.json'
  ];

  async function checkRemoteUpdateManifest() {
    // 1. Primary: Check GitHub Releases API for published APK releases
    try {
      const res = await fetch(GITHUB_RELEASES_API, {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      });
      if (res.ok) {
        const release = await res.json();
        const tag = (release.tag_name || release.name || '').replace(/^[vV]/, '').trim();
        if (tag && compareVersions(tag, installedVersion) > 0) {
          const apkAsset = Array.isArray(release.assets) ? release.assets.find(a => a.name && a.name.toLowerCase().endsWith('.apk')) : null;
          const downloadUrl = apkAsset ? apkAsset.browser_download_url : (release.html_url || 'https://github.com/Abhimanyu-Singh27/Voice_Clock/releases');
          const apkSizeMB = apkAsset && apkAsset.size ? (apkAsset.size / (1024 * 1024)).toFixed(1) + ' MB' : '~10 MB';
          let relDate = 'Today';
          if (release.published_at) {
            try {
              relDate = new Date(release.published_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
            } catch (dErr) {}
          }

          let bullets = [];
          if (release.body) {
            bullets = release.body
              .split('\n')
              .map(l => l.trim())
              .filter(l => l.length > 0)
              .map(l => l.replace(/^[-*#\d.]+\s*/, '').trim())
              .filter(l => l.length > 0);
          }
          if (bullets.length === 0) {
            bullets = [release.name || ('Release v' + tag)];
          }

          pendingUpdateRelease = {
            version: tag,
            date: relDate,
            date_hi: relDate,
            type: 'GitHub Official APK Release',
            type_hi: 'गिटहब आधिकारिक APK रिलीज़',
            size: apkSizeMB,
            size_hi: apkSizeMB,
            changelog: bullets,
            changelog_hi: bullets,
            downloadUrl: downloadUrl,
            isApk: true,
            releaseUrl: release.html_url
          };
          localStorage.setItem('vc_pending_update', JSON.stringify(pendingUpdateRelease));
          refreshSettingsUpdateBadge();
          return pendingUpdateRelease;
        } else if (tag) {
          localStorage.removeItem('vc_pending_update');
          pendingUpdateRelease = null;
          refreshSettingsUpdateBadge();
          return null;
        }
      }
    } catch (apiErr) {
      console.log('GitHub Releases API notice:', apiErr);
    }

    // 2. Secondary fallback: check OTA manifest URLs
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
                size: manifest.downloadSize || '~10 MB',
                size_hi: manifest.downloadSize_hi || manifest.downloadSize || '~10 MB',
                changelog: manifest.releaseNotes || ['New features and improvements'],
                changelog_hi: manifest.releaseNotes_hi || manifest.releaseNotes || ['नई सुविधाएं और सुधार'],
                downloadUrl: manifest.downloadUrl || null,
                isApk: !!manifest.downloadUrl,
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
    if (swScanSubtext) swScanSubtext.textContent = isHi ? 'नई सुविधाओं, प्रदर्शन सुधारों और बग फिक्स के लिए गिटहब रिलीज़ को स्कैन करें।' : 'Scan GitHub Releases to discover new features, performance updates, and bug fixes.';
    if (startScanBtnText) startScanBtnText.textContent = isHi ? 'अपडेट चेक करें' : 'Check for Updates';

    if (softwareUpdateView) softwareUpdateView.classList.remove('hidden');
  }

  function closeSoftwareUpdateScreen() {
    if (softwareUpdateView) softwareUpdateView.classList.add('hidden');
    refreshSettingsUpdateBadge();
  }

  $('settingCheckUpdateBtn')?.addEventListener('click', openSoftwareUpdateScreen);
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

    if (startScanBtnText) startScanBtnText.textContent = isHi ? 'रिलीज़ स्कैन हो रही हैं...' : 'Scanning Releases...';
    if (swScanHeading) swScanHeading.textContent = isHi ? 'अपडेट चेक किया जा रहा है...' : 'Checking for Updates...';
    if (swScanSubtext) swScanSubtext.textContent = isHi ? 'गिटहब रिलीज़ सर्वर से जुड़कर नवीनतम पैकेज सत्यापित किया जा रहा है...' : 'Connecting to GitHub Releases and verifying package information...';

    // Refresh from GitHub Releases & manifest
    await checkRemoteUpdateManifest();

    setTimeout(() => {
      swRadarScanner.classList.remove('scanning');

      // Check if there is an update pending
      const latestRelease = pendingUpdateRelease;
      const hasNewVersion = latestRelease && compareVersions(latestRelease.version, installedVersion) > 0;

      if (hasNewVersion) {
        // Show New Version Card
        if (swScanHeading) swScanHeading.textContent = isHi ? '✨ नया संस्करण उपलब्ध है!' : '✨ New Version Available!';
        if (swScanSubtext) swScanSubtext.textContent = isHi ? `संस्करण v${latestRelease.version} इंस्टॉल करने के लिए तैयार है।` : `Version ${latestRelease.version} is ready for installation.`;

        if (newVersionBadgeTag) newVersionBadgeTag.textContent = `v${latestRelease.version}`;
        if (newVerType) newVerType.textContent = isHi ? (latestRelease.type_hi || latestRelease.type || 'गिटहब आधिकारिक रिलीज़') : (latestRelease.type || 'GitHub Official Release');
        if (newVerDate) newVerDate.textContent = isHi ? (latestRelease.date_hi || latestRelease.date || 'आज') : (latestRelease.date || 'Today');
        if (newVerSize) newVerSize.textContent = isHi ? (latestRelease.size_hi || latestRelease.size || '~10 MB') : (latestRelease.size || '~10 MB');

        if (newVerChangelogList) {
          newVerChangelogList.innerHTML = '';
          const changelogItems = isHi ? (latestRelease.changelog_hi || latestRelease.changelog || ['नई सुविधाएं और बग सुधार']) : (latestRelease.changelog || ['New features and bug fixes']);
          changelogItems.forEach(item => {
            const li = document.createElement('li');
            li.textContent = item;
            newVerChangelogList.appendChild(li);
          });
        }

        const applyBtnTextEl = $('applyUpdateBtnText');
        if (applyBtnTextEl) {
          if (latestRelease.downloadUrl) {
            applyBtnTextEl.textContent = isHi ? 'APK डाउनलोड करें' : 'Download Update APK';
          } else {
            applyBtnTextEl.textContent = isHi ? 'नए संस्करण में अपडेट करें' : 'Update to New Version';
          }
        }

        newVersionCard?.classList.remove('hidden');
        swMainActionWrap?.classList.add('hidden');
      } else {
        // Already up to date
        if (swScanHeading) swScanHeading.textContent = isHi ? '✓ वॉयस क्लॉक अपडेट है' : '✓ Voice Clock is Up to Date';
        if (swScanSubtext) swScanSubtext.textContent = isHi ? `आधिकारिक संस्करण v${installedVersion} चल रहा है। कोई नया अपडेट नहीं मिला।` : `Running official version v${installedVersion}. You have the latest version.`;
        upToDateCard?.classList.remove('hidden');
        if (startScanBtnText) startScanBtnText.textContent = isHi ? 'दोबारा चेक करें' : 'Check Again';
      }
    }, 1200);
  }

  // User decides to Update to New Version
  applyRealtimeUpdateBtn?.addEventListener('click', async () => {
    const isHi = userSettings.appLanguage === 'hi';
    const targetRelease = pendingUpdateRelease || APP_RELEASES[0];

    // If an APK or browser download URL is available
    if (targetRelease && targetRelease.downloadUrl) {
      if (window.AndroidVoice && typeof window.AndroidVoice.openUrl === 'function') {
        window.AndroidVoice.openUrl(targetRelease.downloadUrl);
      } else {
        window.open(targetRelease.downloadUrl, '_system');
      }
      showPopup(isHi ? 'डाउनलोड शुरू हो रहा है! APK डाउनलोड होने पर उस पर टैप करके इंस्टॉल करें।' : 'Opening download in browser! Tap the downloaded APK to install the update.');
      return;
    }

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

  // -------------------- TTS SYSTEM & VOICE ENGINE --------------------
  function stopAllTTS() {
    if (window.AndroidVoice && typeof window.AndroidVoice.stopNativeTTS === 'function') {
      try {
        window.AndroidVoice.stopNativeTTS();
      } catch (e) {
        console.log("stopNativeTTS error:", e);
      }
    }
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
    }
  }

  function playTTS(text, lang = "en-US", voiceId = "female_1") {
    return new Promise((resolve) => {
      if (!text || !text.trim()) {
        resolve();
        return;
      }
      stopAllTTS();

      const selectedLang = $('voiceLangSelect')?.value || (userSettings.appLanguage === 'hi' ? "hi-IN" : "en-US");
      const isHindiText = /[\u0900-\u097F]/.test(text) || (selectedLang && selectedLang.startsWith("hi")) || /\b(baje|lagao|karo|yaad|hai|hain|chup|rok|band|samay)\b/i.test(text);
      const speakLang = isHindiText ? "hi-IN" : (lang || "en-US");
      const activeVoiceId = voiceId || (isHindiText ? "female_in" : "female_1");

      if (window.AndroidVoice && typeof window.AndroidVoice.pauseListeningForTTSNative === 'function') {
        try { window.AndroidVoice.pauseListeningForTTSNative(); } catch (e) {}
      }

      // 1. Android Native TTS (Single source of truth on Android - matches AlarmService)
      if (window.AndroidVoice && typeof window.AndroidVoice.playNativeTTS === 'function') {
        try {
          window.AndroidVoice.playNativeTTS(text, activeVoiceId, speakLang);
          const words = text.trim().split(/\s+/).length;
          const durationMs = Math.max(1800, Math.min(12000, words * 420 + 800));
          setTimeout(() => {
            if (window.AndroidVoice && typeof window.AndroidVoice.resumeListeningAfterTTSNative === 'function') {
              try { window.AndroidVoice.resumeListeningAfterTTSNative(); } catch (e) {}
            }
            resolve();
          }, durationMs);
          return;
        } catch (e) {
          console.log("playNativeTTS error:", e);
        }
      }

      // 2. Web Speech API fallback with precise voice, pitch, and rate
      fallbackWebSpeech(text, speakLang, activeVoiceId, () => {
        if (window.AndroidVoice && typeof window.AndroidVoice.resumeListeningAfterTTSNative === 'function') {
          try { window.AndroidVoice.resumeListeningAfterTTSNative(); } catch (e) {}
        }
        resolve();
      });
    });
  }

  function fallbackWebSpeech(text, lang, voiceId, callback) {
    if (!('speechSynthesis' in window)) {
      if (callback) callback();
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang || 'en-US';

      // Apply voice pitch & rate matching selected voice configuration
      const voiceCfg = (typeof VOICE_OPTIONS !== 'undefined' ? VOICE_OPTIONS.find(v => v.id === voiceId) : null) || { pitch: 1.0, rate: 1.0, gender: 'female' };
      utterance.pitch = voiceCfg.pitch || 1.0;
      utterance.rate = voiceCfg.rate || 1.0;
      utterance.volume = Math.max(0.01, (userSettings.alarmVolume !== undefined ? userSettings.alarmVolume : 80) / 100);

      // Match system browser voice by gender and language if available
      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length > 0) {
        const langMatches = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith(lang.substring(0, 2).toLowerCase()));
        const pool = langMatches.length > 0 ? langMatches : voices;
        const wantGender = voiceCfg.gender; // 'female' or 'male'
        const matchedVoice = pool.find(v => {
          const n = (v.name + " " + (v.voiceURI || '')).toLowerCase();
          return wantGender === 'female'
            ? (n.includes('female') || n.includes('woman') || n.includes('zira') || n.includes('samantha') || n.includes('kavya') || n.includes('priya'))
            : (n.includes('male') || n.includes('man') || n.includes('david') || n.includes('george') || n.includes('ravi') || n.includes('mark') || n.includes('guy'));
        }) || pool[0];
        if (matchedVoice) {
          utterance.voice = matchedVoice;
        }
      }

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

  // Voice Preview Listeners
  function setupVoicePreview(btnId, selectId) {
    const btn = $(btnId);
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const voiceId = $(selectId)?.value || 'female_1';
      const isHi = userSettings.appLanguage === 'hi';
      const sampleText = isHi
        ? 'नमस्ते! यह आपकी चुनी हुई वॉयस क्लॉक आवाज़ है।'
        : 'Hello! This is your selected Voice Clock speech voice.';
      const lang = isHi ? 'hi-IN' : 'en-US';
      showPopup(isHi ? 'आवाज़ का नमूना सुनाया जा रहा है...' : 'Playing voice preview...');
      playTTS(sampleText, lang, voiceId);
    });
  }

  setupVoicePreview('btnPreviewAlarmVoice', 'alarmVoice');
  setupVoicePreview('btnPreviewEditAlarmVoice', 'editAlarmVoice');
  setupVoicePreview('btnPreviewTaskVoice', 'taskVoice');
  setupVoicePreview('btnPreviewEditTaskVoice', 'editTaskVoice');
  setupVoicePreview('btnPreviewFamilyVoice', 'familyVoiceSelect');

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
    if ($('alarmVoice')) $('alarmVoice').value = 'female_1';
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
    if ($('taskVoice')) $('taskVoice').value = 'female_1';
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
  let vcDeletedIds = [];
  try {
    vcDeletedIds = JSON.parse(localStorage.getItem("vc_deleted_ids") || "[]");
    if (!Array.isArray(vcDeletedIds)) vcDeletedIds = [];
  } catch (e) {
    vcDeletedIds = [];
  }

  function markIdAsPermanentlyDeleted(id) {
    if (!id) return;
    try {
      let list = JSON.parse(localStorage.getItem("vc_deleted_ids") || "[]");
      if (!Array.isArray(list)) list = [];
      if (!list.includes(id)) {
        list.push(id);
        if (list.length > 300) list.shift();
        localStorage.setItem("vc_deleted_ids", JSON.stringify(list));
      }
    } catch (e) {}
  }

  function unmarkIdAsDeleted(id) {
    if (!id) return;
    try {
      let list = JSON.parse(localStorage.getItem("vc_deleted_ids") || "[]");
      if (Array.isArray(list)) {
        list = list.filter(x => x !== id);
        localStorage.setItem("vc_deleted_ids", JSON.stringify(list));
      }
    } catch (e) {}
  }

  let alarms = JSON.parse(localStorage.getItem("alarms")) || [];
  alarms = alarms.filter(a => a && a.id && !vcDeletedIds.includes(a.id));
  alarms.forEach(a => {
    a.time = new Date(a.time);
    if (isNaN(a.time.getTime())) a.time = new Date();
    if (a.enabled === undefined) a.enabled = true;
    if (!a.voice) a.voice = 'female_1';
  });

  function saveAlarms() {
    alarms.forEach(a => { if (a && a.id) unmarkIdAsDeleted(a.id); });
    localStorage.setItem("alarms", JSON.stringify(alarms));
  }

  function permanentlyDeleteAlarmItem(id) {
    if (!id) return;
    stopAlarmAudio(id);
    const al = alarms.find(a => a.id === id);
    if (al && al.loopTimeout) {
      clearTimeout(al.loopTimeout);
      al.loopTimeout = null;
    }
    if (currentActiveAlarmId === id) {
      currentActiveAlarmId = null;
      alarmModal?.classList.remove('show');
    }
    markIdAsPermanentlyDeleted(id);
    if (window.AndroidVoice) {
      if (window.AndroidVoice.stopAlarmService) {
        window.AndroidVoice.stopAlarmService();
      }
      if (window.AndroidVoice.cancelAlarm) {
        window.AndroidVoice.cancelAlarm(id);
      }
      if (window.AndroidVoice.syncAlarmDismiss) {
        window.AndroidVoice.syncAlarmDismiss(id);
      }
    }
    alarms = alarms.filter(a => a.id !== id);
    saveAlarms();
    renderAlarms();
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
    const chosenVoice = $('alarmVoice')?.value || 'female_1';

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
      voice: chosenVoice,
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
        al.ttsText,
        al.voice,
        al.intervalMs || 0
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

    let res = '';
    if (daysStr && intervalStr) {
      res = `${daysStr} • ${intervalStr}`;
    } else if (daysStr) {
      res = daysStr;
    } else if (intervalStr) {
      res = intervalStr;
    } else if (al.repeat === 'once') {
      const d = new Date(al.time);
      const daysEn = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const daysHi = ["रवि", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि"];
      const monthsEn = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const monthsHi = ["जन", "फ़र", "मार्च", "अप्रैल", "मई", "जून", "जुल", "अग", "सितं", "अक्तू", "नवं", "दिसं"];
      const day = isHi ? daysHi[d.getDay()] : daysEn[d.getDay()];
      const month = isHi ? monthsHi[d.getMonth()] : monthsEn[d.getMonth()];
      res = isHi ? `एक बार • ${day}, ${d.getDate()} ${month}` : `Once • ${day}, ${d.getDate()} ${month}`;
    } else {
      res = al.repeat || (isHi ? 'प्रतिदिन' : 'Every day');
    }

    if (al.mode !== 'upload' && al.voice && typeof VOICE_OPTIONS !== 'undefined') {
      const vObj = VOICE_OPTIONS.find(v => v.id === al.voice);
      if (vObj) {
        const vName = isHi ? vObj.nameHi.split(' ')[0] : vObj.nameEn.split(' ')[0];
        res += ` • 🎙️ ${vName}`;
      }
    }
    return res;
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
            window.AndroidVoice.scheduleAlarm(al.id, al.time.getTime(), al.label, al.mode, al.ttsText, al.voice || 'female_1', al.intervalMs || 0);
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
        const deleted = alarms.find(a => a.id === id);
        permanentlyDeleteAlarmItem(id);

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
    if ($('editAlarmVoice')) $('editAlarmVoice').value = al.voice || 'female_1';

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
    permanentlyDeleteAlarmItem(id);
    $('alarmEditView')?.classList.add('hidden');
    $('alarmListView')?.classList.remove('hidden');
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
    const chosenVoice = $('editAlarmVoice')?.value || 'female_1';

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
    al.voice = chosenVoice;
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
        al.ttsText,
        al.voice,
        al.intervalMs || 0
      );
    }

    $('alarmEditView')?.classList.add('hidden');
    $('alarmListView')?.classList.remove('hidden');
    renderAlarms();
    currentEditingAlarmId = null;
    showPopup(isHi ? 'अलार्म अपडेट कर दिया गया' : 'Alarm updated');
  });

  let inAppAutoSilenceTimer = null;
  function scheduleInAppAutoSilence(type, id) {
    if (inAppAutoSilenceTimer) {
      clearTimeout(inAppAutoSilenceTimer);
      inAppAutoSilenceTimer = null;
    }
    const val = (userSettings && userSettings.silenceAfter) ? userSettings.silenceAfter : '1 minute';
    if (val === 'Never') return;
    const mins = parseInt(val, 10) || 1;
    inAppAutoSilenceTimer = setTimeout(() => {
      console.log(`[AutoSilence] In-app auto silence triggered after ${mins} min(s)`);
      if (type === 'task') {
        if (typeof dismissTaskById === 'function') dismissTaskById(id);
      } else {
        if (typeof dismissAlarmById === 'function') dismissAlarmById(id);
      }
    }, mins * 60 * 1000);
  }

  function clearInAppAutoSilence() {
    if (inAppAutoSilenceTimer) {
      clearTimeout(inAppAutoSilenceTimer);
      inAppAutoSilenceTimer = null;
    }
  }

  function startAlarm(al) {
    if (!al) return;
    let deletedIds = [];
    try {
      deletedIds = JSON.parse(localStorage.getItem("vc_deleted_ids") || "[]");
    } catch (e) {}
    if (deletedIds.includes(al.id) || !alarms.some(a => a.id === al.id)) {
      console.warn("startAlarm: Alarm " + al.id + " was deleted. Canceling.");
      permanentlyDeleteAlarmItem(al.id);
      return;
    }
    if (al.enabled === false) return;
    if (al.ringing) return;
    if (al.snoozedUntil) {
      if (Date.now() < al.snoozedUntil) return;
    } else {
      if (new Date(al.time).getTime() > Date.now()) return;
    }

    al.ringing = true;
    currentActiveAlarmId = al.id;

    scheduleInAppAutoSilence('alarm', al.id);

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
    const snoozeMins = (al.intervalMs && al.intervalMs > 0)
      ? Math.max(1, Math.round(al.intervalMs / 60000))
      : (parseInt(userSettings.snoozeDuration || '10', 10) || 10);
    const alarmSwipeHint = $('alarmSwipeHintLeft');
    if (alarmSwipeHint) {
      alarmSwipeHint.textContent = isHi ? `◂ स्नूज़ (${snoozeMins} मिनट)` : `◂ Slide to Snooze (${snoozeMins}m)`;
    }

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
    }

    if (window.AndroidVoice && window.AndroidVoice.startAlarmServiceNative) {
      window.AndroidVoice.startAlarmServiceNative(
        al.id,
        al.label || '',
        al.mode || 'tts',
        al.ttsText || al.label || '',
        al.voice || 'female_1'
      );
    } else if (!window.AndroidVoice && al.mode !== 'upload') {
      const loopTTS = async () => {
        if (!al.ringing || currentActiveAlarmId !== al.id) return;
        await playTTS(al.ttsText || al.label || 'Alarm', 'en-US', al.voice || 'female_1');
        if (!al.ringing || currentActiveAlarmId !== al.id) return;
        al.loopTimeout = setTimeout(loopTTS, 1500);
      };
      loopTTS();
    }
  }

  function stopAlarmAudio(id) {
    clearInAppAutoSilence();
    stopAllTTS();

    if (window.AndroidVoice) {
      if (window.AndroidVoice.stopAlarmService) {
        window.AndroidVoice.stopAlarmService();
      }
      if (window.AndroidVoice.stopAlarmVibrationNative) {
        window.AndroidVoice.stopAlarmVibrationNative();
      }
      if (window.AndroidVoice.stopNativeTTS) {
        window.AndroidVoice.stopNativeTTS();
      }
      if (window.AndroidVoice.setAlarmRinging) {
        window.AndroidVoice.setAlarmRinging(false);
      }
    }

    alarms.forEach(al => {
      if (!id || al.id === id) {
        al.ringing = false;
        if (al.loopTimeout) {
          clearTimeout(al.loopTimeout);
          al.loopTimeout = null;
        }
        if (al.audioObj) {
          try {
            al.audioObj.pause();
            al.audioObj.currentTime = 0;
          } catch (e) {}
          al.audioObj = null;
        }
      }
    });
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

  function snoozeAlarmById(alarmId) {
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

    const snoozeMins = (al.intervalMs && al.intervalMs > 0)
      ? Math.max(1, Math.round(al.intervalMs / 60000))
      : (parseInt(userSettings.snoozeDuration || '10', 10) || 10);
    const snoozeTime = Date.now() + (snoozeMins * 60 * 1000);
    al.ringing = false;
    al.snoozedUntil = snoozeTime;
    al.enabled = true;
    saveAlarms();

    if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
      window.AndroidVoice.scheduleAlarm(
        al.id,
        snoozeTime,
        al.label,
        al.mode,
        al.ttsText,
        al.voice || 'female_1',
        al.intervalMs || 0
      );
    }
    if (window.AndroidVoice && window.AndroidVoice.syncAlarmSnooze) {
      window.AndroidVoice.syncAlarmSnooze(al.id, snoozeTime);
    }

    if (currentActiveAlarmId === alarmId) {
      currentActiveAlarmId = null;
      alarmModal?.classList.remove('show');
    }
    renderAlarms();
    const isHi = userSettings.appLanguage === 'hi';
    showPopup(isHi ? `अलार्म ${snoozeMins} मिनट के लिए स्नूज़ किया गया` : `Alarm snoozed for ${snoozeMins} minutes`, 'snooze');
  }

  function dismissAlarmById(alarmId) {
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
        window.AndroidVoice.scheduleAlarm(al.id, al.time.getTime(), al.label, al.mode, al.ttsText, al.voice || 'female_1', al.intervalMs || 0);
      }
    } else if (hasDays) {
      advanceAlarmToNextRepeatDay(al);
      if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
        window.AndroidVoice.scheduleAlarm(al.id, al.time.getTime(), al.label, al.mode, al.ttsText, al.voice || 'female_1', al.intervalMs || 0);
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
        window.AndroidVoice.scheduleAlarm(al.id, al.time.getTime(), al.label, al.mode, al.ttsText, al.voice || 'female_1', al.intervalMs || 0);
      }
    } else {
      al.enabled = false;
      if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) {
        window.AndroidVoice.cancelAlarm(al.id);
      }
    }

    saveAlarms();
    if (currentActiveAlarmId === alarmId) {
      currentActiveAlarmId = null;
      alarmModal?.classList.remove('show');
    }
    alarmFormView?.classList.add('hidden');
    alarmListView?.classList.remove('hidden');
    renderAlarms();
    const isHi = userSettings.appLanguage === 'hi';
    showPopup(isHi ? 'अलार्म बंद किया गया' : 'Alarm dismissed', 'dismissed');
  }

  function handleAlarmSnooze() {
    snoozeAlarmById(currentActiveAlarmId);
  }

  function handleAlarmDismiss() {
    dismissAlarmById(currentActiveAlarmId);
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
    const effectiveNow = getEffectiveNow();
    const now = effectiveNow.getTime();
    const currentDay = effectiveNow.getDay();
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
  }, 200);

  // -------------------- TASKS STATE & LOGIC --------------------
  let tasks = JSON.parse(localStorage.getItem("tasks")) || [];
  tasks = tasks.filter(t => t && t.id && !vcDeletedIds.includes(t.id));
  tasks.forEach(t => {
    t.time = new Date(t.time);
    if (isNaN(t.time.getTime())) t.time = new Date();
    if (t.enabled === undefined) t.enabled = true;
    if (!t.voice) t.voice = 'female_1';
  });

  function saveTasks() {
    tasks.forEach(t => { if (t && t.id) unmarkIdAsDeleted(t.id); });
    localStorage.setItem("tasks", JSON.stringify(tasks));
  }

  function permanentlyDeleteTaskItem(id) {
    if (!id) return;
    stopTaskAudio(id);
    const t = tasks.find(x => x.id === id);
    if (t && t.loopTimeout) {
      clearTimeout(t.loopTimeout);
      t.loopTimeout = null;
    }
    if (currentActiveTaskId === id) {
      currentActiveTaskId = null;
      taskModal?.classList.remove('show');
    }
    markIdAsPermanentlyDeleted(id);
    if (window.AndroidVoice) {
      if (window.AndroidVoice.stopAlarmService) {
        window.AndroidVoice.stopAlarmService();
      }
      if (window.AndroidVoice.cancelAlarm) {
        window.AndroidVoice.cancelAlarm(id);
      }
      if (window.AndroidVoice.syncAlarmDismiss) {
        window.AndroidVoice.syncAlarmDismiss(id);
      }
    }
    tasks = tasks.filter(x => x.id !== id);
    saveTasks();
    renderTasks();
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
    const taskVoice = $('taskVoice')?.value || 'female_1';

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
      voice: taskVoice,
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
        task.title,
        task.voice,
        task.intervalMs || 0
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

      if (t.voice && typeof VOICE_OPTIONS !== 'undefined') {
        const vObj = VOICE_OPTIONS.find(v => v.id === t.voice);
        if (vObj) {
          const vName = isHi ? vObj.nameHi.split(' ')[0] : vObj.nameEn.split(' ')[0];
          subStr += ` • 🎙️ ${vName}`;
        }
      }

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
            window.AndroidVoice.scheduleAlarm(t.id, t.time.getTime(), t.title, 'task', t.title, t.voice || 'female_1', t.intervalMs || 0);
          }
        }
        saveTasks();
        renderTasks();
      };
    });

    tasksList.querySelectorAll('.alarm-delete-btn').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const deleted = tasks.find(x => x.id === id);
        permanentlyDeleteTaskItem(id);

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
    if ($('editTaskVoice')) $('editTaskVoice').value = t.voice || 'female_1';

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
    permanentlyDeleteTaskItem(id);
    $('taskEditView')?.classList.add('hidden');
    $('taskListView')?.classList.remove('hidden');
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
    const chosenVoice = $('editTaskVoice')?.value || 'female_1';

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
    t.voice = chosenVoice;
    t.intervalMs = customIntervalMs;
    t.enabled = true;
    t.ringing = false;

    saveTasks();

    if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) {
      window.AndroidVoice.cancelAlarm(t.id);
    }
    if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
      window.AndroidVoice.scheduleAlarm(t.id, t.time.getTime(), t.title, 'task', t.title, t.voice, t.intervalMs || 0);
    }

    $('taskEditView')?.classList.add('hidden');
    $('taskListView')?.classList.remove('hidden');
    renderTasks();
    currentEditingTaskId = null;
    showPopup(isHi ? 'कार्य अपडेट कर दिया गया' : 'Task updated');
  });

  function startTask(t) {
    if (!t) return;
    let deletedIds = [];
    try {
      deletedIds = JSON.parse(localStorage.getItem("vc_deleted_ids") || "[]");
    } catch (e) {}
    if (deletedIds.includes(t.id) || !tasks.some(x => x.id === t.id)) {
      console.warn("startTask: Task " + t.id + " was deleted. Canceling.");
      permanentlyDeleteTaskItem(t.id);
      return;
    }
    if (t.enabled === false) return;
    if (t.ringing) return;
    if (t.snoozedUntil) {
      if (Date.now() < t.snoozedUntil) return;
    } else {
      if (new Date(t.time).getTime() > Date.now()) return;
    }
    t.ringing = true;
    currentActiveTaskId = t.id;

    scheduleInAppAutoSilence('task', t.id);

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
    const snoozeMins = (t.intervalMs && t.intervalMs > 0)
      ? Math.max(1, Math.round(t.intervalMs / 60000))
      : (parseInt(userSettings.snoozeDuration || '10', 10) || 10);
    const taskSwipeHint = $('taskSwipeHintLeft');
    if (taskSwipeHint) {
      taskSwipeHint.textContent = isHi ? `◂ स्नूज़ (${snoozeMins} मिनट)` : `◂ Slide to Snooze (${snoozeMins}m)`;
    }

    if (taskModalLabel) taskModalLabel.textContent = t.title;
    if (taskModalTime) taskModalTime.textContent = formatAlarmTimeString(t.time);

    taskModal?.classList.add('show');
    showPopup(isHi ? `🔔 कार्य: ${t.title}` : `🔔 Task: ${t.title}`);

    if (window.AndroidVoice && window.AndroidVoice.startAlarmServiceNative) {
      window.AndroidVoice.startAlarmServiceNative(
        t.id,
        t.title || '',
        'task',
        t.title || '',
        t.voice || 'female_1'
      );
    } else if (!window.AndroidVoice) {
      const loopFunc = async () => {
        if (!t.ringing || currentActiveTaskId !== t.id) return;
        await playTTS(t.title, 'en-US', t.voice || 'female_1');
        if (!t.ringing || currentActiveTaskId !== t.id) return;
        t.loopTimeout = setTimeout(loopFunc, 1500);
      };
      loopFunc();
    }
  }

  function stopTaskAudio(id) {
    clearInAppAutoSilence();
    stopAllTTS();

    if (window.AndroidVoice) {
      if (window.AndroidVoice.stopAlarmService) {
        window.AndroidVoice.stopAlarmService();
      }
      if (window.AndroidVoice.stopAlarmVibrationNative) {
        window.AndroidVoice.stopAlarmVibrationNative();
      }
      if (window.AndroidVoice.stopNativeTTS) {
        window.AndroidVoice.stopNativeTTS();
      }
      if (window.AndroidVoice.setAlarmRinging) {
        window.AndroidVoice.setAlarmRinging(false);
      }
    }

    tasks.forEach(t => {
      if (!id || t.id === id) {
        t.ringing = false;
        if (t.loopTimeout) {
          clearTimeout(t.loopTimeout);
          t.loopTimeout = null;
        }
        if (t.audioObj) {
          try {
            t.audioObj.pause();
            t.audioObj.currentTime = 0;
          } catch (e) {}
          t.audioObj = null;
        }
      }
    });
  }

  function snoozeTaskById(taskId) {
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

    const snoozeMins = (t.intervalMs && t.intervalMs > 0)
      ? Math.max(1, Math.round(t.intervalMs / 60000))
      : (parseInt(userSettings.snoozeDuration || '10', 10) || 10);
    const snoozeTime = Date.now() + (snoozeMins * 60 * 1000);
    t.ringing = false;
    t.snoozedUntil = snoozeTime;
    t.enabled = true;
    saveTasks();

    if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
      window.AndroidVoice.scheduleAlarm(t.id, snoozeTime, t.title, 'task', t.title, t.voice || 'female_1', t.intervalMs || 0);
    }
    if (window.AndroidVoice && window.AndroidVoice.syncAlarmSnooze) {
      window.AndroidVoice.syncAlarmSnooze(t.id, snoozeTime);
    }

    if (currentActiveTaskId === taskId) {
      currentActiveTaskId = null;
      taskModal?.classList.remove('show');
    }
    renderTasks();
    const isHi = userSettings.appLanguage === 'hi';
    showPopup(isHi ? `कार्य ${snoozeMins} मिनट के लिए स्नूज़ किया गया` : `Task snoozed for ${snoozeMins} minutes`, 'snooze');
  }

  function dismissTaskById(taskId) {
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
    if (window.AndroidVoice && window.AndroidVoice.syncAlarmDismiss) {
      window.AndroidVoice.syncAlarmDismiss(taskId);
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
        window.AndroidVoice.scheduleAlarm(t.id, t.time.getTime(), t.title, 'task', t.title, t.voice || 'female_1', t.intervalMs || 0);
      }
    } else if (hasDays) {
      advanceTaskToNextRepeatDay(t);
      if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
        window.AndroidVoice.scheduleAlarm(t.id, t.time.getTime(), t.title, 'task', t.title, t.voice || 'female_1', t.intervalMs || 0);
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
        window.AndroidVoice.scheduleAlarm(t.id, t.time.getTime(), t.title, 'task', t.title, t.voice || 'female_1', t.intervalMs || 0);
      }
    } else {
      t.enabled = false;
      if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) {
        window.AndroidVoice.cancelAlarm(t.id);
      }
    }

    saveTasks();
    if (currentActiveTaskId === taskId) {
      currentActiveTaskId = null;
      taskModal?.classList.remove('show');
    }
    taskFormView?.classList.add('hidden');
    taskListView?.classList.remove('hidden');
    renderTasks();
    const isHi = userSettings.appLanguage === 'hi';
    showPopup(isHi ? 'कार्य बंद किया गया' : 'Task dismissed', 'dismissed');
  }

  function handleTaskSnooze() {
    snoozeTaskById(currentActiveTaskId);
  }

  function handleTaskDismiss() {
    dismissTaskById(currentActiveTaskId);
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
    const effectiveNow = getEffectiveNow();
    const now = effectiveNow.getTime();
    const currentDay = effectiveNow.getDay();
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
  }, 200);

  renderAlarms();
  renderTasks();

  // -------------------- HINDI / ENGLISH VOICE COMMANDS --------------------
  const hindiDigitMap = {
    '०': 0, '१': 1, '२': 2, '३': 3, '४': 4,
    '५': 5, '६': 6, '७': 7, '८': 8, '९': 9
  };

  const hindiWordNumbers = {
    'ek': 1, 'do': 2, 'teen': 3, 'char': 4, 'paanch': 5, 'panch': 5, 'chhah': 6, 'che': 6, 'chhe': 6,
    'saat': 7, 'aath': 8, 'nau': 9, 'das': 10, 'gyarah': 11, 'barah': 12,
    'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'छः': 6,
    'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10, 'ग्यारह': 11, 'बारह': 12,
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6,
    'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12
  };

  function isHindiInput(text) {
    if (!text) return false;
    if (/[\u0900-\u097F]/.test(text)) return true;
    return /\b(baje|lagao|laga|karo|kar|yaad|dila|dilana|dost|subah|shaam|raat|dopahar|hai|hain|chup|rok|band|kya|samay|thodi|baad|utha|jaga|banao|dawa|khana|dedh|dhai|saadhe|sawa|paune|suno)\b/i.test(text);
  }

  function normalizeText(text) {
    if (!text) return '';
    let str = text.trim();
    str = str.replace(/[०-९]/g, d => hindiDigitMap[d] !== undefined ? hindiDigitMap[d] : d);
    return str;
  }

  function parseDurationMinutes(text) {
    if (!text) return null;
    const m = text.match(/(\d{1,3})\s*(?:minutes?|mins?|मिनट)/i);
    if (m) return parseInt(m[1], 10);
    const hm = text.match(/(\d{1,2})\s*(?:hours?|hrs?|घंटे?|घंटा)/i);
    if (hm) return parseInt(hm[1], 10) * 60;
    return null;
  }

  function parseTimeFromText(text) {
    let hour = null;
    let minute = 0;
    let ampm = null;

    if (!text) return null;

    // Remove duration phrases like "for 10 minutes", "10 minute", "5 मिनट" so they don't get confused as hour
    let t = text.toLowerCase()
      .replace(/(?:for\s+)?\d{1,3}\s*(?:minutes?|mins?|मिनट|घंटे?|hours?)(?:\s*(?:ke\s*liye|के\s*लिए))?/gi, ' ');

    if (/सुबह|morning|subah|\bam\b/i.test(t)) {
      ampm = 'am';
    } else if (/शाम|रात|दोपहर|evening|night|afternoon|shaam|dopahar|raat|\bpm\b/i.test(t)) {
      ampm = 'pm';
    }

    // Special colloquial Hindi phrases
    if (/डेढ़|dedh/i.test(t)) {
      hour = 1;
      minute = 30;
    } else if (/ढाई|dhai/i.test(t)) {
      hour = 2;
      minute = 30;
    }

    if (hour === null) {
      // 1. Colon format: 7:30
      const colonMatch = t.match(/(\d{1,2})[:.](\d{2})/);
      if (colonMatch) {
        hour = parseInt(colonMatch[1], 10);
        minute = parseInt(colonMatch[2], 10);
      }
    }

    if (hour === null) {
      // 2. Digit followed by explicit time indicator: 7 बजे, 7 am, 7 o'clock
      const numWithUnitMatch = t.match(/(\d{1,2})\s*(?:बजे|baje|am|pm|o'?clock)/i);
      if (numWithUnitMatch) {
        hour = parseInt(numWithUnitMatch[1], 10);
      }
    }

    if (hour === null) {
      // 3. Word number followed by explicit time indicator: सात बजे, seven am
      for (const [w, val] of Object.entries(hindiWordNumbers)) {
        const reg = new RegExp(`(?:^|\\s)${w}\\s*(?:बजे|baje|am|pm|o'?clock)`, 'i');
        if (reg.test(t)) {
          hour = val;
          break;
        }
      }
    }

    if (hour === null) {
      // 4. Standalone digits (e.g. "delete alarm 7")
      const standaloneDigitMatch = t.match(/(?:^|\s)(\d{1,2})(?:\s|$)/);
      if (standaloneDigitMatch) {
        hour = parseInt(standaloneDigitMatch[1], 10);
      }
    }

    if (hour === null) {
      // 5. Standalone word number (ignoring 'दो' or 'do' when part of 'hata do', 'kar do', etc.)
      for (const [w, val] of Object.entries(hindiWordNumbers)) {
        if ((w === 'दो' || w === 'do') && /(?:हटा|कर|लगा|रोक|दे|बना|रख|karo?|hatao?|laga|rok|de|bana)\s+(?:दो|do)/i.test(t)) {
          continue;
        }
        const reg = new RegExp(`(?:^|\\s)${w}(?:\\s|$)`, 'i');
        if (reg.test(t)) {
          hour = val;
          break;
        }
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
    return { hour, minute, ampm };
  }

  function parseCommand(rawCmd) {
    const isHiInput = isHindiInput(rawCmd);
    let cmd = normalizeText(rawCmd);

    // Strip common wake words and prefixes
    cmd = cmd
      .replace(/^hey\s+vc(?:\s+clock)?[,\s]*/i, '')
      .replace(/^vc(?:\s+clock)?[,\s]*/i, '')
      .replace(/^voice\s+clock[,\s]*/i, '')
      .replace(/^ok(?:ay)?\s+vc[,\s]*/i, '')
      .replace(/^hi\s+vc[,\s]*/i, '')
      .replace(/^hello\s+vc[,\s]*/i, '')
      .replace(/^हे\s*वीसी[,\s]*/i, '')
      .replace(/^नमस्ते\s*वीसी[,\s]*/i, '')
      .replace(/^ओके\s*वीसी[,\s]*/i, '')
      .replace(/^सुनो?\s*वीसी[,\s]*/i, '')
      .replace(/^अरे\s*वीसी[,\s]*/i, '')
      .trim();

    // 1. Empty or greeting only
    if (!cmd || /^(hello|hi|hey|नमस्ते|प्रणाम|हे)\b/i.test(cmd)) {
      return { type: 'greeting', isHindi: isHiInput };
    }

    // 2. Time query
    if (/^(what\s*time|tell\s*me\s*time|what\s*is\s*the\s*time|what's\s*the\s*time|time\s*please)\b/i.test(cmd) ||
        /(?:time|समय|टाइम)\s*(?:kya|बताओ|कितना|कहाँ)\b/i.test(cmd) ||
        /(?:kitne|कितने)\s*बजे\s*(?:hain|हैं|hai|है)\b/i.test(cmd)) {
      return { type: 'time_query', isHindi: isHiInput };
    }

    const timeInfo = parseTimeFromText(cmd);
    const durationMinutes = parseDurationMinutes(cmd);
    const isAll = /\b(all|every|everything)\b|सारे|सब|सभी|प्रत्येक|saare|sab|sabhi/i.test(cmd);
    const isExplicitTask = /\b(task|tasks|reminder|reminders)\b|टास्क|रिमाइंडर/i.test(cmd);
    const isExplicitAlarm = /\b(alarm|alarms)\b|अलार्म/i.test(cmd);

    // 3. Delete intent (High Priority - Never create an alarm or task)
    const isDelete = /\b(delete|remove|clear|erase|cancel\s+all)\b|डिलीट|हटाओ|हटा\s*दो|हटा\s*देना|हटाना|मिटाओ|मिटा\s*दो|मिटाना|hatao|hata\s*do|mitao|mita\s*do/i.test(cmd);
    if (isDelete) {
      let target = 'alarm';
      if (isExplicitTask && !isExplicitAlarm) {
        target = 'task';
      } else if (isAll && !isExplicitAlarm && !isExplicitTask) {
        target = 'all';
      }

      let title = null;
      if (target === 'task') {
        title = cmd
          .replace(/\b(delete|remove|clear|erase|cancel)\b/gi, '')
          .replace(/डिलीट|हटाओ|हटा\s*दो|हटा\s*देना|हटाना|मिटाओ|मिटा\s*दो|मिटाना|hatao|hata\s*do|mitao/gi, '')
          .replace(/\b(task|tasks|reminder|reminders)\b/gi, '')
          .replace(/टास्क|रिमाइंडर/gi, '')
          .replace(/वाला|वाली|वाले|wala|wali|wale/gi, '')
          .replace(/का|की|के|ka|ki|ke/gi, '')
          .replace(/को|ko/gi, '')
          .replace(/[\d:.]+\s*(?:am|pm|बजे|baje)/gi, '')
          .trim();
        if (!title) title = null;
      }

      return {
        type: 'delete',
        target,
        isAll,
        title,
        timeInfo,
        hour: timeInfo ? timeInfo.hour : null,
        minute: timeInfo ? timeInfo.minute : null,
        ampm: timeInfo ? timeInfo.ampm : null,
        isHindi: isHiInput
      };
    }

    // 4. Dismiss / Stop intent (High Priority - Never create an alarm or task)
    const isDismiss = /\b(dismiss|stop|turn\s*off|shut\s*up|quiet|silent|disable|off|cancel)\b|बंद\s*करो|बंद\s*कर\s*दो|बंद\s*कर\s*देना|रोक\s*दो|रोक\s*देना|रोक\s*लो|चुप\s*(?:रहो|हो\s*जाओ)?|शांत\s*(?:हो\s*जाओ)?|डिसमिस|ऑफ\s*करो|कैंसिल\s*करो|band\s*karo|band\s*kar\s*do|rok\s*do|rok\s*dena|chup\b|off\s*karo/i.test(cmd);
    if (isDismiss) {
      let target = 'alarm';
      if (isExplicitTask && !isExplicitAlarm) {
        target = 'task';
      } else if (isAll && !isExplicitAlarm && !isExplicitTask) {
        target = 'all';
      }

      return {
        type: 'dismiss',
        target,
        isAll,
        timeInfo,
        hour: timeInfo ? timeInfo.hour : null,
        minute: timeInfo ? timeInfo.minute : null,
        ampm: timeInfo ? timeInfo.ampm : null,
        isHindi: isHiInput
      };
    }

    // 5. Snooze intent (High Priority - Never create an alarm or task)
    const isSnooze = /\b(snooze|remind\s*later|later)\b|स्नूज़|सूनूज़|बाद\s*में|थोड़ी\s*देर\s*बाद|baad\s*me/i.test(cmd);
    if (isSnooze) {
      let target = 'alarm';
      if (isExplicitTask && !isExplicitAlarm) {
        target = 'task';
      }
      return {
        type: 'snooze',
        target,
        durationMinutes,
        timeInfo,
        hour: timeInfo ? timeInfo.hour : null,
        minute: timeInfo ? timeInfo.minute : null,
        ampm: timeInfo ? timeInfo.ampm : null,
        isHindi: isHiInput
      };
    }

    // 6. Task / Reminder creation (Guarded: only when NOT delete, dismiss, or snooze)
    const isTask = /remind|task|reminder|याद|टास्क|रिमाइंडर|yaad|dawa|medicine|doodh|milk|dinner|lunch|meeting|padhai|study/i.test(cmd);
    if (isTask && timeInfo) {
      let title = cmd
        .replace(/remind\s+me\s+to/gi, '')
        .replace(/remind\s+me\s+at\s+[\d:.]+\s*(?:am|pm)?\s*(?:to)?/gi, '')
        .replace(/(?:add|create)\s+task/gi, '')
        .replace(/मुझे/gi, '')
        .replace(/याद\s*दिलाना|याद\s*दिलाओ|याद\s*दिला|याद|yaad\s*dilana|yaad\s*dila|yaad/gi, '')
        .replace(/का\s*टास्क\s*बनाओ|टास्क\s*ऐड\s*करो|टास्क\s*बनाओ|टास्क|ka\s*task\s*banao|task\s*add\s*karo|task/gi, '')
        .replace(/के\s*लिए|ke\s*liye|for/gi, '')
        .replace(/[\d:.]+\s*(?:am|pm|बजे|baje)/gi, '')
        .replace(/(?:subah|shaam|raat|dopahar|morning|evening|night|afternoon)/gi, '')
        .trim();
      if (!title) title = isHiInput ? 'रिमाइंडर' : 'Reminder';
      return { type: 'task', title, hour: timeInfo.hour, minute: timeInfo.minute, ampm: timeInfo.ampm, isHindi: isHiInput };
    }

    // 7. Alarm creation (Guarded: only when NOT delete, dismiss, or snooze)
    const isAlarm = /alarm|अलार्म|wake\s*me\s*up|उठा\s*देना|जगा\s*देना|jaga\s*dena|utha\s*dena|lagao|laga\s*do|set\s*karo/i.test(cmd) || /बजे|baje|am|pm/i.test(cmd);
    if (timeInfo && isAlarm) {
      let label = cmd
        .replace(/set\s+alarm\s+for/gi, '')
        .replace(/set\s+alarm\s+at/gi, '')
        .replace(/का\s*अलार्म\s*लगाओ|अलार्म\s*लगाओ|अलार्म\s*सेट\s*करो|अलार्म\s*लगा\s*दो|अलार्म/gi, '')
        .replace(/[\d:.]+\s*(?:am|pm|बजे|baje)/gi, '')
        .replace(/के\s*लिए|for/gi, '')
        .replace(/(?:subah|shaam|raat|dopahar|morning|evening|night|afternoon)/gi, '')
        .trim();
      if (!label) label = isHiInput ? 'अलार्म' : 'Alarm';
      return { type: 'alarm', label, hour: timeInfo.hour, minute: timeInfo.minute, ampm: timeInfo.ampm, isHindi: isHiInput };
    }

    return { type: 'unknown', raw: cmd, isHindi: isHiInput };
  }

  // Voice execution
  const voiceBtn = $('voiceCmdBtn');
  const voiceStatus = $('voiceCmdStatus');
  const voiceOverlay = $('voiceOverlay');
  const voiceText = $('voiceText');
  const voiceSub = $('voiceSub');
  const voiceLiveTranscript = $('voiceLiveTranscript');
  const closeVoiceOverlayBtn = $('closeVoiceOverlayBtn');

  let activeSpeechRecognition = null;
  let isVoiceListeningActive = false;

  function updateVoiceButtonUI() {
    const isHi = userSettings.appLanguage === 'hi';
    const labelSpan = $('voiceBtnLabel');
    if (isVoiceListeningActive) {
      if (labelSpan) labelSpan.textContent = isHi ? 'बोलना बंद करें' : 'Stop Voice';
      if (voiceBtn) voiceBtn.classList.add('active-listening');
      if (voiceStatus) {
        voiceStatus.textContent = isHi 
          ? 'वॉयस असिस्टेंट सक्रिय है (पृष्ठभूमि में भी सुन रहा है)... कुछ भी बोलें' 
          : 'Voice Assistant Active (Listening in background)... Speak anytime';
      }
    } else {
      if (labelSpan) labelSpan.textContent = isHi ? 'बोलना शुरू करें' : 'Start Voice';
      if (voiceBtn) voiceBtn.classList.remove('active-listening');
      if (voiceStatus) {
        voiceStatus.textContent = isHi 
          ? 'सीधे "Hey VC..." बोलें या बोलना शुरू करें दबाएं' 
          : 'Directly say "Hey VC..." or tap Start Voice';
      }
    }
  }

  window.onVoiceSessionStarted = function() {
    isVoiceListeningActive = true;
    updateVoiceButtonUI();
  };

  window.onVoiceSessionStopped = function() {
    isVoiceListeningActive = false;
    updateVoiceButtonUI();
  };

  function showListeningUI() {
    const selectedLang = $('voiceLangSelect')?.value || 'bilingual';
    const isHi = selectedLang === 'hi-IN' || (selectedLang === 'bilingual' && userSettings.appLanguage === 'hi');
    if (voiceOverlay) voiceOverlay.classList.remove('hidden');
    if (voiceText) voiceText.textContent = isHi ? 'सुन रहा हूँ... बोलिए' : 'Listening... Speak now';
    if (voiceLiveTranscript) voiceLiveTranscript.textContent = '';
  }

  function hideListeningUI() {
    if (voiceOverlay) voiceOverlay.classList.add('hidden');
  }

  closeVoiceOverlayBtn?.addEventListener('click', () => {
    hideListeningUI();
  });

  // Voice button click handler (Manual trigger / toggle)
  voiceBtn?.addEventListener('click', () => {
    const selectedLang = $('voiceLangSelect')?.value || 'bilingual';
    const isHi = selectedLang === 'hi-IN' || (selectedLang === 'bilingual' && userSettings.appLanguage === 'hi');

    if (isVoiceListeningActive) {
      // User wants to STOP listening
      isVoiceListeningActive = false;
      updateVoiceButtonUI();
      hideListeningUI();

      if (window.AndroidVoice && typeof window.AndroidVoice.stopListening === 'function') {
        window.AndroidVoice.stopListening();
      }
      if (activeSpeechRecognition) {
        try { activeSpeechRecognition.abort(); } catch {}
        activeSpeechRecognition = null;
      }
      showToast(isHi ? 'वॉयस असिस्टेंट बंद कर दिया गया है' : 'Voice Assistant stopped');
      return;
    }

    // User wants to START listening
    isVoiceListeningActive = true;
    updateVoiceButtonUI();
    showListeningUI();
    showToast(isHi ? 'वॉयस असिस्टेंट शुरू हो गया है (पृष्ठभूमि में भी सुन रहा है)' : 'Voice Assistant started (Listening in background)');

    if (window.AndroidVoice && typeof window.AndroidVoice.startListening === 'function') {
      window.AndroidVoice.startListening(selectedLang);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      isVoiceListeningActive = false;
      updateVoiceButtonUI();
      if (voiceStatus) voiceStatus.textContent = isHi ? 'वाक् पहचान अनुपलब्ध है' : 'Speech recognition not available';
      showToast(isHi ? 'वाक् पहचान अनुपलब्ध है' : 'Speech recognition not available');
      hideListeningUI();
      return;
    }

    try {
      const rec = new SpeechRecognition();
      activeSpeechRecognition = rec;
      rec.lang = (selectedLang === 'bilingual') ? (isHi ? 'hi-IN' : 'en-IN') : selectedLang;
      rec.interimResults = true;
      rec.continuous = true;

      rec.onresult = (ev) => {
        let transcript = '';
        for (let i = ev.resultIndex; i < ev.results.length; ++i) {
          transcript += ev.results[i][0].transcript;
        }
        if (voiceLiveTranscript) voiceLiveTranscript.textContent = transcript;
        if (ev.results[ev.results.length - 1].isFinal) {
          if (voiceText) voiceText.textContent = isHi ? 'संसाधित हो रहा है...' : 'Processing...';
          handleCommand(transcript);
          setTimeout(() => {
            hideListeningUI();
          }, 2000);
        }
      };

      rec.onerror = (e) => {
        console.log('SpeechRecognition error:', e);
      };

      rec.onend = () => {
        if (isVoiceListeningActive) {
          try { rec.start(); } catch {}
        } else {
          updateVoiceButtonUI();
        }
      };

      rec.start();
    } catch (e) {
      console.log('Speech start exception:', e);
      isVoiceListeningActive = false;
      updateVoiceButtonUI();
      hideListeningUI();
    }
  });

  function handleCommand(cmdText) {
    if (!cmdText) return;
    const parsed = parseCommand(cmdText);
    const isHi = parsed.isHindi !== undefined ? parsed.isHindi : (userSettings.appLanguage === 'hi');

    function respond(msg, logType = 'info') {
      if (voiceText) voiceText.textContent = msg;
      if (voiceStatus) voiceStatus.textContent = msg;
      showToast(msg);
      if (typeof addLog === 'function') addLog(msg, logType);
      playTTS(msg, isHi ? 'hi-IN' : 'en-US', isHi ? 'female_in' : 'female_1');
    }

    if (parsed.type === 'greeting') {
      const resp = isHi ? 'हाँ कहिए, मैं सुन रहा हूँ' : "Yes, I am listening. How can I help you?";
      respond(resp, 'info');
      return;
    }

    if (parsed.type === 'time_query') {
      const effectiveNow = getEffectiveNow();
      let hours = effectiveNow.getHours();
      const minutes = effectiveNow.getMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      const minStr = minutes < 10 ? '0' + minutes : minutes;

      let periodHi = 'सुबह';
      if (hours >= 12 && hours < 16) periodHi = 'दोपहर';
      else if (hours >= 16 && hours < 20) periodHi = 'शाम';
      else if (hours >= 20 || hours < 4) periodHi = 'रात';

      const responseHi = minutes === 0 
        ? `अभी ${periodHi} के ठीक ${displayHours} बजे हैं`
        : `अभी ${periodHi} के ${displayHours} बजकर ${minutes} मिनट हुए हैं`;
      const responseEn = `The time is ${displayHours}:${minStr} ${ampm}`;

      respond(isHi ? responseHi : responseEn, 'info');
      return;
    }

    // ==================== DELETE COMMAND ====================
    if (parsed.type === 'delete') {
      // 1. Delete all
      if (parsed.isAll) {
        if (parsed.target === 'alarm' || parsed.target === 'all') {
          const allAlarmIds = alarms.map(a => a.id);
          allAlarmIds.forEach(id => permanentlyDeleteAlarmItem(id));
        }
        if (parsed.target === 'task' || parsed.target === 'all') {
          const allTaskIds = tasks.map(t => t.id);
          allTaskIds.forEach(id => permanentlyDeleteTaskItem(id));
        }
        if (window.AndroidVoice && window.AndroidVoice.stopAlarmService) {
          window.AndroidVoice.stopAlarmService();
        }

        const resp = parsed.target === 'task'
          ? (isHi ? 'सभी कार्य हटा दिए गए हैं' : 'All tasks have been deleted')
          : parsed.target === 'all'
            ? (isHi ? 'सभी अलार्म और कार्य हटा दिए गए हैं' : 'All alarms and tasks have been deleted')
            : (isHi ? 'सभी अलार्म हटा दिए गए हैं' : 'All alarms have been deleted');
        respond(resp, 'deleted');
        return;
      }

      // 2. Delete by specific time
      if (parsed.timeInfo) {
        let targetH = parsed.timeInfo.hour;
        if (parsed.timeInfo.ampm === 'pm' && targetH < 12) targetH += 12;
        if (parsed.timeInfo.ampm === 'am' && targetH === 12) targetH = 0;
        const targetM = parsed.timeInfo.minute;

        // Check alarms first if target is alarm or unspecified
        if (parsed.target !== 'task') {
          const alarmMatches = alarms.filter(a => {
            const d = new Date(a.time);
            const h = d.getHours();
            const m = d.getMinutes();
            return parsed.timeInfo.ampm ? (h === targetH && m === targetM) : ((h % 12 === targetH % 12) && m === targetM);
          });
          const matchAlarm = alarmMatches.find(a => a.enabled) || alarmMatches[0];
          if (matchAlarm) {
            const timeStr = formatAlarmTimeString(matchAlarm.time);
            permanentlyDeleteAlarmItem(matchAlarm.id);
            const resp = isHi ? `${timeStr} बजे का अलार्म हटा दिया गया है` : `Alarm for ${timeStr} deleted`;
            respond(resp, 'deleted');
            return;
          }
        }

        // Check tasks
        if (parsed.target !== 'alarm') {
          const taskMatches = tasks.filter(t => {
            const d = new Date(t.time);
            const h = d.getHours();
            const m = d.getMinutes();
            return parsed.timeInfo.ampm ? (h === targetH && m === targetM) : ((h % 12 === targetH % 12) && m === targetM);
          });
          const matchTask = taskMatches.find(t => t.enabled) || taskMatches[0];
          if (matchTask) {
            const title = matchTask.title;
            permanentlyDeleteTaskItem(matchTask.id);
            const resp = isHi ? `कार्य "${title}" हटा दिया गया है` : `Task "${title}" deleted`;
            respond(resp, 'deleted');
            return;
          }
        }

        const displayM = targetM < 10 ? '0' + targetM : targetM;
        const resp = isHi 
          ? `${parsed.timeInfo.hour}:${displayM} पर कोई अलार्म या टास्क नहीं मिला` 
          : `No alarm or task found for ${parsed.timeInfo.hour}:${displayM}`;
        respond(resp, 'info');
        return;
      }

      // 3. Delete by task title
      if (parsed.target === 'task' && parsed.title) {
        const matchTask = tasks.find(t => t.title && t.title.toLowerCase().includes(parsed.title.toLowerCase()));
        if (matchTask) {
          const title = matchTask.title;
          permanentlyDeleteTaskItem(matchTask.id);
          const resp = isHi ? `कार्य "${title}" हटा दिया गया है` : `Task "${title}" deleted`;
          respond(resp, 'deleted');
          return;
        }
      }

      // 4. Delete currently ringing alarm or task
      if (currentActiveAlarmId) {
        const id = currentActiveAlarmId;
        permanentlyDeleteAlarmItem(id);
        const resp = isHi ? 'बजता हुआ अलार्म हटा दिया गया है' : 'Active alarm deleted';
        respond(resp, 'deleted');
        return;
      }

      if (currentActiveTaskId) {
        const id = currentActiveTaskId;
        permanentlyDeleteTaskItem(id);
        const resp = isHi ? 'बजता हुआ कार्य हटा दिया गया है' : 'Active task deleted';
        respond(resp, 'deleted');
        return;
      }

      // 5. Delete upcoming alarm or task
      if (parsed.target === 'task') {
        if (tasks.length === 0) {
          respond(isHi ? 'हटाने के लिए कोई कार्य नहीं है' : 'No tasks to delete', 'info');
          return;
        }
        const toDelete = tasks.find(t => t.enabled) || tasks[0];
        const title = toDelete.title;
        permanentlyDeleteTaskItem(toDelete.id);
        respond(isHi ? `कार्य "${title}" हटा दिया गया है` : `Task "${title}" deleted`, 'deleted');
        return;
      }

      // Default: delete upcoming alarm
      if (alarms.length === 0) {
        respond(isHi ? 'हटाने के लिए कोई अलार्म नहीं है' : 'No alarms to delete', 'info');
        return;
      }
      const toDelete = alarms.find(a => a.enabled) || alarms[0];
      const timeStr = formatAlarmTimeString(toDelete.time);
      permanentlyDeleteAlarmItem(toDelete.id);
      respond(isHi ? `${timeStr} बजे का अलार्म हटा दिया गया है` : `Alarm for ${timeStr} deleted`, 'deleted');
      return;
    }

    // ==================== DISMISS / STOP COMMAND ====================
    if (parsed.type === 'dismiss') {
      // 1. If ringing, dismiss immediately
      if (currentActiveAlarmId) {
        handleAlarmDismiss();
        respond(isHi ? 'अलार्म बंद कर दिया गया है' : 'Alarm has been dismissed', 'dismissed');
        return;
      }
      if (currentActiveTaskId) {
        handleTaskDismiss();
        respond(isHi ? 'कार्य बंद कर दिया गया है' : 'Task has been dismissed', 'dismissed');
        return;
      }

      // 2. Dismiss all
      if (parsed.isAll) {
        alarms.forEach(al => {
          if (al.enabled) {
            al.enabled = false;
            if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) window.AndroidVoice.cancelAlarm(al.id);
          }
        });
        tasks.forEach(t => {
          if (t.enabled) {
            t.enabled = false;
            if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) window.AndroidVoice.cancelAlarm(t.id);
          }
        });
        saveAlarms(); renderAlarms();
        saveTasks(); renderTasks();
        respond(isHi ? 'सभी अलार्म और कार्य बंद कर दिए गए हैं' : 'All alarms and tasks turned off', 'dismissed');
        return;
      }

      // 3. Dismiss specific scheduled time
      if (parsed.timeInfo) {
        let targetH = parsed.timeInfo.hour;
        if (parsed.timeInfo.ampm === 'pm' && targetH < 12) targetH += 12;
        if (parsed.timeInfo.ampm === 'am' && targetH === 12) targetH = 0;
        const targetM = parsed.timeInfo.minute;

        const alarmMatches = alarms.filter(a => {
          const d = new Date(a.time);
          const h = d.getHours();
          const m = d.getMinutes();
          return parsed.timeInfo.ampm ? (h === targetH && m === targetM) : ((h % 12 === targetH % 12) && m === targetM);
        });
        const foundAlarm = alarmMatches.find(a => a.enabled) || alarmMatches[0];
        if (foundAlarm) {
          foundAlarm.enabled = false;
          if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) window.AndroidVoice.cancelAlarm(foundAlarm.id);
          saveAlarms();
          renderAlarms();
          const timeStr = formatAlarmTimeString(foundAlarm.time);
          respond(isHi ? `${timeStr} बजे का अलार्म बंद कर दिया गया है` : `Alarm for ${timeStr} turned off`, 'dismissed');
          return;
        }

        const taskMatches = tasks.filter(t => {
          const d = new Date(t.time);
          const h = d.getHours();
          const m = d.getMinutes();
          return parsed.timeInfo.ampm ? (h === targetH && m === targetM) : ((h % 12 === targetH % 12) && m === targetM);
        });
        const foundTask = taskMatches.find(t => t.enabled) || taskMatches[0];
        if (foundTask) {
          foundTask.enabled = false;
          if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) window.AndroidVoice.cancelAlarm(foundTask.id);
          saveTasks();
          renderTasks();
          respond(isHi ? `कार्य "${foundTask.title}" बंद कर दिया गया है` : `Task "${foundTask.title}" turned off`, 'dismissed');
          return;
        }

        const displayM = targetM < 10 ? '0' + targetM : targetM;
        respond(isHi ? `${parsed.timeInfo.hour}:${displayM} पर कोई सक्रिय अलार्म नहीं मिला` : `No active alarm found for ${parsed.timeInfo.hour}:${displayM}`, 'info');
        return;
      }

      // 4. Dismiss next upcoming active alarm/task
      const activeAlarm = alarms.find(a => a.enabled);
      if (activeAlarm) {
        activeAlarm.enabled = false;
        if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) window.AndroidVoice.cancelAlarm(activeAlarm.id);
        saveAlarms();
        renderAlarms();
        const timeStr = formatAlarmTimeString(activeAlarm.time);
        respond(isHi ? `आगामी ${timeStr} बजे का अलार्म बंद कर दिया गया है` : `Upcoming alarm for ${timeStr} turned off`, 'dismissed');
        return;
      }

      const activeTask = tasks.find(t => t.enabled);
      if (activeTask) {
        activeTask.enabled = false;
        if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) window.AndroidVoice.cancelAlarm(activeTask.id);
        saveTasks();
        renderTasks();
        respond(isHi ? `कार्य "${activeTask.title}" बंद कर दिया गया है` : `Task "${activeTask.title}" turned off`, 'dismissed');
        return;
      }

      respond(isHi ? 'बंद करने के लिए कोई सक्रिय अलार्म नहीं है' : 'No active alarm to turn off', 'info');
      return;
    }

    // ==================== SNOOZE COMMAND ====================
    if (parsed.type === 'snooze') {
      const defaultMins = parseInt(userSettings.snoozeDuration || '10', 10) || 10;
      const snoozeMins = parsed.durationMinutes || defaultMins;

      // 1. If ringing, snooze active alarm
      if (currentActiveAlarmId) {
        const al = alarms.find(a => a.id === currentActiveAlarmId);
        if (al) {
          al.snoozedUntil = Date.now() + snoozeMins * 60000;
          al.time = new Date(Date.now() + snoozeMins * 60000);
          al.ringing = false;
          stopAlarmAudio(al.id);
          if (window.AndroidVoice && window.AndroidVoice.stopAlarmService) window.AndroidVoice.stopAlarmService();
          if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
            window.AndroidVoice.scheduleAlarm(al.id, al.time.getTime(), al.label, al.mode, al.ttsText, al.voice || 'female_1', al.intervalMs || 0);
          }
          saveAlarms();
          renderAlarms();
          currentActiveAlarmId = null;
          alarmModal?.classList.remove('show');
        }
        respond(isHi ? `अलार्म ${snoozeMins} मिनट के लिए स्नूज़ कर दिया गया है` : `Alarm snoozed for ${snoozeMins} minutes`, 'snoozed');
        return;
      }

      if (currentActiveTaskId) {
        const t = tasks.find(x => x.id === currentActiveTaskId);
        if (t) {
          t.snoozedUntil = Date.now() + snoozeMins * 60000;
          t.time = new Date(Date.now() + snoozeMins * 60000);
          t.ringing = false;
          stopTaskAudio(t.id);
          if (window.AndroidVoice && window.AndroidVoice.stopAlarmService) window.AndroidVoice.stopAlarmService();
          if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
            window.AndroidVoice.scheduleAlarm(t.id, t.time.getTime(), t.title, 'task', t.title, t.voice, t.intervalMs || 0);
          }
          saveTasks();
          renderTasks();
          currentActiveTaskId = null;
          taskModal?.classList.remove('show');
        }
        respond(isHi ? `कार्य ${snoozeMins} मिनट के लिए स्नूज़ कर दिया गया है` : `Task snoozed for ${snoozeMins} minutes`, 'snoozed');
        return;
      }

      // 2. Snooze specific scheduled alarm
      if (parsed.timeInfo) {
        let targetH = parsed.timeInfo.hour;
        if (parsed.timeInfo.ampm === 'pm' && targetH < 12) targetH += 12;
        if (parsed.timeInfo.ampm === 'am' && targetH === 12) targetH = 0;
        const targetM = parsed.timeInfo.minute;

        const alarmMatches = alarms.filter(a => {
          const d = new Date(a.time);
          const h = d.getHours();
          const m = d.getMinutes();
          return parsed.timeInfo.ampm ? (h === targetH && m === targetM) : ((h % 12 === targetH % 12) && m === targetM);
        });
        const matchAlarm = alarmMatches.find(a => a.enabled) || alarmMatches[0];
        if (matchAlarm) {
          matchAlarm.time = new Date(new Date(matchAlarm.time).getTime() + snoozeMins * 60000);
          matchAlarm.enabled = true;
          if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
            window.AndroidVoice.scheduleAlarm(matchAlarm.id, matchAlarm.time.getTime(), matchAlarm.label, matchAlarm.mode, matchAlarm.ttsText, matchAlarm.voice || 'female_1', matchAlarm.intervalMs || 0);
          }
          saveAlarms();
          renderAlarms();
          const timeStr = formatAlarmTimeString(matchAlarm.time);
          respond(isHi ? `अलार्म ${snoozeMins} मिनट आगे बढ़ाकर ${timeStr} बजे कर दिया गया है` : `Alarm snoozed by ${snoozeMins} minutes to ${timeStr}`, 'snoozed');
          return;
        }
      }

      // 3. Snooze upcoming alarm
      const activeAlarm = alarms.find(a => a.enabled);
      if (activeAlarm) {
        activeAlarm.time = new Date(new Date(activeAlarm.time).getTime() + snoozeMins * 60000);
        if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
          window.AndroidVoice.scheduleAlarm(activeAlarm.id, activeAlarm.time.getTime(), activeAlarm.label, activeAlarm.mode, activeAlarm.ttsText, activeAlarm.voice || 'female_1', activeAlarm.intervalMs || 0);
        }
        saveAlarms();
        renderAlarms();
        const timeStr = formatAlarmTimeString(activeAlarm.time);
        respond(isHi ? `आगामी अलार्म ${snoozeMins} मिनट आगे बढ़ाकर ${timeStr} बजे कर दिया गया है` : `Upcoming alarm snoozed by ${snoozeMins} minutes to ${timeStr}`, 'snoozed');
        return;
      }

      respond(isHi ? 'स्नूज़ करने के लिए कोई सक्रिय अलार्म नहीं है' : 'No active alarm to snooze', 'info');
      return;
    }

    // ==================== ALARM CREATION ====================
    if (parsed.type === 'alarm') {
      const effectiveNow = getEffectiveNow();
      let target = new Date(effectiveNow);
      let h = parsed.hour;
      const m = parsed.minute || 0;

      if (parsed.ampm === 'pm' && h < 12) h += 12;
      if (parsed.ampm === 'am' && h === 12) h = 0;
      target.setHours(h, m, 0, 0);

      // Smart upcoming detection if no AM/PM specified
      if (parsed.ampm === null && h < 12) {
        let amTarget = new Date(effectiveNow);
        amTarget.setHours(h, m, 0, 0);
        let pmTarget = new Date(effectiveNow);
        pmTarget.setHours(h + 12, m, 0, 0);
        if (amTarget > effectiveNow) {
          target = amTarget;
        } else if (pmTarget > effectiveNow) {
          target = pmTarget;
        } else {
          amTarget.setDate(amTarget.getDate() + 1);
          target = amTarget;
        }
      } else if (target <= effectiveNow) {
        target.setDate(target.getDate() + 1);
      }

      const chosenVoice = $('alarmVoice')?.value || (isHi ? 'female_in' : 'female_1');
      const al = {
        id: 'AL' + Date.now(),
        time: target,
        label: parsed.label || (isHi ? 'अलार्म' : 'Alarm'),
        message: parsed.label || (isHi ? 'अलार्म' : 'Alarm'),
        repeat: 'once',
        mode: 'tts',
        ttsText: parsed.label || (isHi ? 'अलार्म' : 'Alarm'),
        voice: chosenVoice,
        enabled: true,
        ringing: false,
        loopTimeout: null,
        audioObj: null
      };
      alarms.push(al);
      saveAlarms();
      renderAlarms();
      if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
        window.AndroidVoice.scheduleAlarm(al.id, al.time.getTime(), al.label, 'tts', al.ttsText, al.voice, al.intervalMs || 0);
      }
      const timeFormatted = formatAlarmTimeString(al.time);
      const resp = isHi 
        ? `अलार्म ${timeFormatted} बजे के लिए सेट कर दिया गया है` 
        : `Alarm set for ${timeFormatted}`;
      respond(resp, 'created');
      return;
    }

    // ==================== TASK CREATION ====================
    if (parsed.type === 'task') {
      const effectiveNow = getEffectiveNow();
      let target = new Date(effectiveNow);
      let h = parsed.hour;
      const m = parsed.minute || 0;

      if (parsed.ampm === 'pm' && h < 12) h += 12;
      if (parsed.ampm === 'am' && h === 12) h = 0;
      target.setHours(h, m, 0, 0);

      if (parsed.ampm === null && h < 12) {
        let amTarget = new Date(effectiveNow);
        amTarget.setHours(h, m, 0, 0);
        let pmTarget = new Date(effectiveNow);
        pmTarget.setHours(h + 12, m, 0, 0);
        if (amTarget > effectiveNow) {
          target = amTarget;
        } else if (pmTarget > effectiveNow) {
          target = pmTarget;
        } else {
          amTarget.setDate(amTarget.getDate() + 1);
          target = amTarget;
        }
      } else if (target <= effectiveNow) {
        target.setDate(target.getDate() + 1);
      }

      const chosenTaskVoice = $('taskVoice')?.value || (isHi ? 'female_in' : 'female_1');
      const t = {
        id: 'TSK' + Date.now(),
        title: parsed.title,
        time: target,
        repeat: 'once',
        intervalMs: null,
        voice: chosenTaskVoice,
        enabled: true,
        ringing: false,
        loopTimeout: null,
        audioObj: null
      };
      tasks.push(t);
      saveTasks();
      renderTasks();
      if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
        window.AndroidVoice.scheduleAlarm(t.id, t.time.getTime(), t.title, 'task', t.title, t.voice, t.intervalMs || 0);
      }
      const timeFormatted = formatAlarmTimeString(t.time);
      const resp = isHi 
        ? `कार्य "${parsed.title}" ${timeFormatted} बजे के लिए निर्धारित कर दिया गया है` 
        : `Task "${parsed.title}" scheduled for ${timeFormatted}`;
      respond(resp, 'created');
      return;
    }

    // Unrecognized command
    const resp = isHi 
      ? `माफ़ कीजिए, मैं समझ नहीं पाया। आप "7 बजे का अलार्म लगाओ", "अलार्म डिलीट करो" या "अलार्म बंद करो" कह सकते हैं।` 
      : `Sorry, I couldn't understand that. You can say "Set alarm at 7 AM", "Delete alarm", or "Stop alarm".`;
    respond(resp, 'info');
  }

  // Hotword wakeup trigger from background service or native recognizer
  window.handleWakeWordTrigger = function(rawText) {
    if (!rawText || !rawText.trim()) return;
    const isHi = isHindiInput(rawText);
    showListeningUI();
    try {
      if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
    } catch {}

    if (voiceLiveTranscript) voiceLiveTranscript.textContent = `"${rawText}"`;
    if (voiceText) voiceText.textContent = isHi ? "वॉयस क्लॉक" : "Voice Clock";
    if (voiceSub) voiceSub.textContent = isHi ? "निर्देश संसाधित हो रहा है..." : "Processing command...";

    handleCommand(rawText);

    setTimeout(() => {
      hideListeningUI();
    }, 3200);
  };

  // Sync voice assistant language on changes
  $('voiceLangSelect')?.addEventListener('change', (e) => {
    const newLang = e.target.value;
    if (window.AndroidVoice && typeof window.AndroidVoice.setVoiceAssistantLanguage === 'function') {
      window.AndroidVoice.setVoiceAssistantLanguage(newLang);
    }
  });

  setTimeout(() => {
    const selectedLang = $('voiceLangSelect')?.value || 'bilingual';
    if (window.AndroidVoice && typeof window.AndroidVoice.setVoiceAssistantLanguage === 'function') {
      window.AndroidVoice.setVoiceAssistantLanguage(selectedLang);
    }
    if (window.AndroidVoice && typeof window.AndroidVoice.isVoiceListeningActive === 'function') {
      isVoiceListeningActive = window.AndroidVoice.isVoiceListeningActive();
      updateVoiceButtonUI();
    }
  }, 600);

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
    let targetId = alarmId;
    if (!targetId) {
      if (currentActiveAlarmId) targetId = currentActiveAlarmId;
      else if (currentActiveTaskId) targetId = currentActiveTaskId;
    }

    const al = alarms.find(a => a.id === targetId);
    if (al) {
      if (action === 'snooze') {
        snoozeAlarmById(targetId);
      } else {
        dismissAlarmById(targetId);
      }
      return;
    }

    const t = tasks.find(x => x.id === targetId);
    if (t) {
      if (action === 'snooze') {
        snoozeTaskById(targetId);
      } else {
        dismissTaskById(targetId);
      }
      return;
    }

    // Fallback: stop all alarm & task audio and native services
    stopAlarmAudio();
    stopTaskAudio();
  }

  window.handleNativeAlarmEvent = handleNativeAlarmEvent;

  window.handleNativeAlarmTrigger = function(id, type, label) {
    const isHi = userSettings.appLanguage === 'hi';

    // Verify against deleted IDs
    let deletedIds = [];
    try {
      deletedIds = JSON.parse(localStorage.getItem("vc_deleted_ids") || "[]");
    } catch (e) {}

    if (deletedIds.includes(id)) {
      console.warn("handleNativeAlarmTrigger: ID " + id + " was deleted. Terminating!");
      if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) {
        window.AndroidVoice.cancelAlarm(id);
      }
      if (window.AndroidVoice && window.AndroidVoice.stopAlarmService) {
        window.AndroidVoice.stopAlarmService();
      }
      return;
    }

    if (type === 'task') {
      const t = tasks.find(x => x.id === id);
      if (!t || t.enabled === false) {
        console.warn("handleNativeAlarmTrigger: Task " + id + " not found or disabled. Purging!");
        permanentlyDeleteTaskItem(id);
        return;
      }
      currentActiveTaskId = id;
      scheduleInAppAutoSilence('task', id);
      const snoozeMins = (t && t.intervalMs && t.intervalMs > 0)
        ? Math.max(1, Math.round(t.intervalMs / 60000))
        : (parseInt(userSettings.snoozeDuration || '10', 10) || 10);
      const taskSwipeHint = $('taskSwipeHintLeft');
      if (taskSwipeHint) {
        taskSwipeHint.textContent = isHi ? `◂ स्नूज़ (${snoozeMins} मिनट)` : `◂ Slide to Snooze (${snoozeMins}m)`;
      }
      if (taskModalLabel) taskModalLabel.textContent = (t && t.title) ? t.title : (label || (isHi ? 'कार्य' : 'Task'));
      if (taskModalTime && t && t.time) taskModalTime.textContent = formatAlarmTimeString(t.time);
      taskModal?.classList.add('show');
      if (t) t.ringing = true;
      if (window.AndroidVoice && window.AndroidVoice.setAlarmRinging) {
        window.AndroidVoice.setAlarmRinging(true);
      }
    } else {
      const a = alarms.find(x => x.id === id);
      if (!a || a.enabled === false) {
        console.warn("handleNativeAlarmTrigger: Alarm " + id + " not found or disabled. Purging!");
        permanentlyDeleteAlarmItem(id);
        return;
      }
      currentActiveAlarmId = id;
      scheduleInAppAutoSilence('alarm', id);
      const snoozeMins = (a && a.intervalMs && a.intervalMs > 0)
        ? Math.max(1, Math.round(a.intervalMs / 60000))
        : (parseInt(userSettings.snoozeDuration || '10', 10) || 10);
      const alarmSwipeHint = $('alarmSwipeHintLeft');
      if (alarmSwipeHint) {
        alarmSwipeHint.textContent = isHi ? `◂ स्नूज़ (${snoozeMins} मिनट)` : `◂ Slide to Snooze (${snoozeMins}m)`;
      }
      if (modalLabel) modalLabel.textContent = (a && a.label) ? a.label : (label || (isHi ? 'अलार्म' : 'Alarm'));
      if (modalTime && a && a.time) modalTime.textContent = formatAlarmTimeString(a.time);
      if (modalMessage) {
        if (a && a.message && a.message !== a.label) {
          modalMessage.textContent = a.message;
          modalMessage.style.display = 'block';
        } else {
          modalMessage.textContent = '';
          modalMessage.style.display = 'none';
        }
      }
      alarmModal?.classList.add('show');
      if (a) a.ringing = true;
      if (window.AndroidVoice && window.AndroidVoice.setAlarmRinging) {
        window.AndroidVoice.setAlarmRinging(true);
      }
    }
  };

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
            let changedAlarms = false;
            let changedTasks = false;
            let deletedIds = [];
            try {
              deletedIds = JSON.parse(localStorage.getItem("vc_deleted_ids") || "[]");
            } catch (e) {}

            nativeList.forEach(nat => {
              if (deletedIds.includes(nat.id)) {
                // If it was deleted, purge it from native right away!
                if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) {
                  window.AndroidVoice.cancelAlarm(nat.id);
                }
                return;
              }

              const localAlarm = alarms.find(a => a.id === nat.id);
              const localTask = tasks.find(t => t.id === nat.id);

              if (!localAlarm && !localTask) {
                // Zombie alarm detected in native storage that does not exist in local tasks or alarms!
                console.warn("syncNativeAlarmState: Zombie alarm in native storage: " + nat.id + ". Purging.");
                if (window.AndroidVoice && window.AndroidVoice.cancelAlarm) {
                  window.AndroidVoice.cancelAlarm(nat.id);
                }
                return;
              }

              if (localAlarm) {
                const natTime = Number(nat.triggerTime);
                if (!isNaN(natTime) && natTime > localAlarm.time.getTime()) {
                  localAlarm.snoozedUntil = natTime;
                  localAlarm.ringing = false;
                  changedAlarms = true;
                }
                if (nat.voice && localAlarm.voice !== nat.voice) {
                  localAlarm.voice = nat.voice;
                  changedAlarms = true;
                }
              }
              if (localTask) {
                const natTime = Number(nat.triggerTime);
                const taskTimeMs = localTask.time instanceof Date ? localTask.time.getTime() : new Date(localTask.time).getTime();
                if (!isNaN(natTime) && natTime > taskTimeMs) {
                  localTask.snoozedUntil = natTime;
                  localTask.ringing = false;
                  changedTasks = true;
                }
                if (nat.voice && localTask.voice !== nat.voice) {
                  localTask.voice = nat.voice;
                  changedTasks = true;
                }
              }
            });
            if (changedAlarms) {
              saveAlarms();
              renderAlarms();
            }
            if (changedTasks) {
              saveTasks();
              renderTasks();
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

  // ============================================================
  // REMIND FAMILY & FRIENDS, LIVE NOTIFICATIONS & NOTIFICATION BAR ACTIONS
  // ============================================================
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  let vcAccount = null;
  function loadVcAccount() {
    try {
      const localStr = localStorage.getItem('vc_account');
      if (localStr) {
        vcAccount = JSON.parse(localStr);
      }
    } catch (e) {
      vcAccount = null;
    }
    // Check Android native SharedPreferences backup if not found in localStorage
    if (!vcAccount && window.AndroidVoice && window.AndroidVoice.getVcAccountNative) {
      try {
        const nativeStr = window.AndroidVoice.getVcAccountNative();
        if (nativeStr && nativeStr.trim()) {
          vcAccount = JSON.parse(nativeStr);
          try { localStorage.setItem('vc_account', nativeStr); } catch (e) {}
        }
      } catch (e) {}
    }
    return vcAccount;
  }
  loadVcAccount();

  let sentReminders = [];
  try {
    sentReminders = JSON.parse(localStorage.getItem('vc_sent_reminders')) || [];
  } catch (e) { sentReminders = []; }

  let receivedReminders = [];
  try {
    receivedReminders = JSON.parse(localStorage.getItem('vc_received_reminders')) || [];
  } catch (e) { receivedReminders = []; }

  let notificationsList = [];
  try {
    notificationsList = JSON.parse(localStorage.getItem('vc_notifications')) || [];
  } catch (e) { notificationsList = []; }

  let recentVcIds = [];
  try {
    recentVcIds = JSON.parse(localStorage.getItem('vc_recent_ids')) || [];
  } catch (e) { recentVcIds = []; }

  let trustedVcIds = [];
  try {
    trustedVcIds = JSON.parse(localStorage.getItem('vc_trusted_ids')) || [];
  } catch (e) { trustedVcIds = []; }

  let pendingVcAccount = null;
  let otpResendCountdown = 0;
  let otpTimerInterval = null;
  let familySyncEventSource = null;
  let familyPollingInterval = null;

  // Cryptographically Secure High-Entropy Unique VC ID Generator
  // 16 Crockford Base32 characters = 80 bits of pure CSPRNG entropy.
  // Zero guessability, mathematical impossibility of derivation from samples.
  function generateCryptographicVcId() {
    const charset = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 32 unambiguous characters
    const bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    let chars = "";
    for (let i = 0; i < 16; i++) {
      chars += charset[bytes[i] % 32];
    }
    return `VC-${chars.substring(0, 4)}-${chars.substring(4, 8)}-${chars.substring(8, 12)}-${chars.substring(12, 16)}`;
  }

  function generate8DigitOtp() {
    if (window.crypto && window.crypto.getRandomValues) {
      const arr = new Uint32Array(1);
      window.crypto.getRandomValues(arr);
      return String(10000000 + (arr[0] % 90000000));
    }
    return String(Math.floor(10000000 + Math.random() * 90000000));
  }

  function saveVcAccount() {
    if (vcAccount) {
      const jsonStr = JSON.stringify(vcAccount);
      try { localStorage.setItem('vc_account', jsonStr); } catch (e) {}
      if (window.AndroidVoice && window.AndroidVoice.saveVcAccountNative) {
        try { window.AndroidVoice.saveVcAccountNative(jsonStr); } catch (e) {}
      }
    } else {
      try { localStorage.removeItem('vc_account'); } catch (e) {}
      if (window.AndroidVoice && window.AndroidVoice.saveVcAccountNative) {
        try { window.AndroidVoice.saveVcAccountNative(''); } catch (e) {}
      }
    }
    updateFamilySettingsBadge();
    updateAuthVisibility();
  }

  function updateAuthVisibility() {
    const isLoggedIn = !!(vcAccount && vcAccount.verified);
    const createView = $('vcAccountCreateView');
    const hubView = $('remindFamilyHubView');

    if (isLoggedIn) {
      // If user is already logged in, never show the login/create account view
      if (createView && !createView.classList.contains('hidden')) {
        createView.classList.add('hidden');
        if (hubView) hubView.classList.remove('hidden');
      }
    } else {
      // When logged out, reset to create form section
      const createSec = $('vcCreateFormSection');
      const loginSec = $('vcLoginFormSection');
      if (createSec) createSec.classList.remove('hidden');
      if (loginSec) loginSec.classList.add('hidden');
      const headerTitle = $('vcCreateTitle');
      if (headerTitle) {
        headerTitle.textContent = userSettings.appLanguage === 'hi' ? 'VC खाता बनाएं' : 'Create VC Account';
      }
    }
  }

  function saveSentReminders() {
    localStorage.setItem('vc_sent_reminders', JSON.stringify(sentReminders));
    updateReminderBadges();
  }

  function saveReceivedReminders() {
    localStorage.setItem('vc_received_reminders', JSON.stringify(receivedReminders));
    updateReminderBadges();
  }

  function saveNotifications() {
    localStorage.setItem('vc_notifications', JSON.stringify(notificationsList));
    updateNotificationBadges();
  }

  function saveRecentVcIds() {
    localStorage.setItem('vc_recent_ids', JSON.stringify(recentVcIds));
    renderRecentVcIds();
  }

  function saveTrustedVcIds() {
    localStorage.setItem('vc_trusted_ids', JSON.stringify(trustedVcIds));
    updateReminderBadges();
    renderTrustedVcList();
  }

  function isVcIdTrusted(rawVcId) {
    if (!rawVcId) return false;
    const clean = rawVcId.trim().toUpperCase();
    return trustedVcIds.some(item => (item.vcId || '').trim().toUpperCase() === clean);
  }

  function updateFamilySettingsBadge() {
    const isHi = userSettings.appLanguage === 'hi';
    const badge = $('settingsFamilyBadge');
    if (!badge) return;
    if (vcAccount && vcAccount.verified) {
      badge.textContent = isHi ? 'सक्रिय' : 'Active';
      badge.classList.add('connected');
    } else {
      badge.textContent = isHi ? 'कनेक्ट करें' : 'Connect';
      badge.classList.remove('connected');
    }
  }

  function updateNotificationBadges() {
    const unreadCount = notificationsList.filter(n => n.unread).length;
    const settingsBadge = $('settingsNotifBadge');
    if (settingsBadge) {
      if (unreadCount > 0) {
        settingsBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        settingsBadge.classList.remove('hidden');
      } else {
        settingsBadge.classList.add('hidden');
      }
    }
    const hubBadge = $('hubNotifBadge');
    if (hubBadge) {
      if (unreadCount > 0) {
        hubBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        hubBadge.classList.remove('hidden');
      } else {
        hubBadge.classList.add('hidden');
      }
    }
  }

  function updateReminderBadges() {
    const sentBadge = $('badgeSentCount');
    if (sentBadge) sentBadge.textContent = sentReminders.length;
    const pendingReceived = receivedReminders.filter(r => r.status === 'pending').length;
    const recBadge = $('badgeReceivedCount');
    if (recBadge) recBadge.textContent = pendingReceived;
    const trustBadge = $('badgeTrustedCount');
    if (trustBadge) trustBadge.textContent = trustedVcIds.length;
  }

  function renderNotifications() {
    const container = $('notificationsList');
    if (!container) return;
    const isHi = userSettings.appLanguage === 'hi';
    if (notificationsList.length === 0) {
      container.innerHTML = `<div class="notif-empty-state">${isHi ? 'कोई सूचना नहीं है।' : 'No notifications yet.'}</div>`;
      return;
    }
    container.innerHTML = notificationsList.map(n => {
      let iconClass = '';
      let iconSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>';
      if (n.type === 'reminder_accepted') {
        iconClass = 'accepted';
        iconSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>';
      } else if (n.type === 'reminder_rejected') {
        iconClass = 'rejected';
        iconSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
      }
      const timeFormatted = new Date(n.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' • ' + new Date(n.time).toLocaleDateString([], { month: 'short', day: 'numeric' });
      return `
        <div class="notification-card ${n.unread ? 'unread' : ''}" data-id="${n.id}">
          <div class="notif-icon-circle ${iconClass}">${iconSvg}</div>
          <div class="notif-body">
            <div class="notif-title">${escapeHtml(n.title)}</div>
            <div class="notif-desc">${escapeHtml(n.message)}</div>
            <div class="notif-time">${timeFormatted}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderSentReminders() {
    const container = $('sentRemindersList');
    if (!container) return;
    const isHi = userSettings.appLanguage === 'hi';
    if (sentReminders.length === 0) {
      container.innerHTML = `<div class="notif-empty-state">${isHi ? 'आपने अभी तक कोई रिमाइंडर नहीं भेजा है।' : 'No reminders sent yet.'}</div>`;
      return;
    }
    container.innerHTML = sentReminders.slice().reverse().map(r => {
      const dt = new Date(r.timeIso);
      const timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', ' + dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
      const statusClass = r.status === 'accepted' ? 'status-accepted' : (r.status === 'rejected' ? 'status-rejected' : 'status-pending');
      const statusText = isHi
        ? (r.status === 'accepted' ? '✓ स्वीकृत' : (r.status === 'rejected' ? '✕ अस्वीकृत' : '⏳ लंबित'))
        : (r.status === 'accepted' ? '✓ Accepted' : (r.status === 'rejected' ? '✕ Declined' : '⏳ Pending'));
      const daysStr = r.repeatDays && r.repeatDays.length > 0 ? formatDaysSummary(r.repeatDays, isHi) : (isHi ? 'एक बार' : 'Once');
      return `
        <div class="reminder-card">
          <div class="reminder-card-header">
            <div class="reminder-sender-meta">
              <span class="reminder-person-name">${isHi ? 'प्राप्तकर्ता:' : 'To:'} ${escapeHtml(r.targetVcId)}</span>
            </div>
            <span class="reminder-status-badge ${statusClass}">${statusText}</span>
          </div>
          <div class="reminder-card-body">
            <h4 class="reminder-card-title">${escapeHtml(r.title)}</h4>
            <div class="reminder-card-details">
              <span class="reminder-detail-tag">⏰ ${timeStr}</span>
              <span class="reminder-detail-tag">🔁 ${daysStr}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderReceivedReminders() {
    const container = $('receivedRemindersList');
    if (!container) return;
    const isHi = userSettings.appLanguage === 'hi';
    if (receivedReminders.length === 0) {
      container.innerHTML = `<div class="notif-empty-state">${isHi ? 'कोई प्राप्त रिमाइंडर नहीं है।' : 'No received reminders yet.'}</div>`;
      return;
    }
    container.innerHTML = receivedReminders.slice().reverse().map(r => {
      const dt = new Date(r.timeIso);
      const timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', ' + dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
      const isAutoAccepted = r.status === 'accepted' && r.autoAccepted;
      let statusText = isHi
        ? (r.status === 'accepted' ? (isAutoAccepted ? '🛡️ स्वतः स्वीकृत' : '✓ स्वीकृत') : (r.status === 'rejected' ? '✕ अस्वीकृत' : '⏳ लंबित'))
        : (r.status === 'accepted' ? (isAutoAccepted ? '🛡️ Auto-Accepted' : '✓ Accepted') : (r.status === 'rejected' ? '✕ Declined' : '⏳ Pending'));
      const statusClass = r.status === 'accepted' ? 'status-accepted' : (r.status === 'rejected' ? 'status-rejected' : 'status-pending');
      const daysStr = r.repeatDays && r.repeatDays.length > 0 ? formatDaysSummary(r.repeatDays, isHi) : (isHi ? 'एक बार' : 'Once');
      const isPending = r.status === 'pending';
      const senderTrusted = r.senderVcId && isVcIdTrusted(r.senderVcId);

      return `
        <div class="reminder-card" id="receivedCard_${r.id}">
          <div class="reminder-card-header">
            <div class="reminder-sender-meta">
              <span class="reminder-person-name" style="display:flex;align-items:center;gap:6px;">
                ${senderTrusted ? '<span>🛡️</span>' : ''}
                <span>${escapeHtml(r.senderName || 'Family/Friend')}</span>
              </span>
              <span class="reminder-person-vcid">${escapeHtml(r.senderVcId || '')}</span>
            </div>
            <span class="reminder-status-badge ${statusClass}">${statusText}</span>
          </div>
          <div class="reminder-card-body">
            <h4 class="reminder-card-title">${escapeHtml(r.title)}</h4>
            <div class="reminder-card-details">
              <span class="reminder-detail-tag">⏰ ${timeStr}</span>
              <span class="reminder-detail-tag">🔁 ${daysStr}</span>
              ${isAutoAccepted ? `<span class="reminder-detail-tag" style="color:#10b981;">🛡️ ${isHi ? 'विश्वसनीय संपर्क से स्वतः जुड़ा' : 'Auto-added from Trusted VC ID'}</span>` : ''}
              ${(!senderTrusted && r.senderVcId) ? `
                <button type="button" class="btn-trust-inline" onclick="window.quickTrustSender('${escapeHtml(r.senderVcId)}', '${escapeHtml(r.senderName || '')}')">
                  🛡️ ${isHi ? '+ विश्वसनीय बनाएं' : '+ Trust Contact'}
                </button>
              ` : ''}
            </div>
          </div>
          ${isPending ? `
            <div class="reminder-actions-row">
              <button type="button" class="reminder-action-btn accept-btn" onclick="window.handleRemoteReminderAction('${r.id}', 'accept')">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
                <span>${isHi ? 'स्वीकार करें' : 'Accept'}</span>
              </button>
              <button type="button" class="reminder-action-btn reject-btn" onclick="window.handleRemoteReminderAction('${r.id}', 'reject')">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                <span>${isHi ? 'अस्वीकार करें' : 'Decline'}</span>
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  function renderTrustedVcList() {
    const container = $('trustedVcListContainer');
    if (!container) return;
    const isHi = userSettings.appLanguage === 'hi';

    if (trustedVcIds.length === 0) {
      container.innerHTML = `
        <div class="notif-empty-state" style="padding:32px 16px;text-align:center;">
          <div style="font-size:36px;margin-bottom:10px;">🛡️</div>
          <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px;">
            ${isHi ? 'कोई विश्वसनीय VC ID नहीं है' : 'No Trusted VC IDs Yet'}
          </div>
          <p style="font-size:12px;color:var(--muted);max-width:320px;margin:0 auto;line-height:1.5;">
            ${isHi 
              ? 'ऊपर अपने प्रियजनों या विश्वसनीय संपर्कों की VC ID जोड़ें। उनके द्वारा भेजा गया कोई भी रिमाइंडर बिना अनुमति पूछे सीधे आपके टास्क में अपने आप जुड़ जाएगा।' 
              : 'Add VC IDs of your loved ones or trusted contacts above. Reminders sent by them will bypass manual confirmation and be automatically scheduled in your Tasks.'}
          </p>
        </div>
      `;
      return;
    }

    container.innerHTML = trustedVcIds.slice().reverse().map(item => {
      const addedDate = new Date(item.addedAt || Date.now()).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      const displayName = item.name ? item.name : (isHi ? 'विश्वसनीय संपर्क' : 'Trusted Contact');
      return `
        <div class="reminder-card trusted-vc-card" id="trustedCard_${item.id}">
          <div class="reminder-card-header">
            <div class="reminder-sender-meta">
              <span class="reminder-person-name" style="display:flex;align-items:center;gap:6px;">
                <span>🛡️</span>
                <span>${escapeHtml(displayName)}</span>
              </span>
              <span class="reminder-person-vcid" style="color:#38bdf8;font-weight:600;">${escapeHtml(item.vcId)}</span>
            </div>
            <span class="reminder-status-badge status-accepted" style="display:flex;align-items:center;gap:4px;">
              <span>✓</span>
              <span>${isHi ? 'स्वतः स्वीकार' : 'Auto-Accept'}</span>
            </span>
          </div>
          <div class="reminder-card-body" style="margin-bottom:6px;">
            <div class="reminder-card-details">
              <span class="reminder-detail-tag">📅 ${isHi ? 'जोड़ा गया: ' : 'Added: '} ${addedDate}</span>
              <span class="reminder-detail-tag" style="color:#10b981;">⚡ ${isHi ? 'बिना पूछे टास्क में जुड़ेगा' : 'Auto-adds to Tasks'}</span>
            </div>
          </div>
          <div class="reminder-actions-row" style="margin-top:6px;padding-top:8px;">
            <button type="button" class="btn-copy-trusted-id reminder-action-btn" style="background:var(--item-bg);color:var(--text);border:1px solid var(--card-border);" data-id="${item.vcId}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
              <span>${isHi ? 'ID कॉपी करें' : 'Copy ID'}</span>
            </button>
            <button type="button" class="btn-remove-trusted reminder-action-btn reject-btn" data-tid="${item.id}" data-name="${escapeHtml(displayName)}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
              <span>${isHi ? 'हटाएं' : 'Remove'}</span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.btn-copy-trusted-id').forEach(btn => {
      btn.addEventListener('click', () => {
        const idToCopy = btn.dataset.id;
        if (window.AndroidVoice && window.AndroidVoice.copyToClipboard) {
          window.AndroidVoice.copyToClipboard(idToCopy);
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(idToCopy).catch(() => {});
        }
        showPopup(isHi ? 'VC ID क्लिपबोर्ड पर कॉपी हो गया' : 'VC ID copied to clipboard');
      });
    });

    container.querySelectorAll('.btn-remove-trusted').forEach(btn => {
      btn.addEventListener('click', () => {
        const tid = btn.dataset.tid;
        const name = btn.dataset.name;
        if (confirm(isHi ? `क्या आप "${name}" को विश्वसनीय संपर्क से हटाना चाहते हैं?` : `Remove "${name}" from Trusted Contacts?`)) {
          trustedVcIds = trustedVcIds.filter(t => t.id !== tid);
          saveTrustedVcIds();
          showPopup(isHi ? 'विश्वसनीय संपर्क हटा दिया गया' : 'Trusted contact removed');
        }
      });
    });
  }

  window.quickTrustSender = function(senderVcId, senderName) {
    if (!senderVcId) return;
    const isHi = userSettings.appLanguage === 'hi';
    const cleanId = senderVcId.trim().toUpperCase();
    if (vcAccount && cleanId === vcAccount.vcId.trim().toUpperCase()) return;
    if (trustedVcIds.some(t => (t.vcId || '').trim().toUpperCase() === cleanId)) {
      showPopup(isHi ? 'यह VC ID पहले से विश्वसनीय है' : 'This VC ID is already trusted');
      return;
    }
    const newTrusted = {
      id: 'TID' + Date.now(),
      vcId: cleanId,
      name: (senderName || '').trim() || (isHi ? 'विश्वसनीय संपर्क' : 'Trusted Contact'),
      addedAt: Date.now()
    };
    trustedVcIds.push(newTrusted);
    saveTrustedVcIds();
    renderReceivedReminders();
    showPopup(isHi 
      ? `✓ "${newTrusted.name}" अब विश्वसनीय संपर्क है। भविष्य के रिमाइंडर अपने आप टास्क में जुड़ेंगे!` 
      : `✓ "${newTrusted.name}" is now trusted. Future reminders will be auto-accepted!`);
  };

  function renderRecentVcIds() {
    const wrap = $('recentVcIdsWrap');
    const list = $('recentVcIdsList');
    if (!wrap || !list) return;
    if (recentVcIds.length === 0) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    list.innerHTML = recentVcIds.map(id => `
      <button type="button" class="recent-id-chip" data-id="${id}">${id}</button>
    `).join('');
    list.querySelectorAll('.recent-id-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const inp = $('targetVcIdInput');
        if (inp) inp.value = btn.dataset.id;
      });
    });
  }

  // ============================================================
  // REMOTE REMINDER ACTION HANDLER (In-App + Notification Bar)
  // ============================================================
  window.handleRemoteReminderAction = function(reminderId, action) {
    const isHi = userSettings.appLanguage === 'hi';
    const reminder = receivedReminders.find(r => r.id === reminderId);
    if (!reminder) return;
    if (reminder.status !== 'pending') return;

    if (action === 'accept') {
      reminder.status = 'accepted';
      reminder.respondedAt = Date.now();

      // Convert to native Task in receiver's normal Tasks tab history!
      let taskDt = new Date(reminder.timeIso);
      const now = new Date();
      const baseH = taskDt.getHours();
      const baseM = taskDt.getMinutes();
      const selectedDays = reminder.repeatDays || [];
      if (selectedDays.length > 0) {
        const nextOccur = getNextOccurrenceForDays(baseH, baseM, selectedDays);
        if (nextOccur) taskDt = nextOccur;
      } else if (taskDt <= now) {
        taskDt.setDate(taskDt.getDate() + 1);
      }

      const taskRepeat = reminder.repeat || (selectedDays.length > 0 ? 'days' : 'once');
      const taskIntervalMs = reminder.intervalMs || null;
      const newTask = {
        id: 'TSK' + Date.now(),
        title: reminder.title + (reminder.senderName ? ` (${reminder.senderName})` : ''),
        time: taskDt,
        baseH: baseH,
        baseM: baseM,
        repeat: taskRepeat,
        repeatDays: selectedDays,
        intervalMs: taskIntervalMs,
        voice: reminder.voice || 'female_1',
        enabled: true,
        ringing: false,
        snoozedUntil: null,
        loopTimeout: null,
        audioObj: null
      };
      tasks.push(newTask);
      saveTasks();

      if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
        window.AndroidVoice.scheduleAlarm(
          newTask.id,
          newTask.time.getTime(),
          newTask.title,
          'task',
          newTask.title,
          newTask.voice,
          newTask.intervalMs || 0
        );
      }
      renderTasks();

      // Send acceptance response back to sender
      sendPubSubResponse(reminder, 'accepted');

      // Dismiss system notification
      if (window.AndroidVoice && window.AndroidVoice.cancelReminderNotification) {
        window.AndroidVoice.cancelReminderNotification(reminderId);
      }

      // Add to notifications
      notificationsList.unshift({
        id: 'NOTIF' + Date.now(),
        type: 'reminder_accepted',
        title: isHi ? 'रिमाइंडर स्वीकार किया' : 'Reminder Accepted',
        message: isHi ? `"${reminder.title}" आपके टास्क में जोड़ दिया गया है।` : `"${reminder.title}" added to your Tasks.`,
        time: Date.now(),
        unread: false,
        reminderId: reminder.id
      });

      showPopup(isHi ? '✓ रिमाइंडर स्वीकार किया गया और टास्क में जोड़ा गया!' : '✓ Reminder accepted & scheduled in Tasks!');
    } else {
      reminder.status = 'rejected';
      reminder.respondedAt = Date.now();

      // Send rejection response back to sender
      sendPubSubResponse(reminder, 'rejected');

      // Dismiss system notification
      if (window.AndroidVoice && window.AndroidVoice.cancelReminderNotification) {
        window.AndroidVoice.cancelReminderNotification(reminderId);
      }

      // Add to notifications
      notificationsList.unshift({
        id: 'NOTIF' + Date.now(),
        type: 'reminder_rejected',
        title: isHi ? 'रिमाइंडर अस्वीकृत' : 'Reminder Declined',
        message: isHi ? `आपने "${reminder.title}" को अस्वीकार कर दिया।` : `You declined "${reminder.title}".`,
        time: Date.now(),
        unread: false,
        reminderId: reminder.id
      });

      showPopup(isHi ? 'रिमाइंडर अस्वीकार कर दिया गया' : 'Reminder declined');
    }

    saveReceivedReminders();
    saveNotifications();
    renderReceivedReminders();
    renderNotifications();
    updateReminderBadges();
  };

  function sendPubSubResponse(reminder, status) {
    if (!reminder.senderVcId) return;
    const cleanSender = reminder.senderVcId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const payload = {
      type: 'reminder_response',
      reminderId: reminder.id,
      status: status,
      responderName: vcAccount ? vcAccount.name : 'Recipient',
      responderVcId: vcAccount ? vcAccount.vcId : '',
      title: reminder.title,
      respondedAt: Date.now()
    };
    try {
      fetch('https://ntfy.sh/vc_user_' + cleanSender, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(e => console.log('Error posting reminder response:', e));
    } catch (e) {}

    // Local loopback for single-device test
    localStorage.setItem('vc_local_bus', JSON.stringify({ to: reminder.senderVcId, payload, ts: Date.now() }));
    window.dispatchEvent(new CustomEvent('vc_local_sync', { detail: { to: reminder.senderVcId, payload } }));
  }

  function sendFamilyReminder() {
    const isHi = userSettings.appLanguage === 'hi';
    const targetInput = $('targetVcIdInput');
    const titleInput = $('reminderTitleInput');
    const dtInput = $('reminderDateTimeInput');
    const voiceSelect = $('familyVoiceSelect');

    const targetVcId = targetInput ? targetInput.value.trim().toUpperCase() : '';
    const title = titleInput ? titleInput.value.trim() : '';
    const dtVal = dtInput ? dtInput.value : '';
    const voice = voiceSelect ? voiceSelect.value : 'female_1';

    if (!targetVcId) {
      alert(isHi ? 'कृपया प्राप्तकर्ता का VC ID दर्ज करें' : 'Please enter recipient VC ID');
      return;
    }
    if (vcAccount && targetVcId === vcAccount.vcId) {
      alert(isHi ? 'आप स्वयं को रिमाइंडर नहीं भेज सकते। कृपया परिवार या मित्र का VC ID दर्ज करें।' : 'You cannot send a reminder to yourself. Please enter your family or friend\'s VC ID.');
      return;
    }
    if (!title) {
      alert(isHi ? 'कृपया रिमाइंडर संदेश दर्ज करें' : 'Please enter reminder message');
      return;
    }
    if (!dtVal) {
      alert(isHi ? 'कृपया दिनांक और समय चुनें' : 'Please select date & time');
      return;
    }

    const selectedDays = getSelectedDays('familyReminderDayPills');
    const repSelect = $('familyRepeatSelect');
    const repVal = repSelect ? repSelect.value : 'once';
    let reminderIntervalMs = null;
    if (repVal === 'custom') {
      const customH = parseInt($('familyCustomHours')?.value || 0, 10);
      const customM = parseInt($('familyCustomMinutes')?.value || 0, 10);
      reminderIntervalMs = (customH * 3600000) + (customM * 60000);
      if (!reminderIntervalMs || reminderIntervalMs <= 0) reminderIntervalMs = 60000;
    } else {
      const mapping = {
        '1 min': 60000,
        '5 min': 300000,
        '10 min': 600000,
        '1 hr': 3600000,
        '5 hr': 18000000
      };
      if (mapping[repVal]) reminderIntervalMs = mapping[repVal];
    }

    const cleanTarget = targetVcId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const reminderId = 'REM' + Date.now();

    const newReminder = {
      id: reminderId,
      targetVcId: targetVcId,
      title: title,
      timeIso: new Date(dtVal).toISOString(),
      repeat: repVal,
      repeatDays: selectedDays,
      intervalMs: reminderIntervalMs,
      voice: voice,
      status: 'pending',
      createdAt: Date.now(),
      respondedAt: null
    };

    sentReminders.push(newReminder);
    saveSentReminders();

    // Save to recents
    if (!recentVcIds.includes(targetVcId)) {
      recentVcIds.unshift(targetVcId);
      if (recentVcIds.length > 5) recentVcIds.pop();
      saveRecentVcIds();
    }

    // Publish to recipient's topic
    const payload = {
      type: 'reminder_request',
      reminderId: reminderId,
      senderName: vcAccount ? vcAccount.name : 'Family Member',
      senderVcId: vcAccount ? vcAccount.vcId : '',
      title: title,
      timeIso: newReminder.timeIso,
      repeat: repVal,
      repeatDays: selectedDays,
      intervalMs: reminderIntervalMs,
      voice: voice,
      createdAt: Date.now()
    };

    try {
      fetch('https://ntfy.sh/vc_user_' + cleanTarget, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(() => {
        showPopup(isHi ? '✓ रिमाइंडर सफलतापूर्वक भेजा गया!' : '✓ Reminder sent successfully!');
      }).catch(e => {
        console.log('Error posting reminder:', e);
        showPopup(isHi ? '✓ रिमाइंडर कतारबद्ध हुआ' : '✓ Reminder queued');
      });
    } catch (e) {
      showPopup(isHi ? '✓ रिमाइंडर कतारबद्ध हुआ' : '✓ Reminder queued');
    }

    // Local loopback for single-device test
    localStorage.setItem('vc_local_bus', JSON.stringify({ to: targetVcId, payload, ts: Date.now() }));
    window.dispatchEvent(new CustomEvent('vc_local_sync', { detail: { to: targetVcId, payload } }));

    // Reset inputs
    if (titleInput) titleInput.value = '';
    if (repSelect) repSelect.value = 'once';
    if ($('familyCustomHours')) $('familyCustomHours').value = '';
    if ($('familyCustomMinutes')) $('familyCustomMinutes').value = '';
    if ($('familyCustomIntervalBox')) $('familyCustomIntervalBox').style.display = 'none';
    setSelectedDays('familyReminderDayPills', []);

    // Switch to Sent Reminders subview
    switchFamilySubview('subviewSentReminders');
    renderSentReminders();
  }

  function handleIncomingPubSubMessage(msg) {
    if (!msg || !msg.type) return;
    const isHi = userSettings.appLanguage === 'hi';

    if (msg.type === 'reminder_request') {
      // Avoid duplicate reception
      if (receivedReminders.some(r => r.id === msg.reminderId)) return;

      const receivedItem = {
        id: msg.reminderId,
        senderName: msg.senderName || 'Family/Friend',
        senderVcId: msg.senderVcId || '',
        title: msg.title,
        timeIso: msg.timeIso,
        repeat: msg.repeat || (msg.repeatDays && msg.repeatDays.length > 0 ? 'days' : 'once'),
        repeatDays: msg.repeatDays || [],
        intervalMs: msg.intervalMs || null,
        voice: msg.voice || 'female_1',
        status: 'pending',
        createdAt: msg.createdAt || Date.now()
      };
      receivedReminders.push(receivedItem);
      saveReceivedReminders();

      // Check if sender is in Trusted VC IDs list
      if (isVcIdTrusted(receivedItem.senderVcId)) {
        // AUTOMATIC ACCEPTANCE FOR TRUSTED CONTACT!
        // No manual confirmation required: directly accepted and added to tasks history!
        receivedItem.status = 'accepted';
        receivedItem.autoAccepted = true;
        receivedItem.respondedAt = Date.now();
        saveReceivedReminders();

        // Convert to native Task in receiver's normal Tasks tab
        let taskDt = new Date(receivedItem.timeIso);
        const now = new Date();
        const baseH = taskDt.getHours();
        const baseM = taskDt.getMinutes();
        const selectedDays = receivedItem.repeatDays || [];
        if (selectedDays.length > 0) {
          const nextOccur = getNextOccurrenceForDays(baseH, baseM, selectedDays);
          if (nextOccur) taskDt = nextOccur;
        } else if (taskDt <= now) {
          taskDt.setDate(taskDt.getDate() + 1);
        }

        const taskRepeat = receivedItem.repeat || (selectedDays.length > 0 ? 'days' : 'once');
        const taskIntervalMs = receivedItem.intervalMs || null;
        const newTask = {
          id: 'TSK' + Date.now(),
          title: receivedItem.title + (receivedItem.senderName ? ` (${receivedItem.senderName})` : ''),
          time: taskDt,
          baseH: baseH,
          baseM: baseM,
          repeat: taskRepeat,
          repeatDays: selectedDays,
          intervalMs: taskIntervalMs,
          voice: receivedItem.voice || 'female_1',
          enabled: true,
          ringing: false,
          snoozedUntil: null,
          loopTimeout: null,
          audioObj: null
        };
        tasks.push(newTask);
        saveTasks();

        if (window.AndroidVoice && window.AndroidVoice.scheduleAlarm) {
          window.AndroidVoice.scheduleAlarm(
            newTask.id,
            newTask.time.getTime(),
            newTask.title,
            'task',
            newTask.title,
            newTask.voice,
            newTask.intervalMs || 0
          );
        }
        renderTasks();

        addLog(isHi 
          ? `विश्वसनीय संपर्क (${receivedItem.senderName}): रिमाइंडर कार्य "${newTask.title}" में स्वतः जुड़ा` 
          : `Trusted contact (${receivedItem.senderName}): reminder auto-added to task "${newTask.title}"`);

        // Notify sender via pub/sub that reminder was accepted!
        sendPubSubResponse(receivedItem, 'accepted');

        // Add to notifications history
        notificationsList.unshift({
          id: 'NOTIF' + Date.now(),
          type: 'reminder_auto_accepted',
          title: isHi ? `🛡️ ${receivedItem.senderName} (विश्वसनीय) से नया कार्य` : `🛡️ Task Auto-Added from ${receivedItem.senderName}`,
          message: isHi 
            ? `"${receivedItem.title}" आपके विश्वसनीय VC ID संपर्क से प्राप्त हुआ और सीधे आपके टास्क में जोड़ दिया गया।`
            : `"${receivedItem.title}" from trusted contact ${receivedItem.senderName} was automatically accepted and scheduled in your Tasks.`,
          time: Date.now(),
          unread: true,
          reminderId: receivedItem.id
        });
        saveNotifications();

        // Phone status bar notification informing user
        if (window.AndroidVoice && window.AndroidVoice.postStatusNotification) {
          window.AndroidVoice.postStatusNotification(
            isHi ? `🛡️ विश्वसनीय रिमाइंडर स्वतः टास्क में जुड़ा` : `🛡️ Trusted Reminder Auto-Added to Tasks`,
            `"${receivedItem.title}" (${receivedItem.senderName})`
          );
        }

        showPopup(isHi 
          ? `🛡️ विश्वसनीय संपर्क (${receivedItem.senderName}): रिमाइंडर स्वतः टास्क में जोड़ा गया!`
          : `🛡️ Trusted contact (${receivedItem.senderName}): Reminder auto-added to Tasks!`);

        renderReceivedReminders();
        renderNotifications();
        updateReminderBadges();
        return;
      }

      // Add to notifications history
      notificationsList.unshift({
        id: 'NOTIF' + Date.now(),
        type: 'reminder_incoming',
        title: isHi ? `${receivedItem.senderName} से नया रिमाइंडर` : `New Reminder from ${receivedItem.senderName}`,
        message: receivedItem.title,
        time: Date.now(),
        unread: true,
        reminderId: receivedItem.id
      });
      saveNotifications();

      // Format time string for system notification
      const dt = new Date(receivedItem.timeIso);
      const timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const daysStr = receivedItem.repeatDays && receivedItem.repeatDays.length > 0 ? formatDaysSummary(receivedItem.repeatDays, isHi) : (isHi ? 'एक बार' : 'Once');

      // Post Android system notification with Accept & Reject buttons!
      if (window.AndroidVoice && window.AndroidVoice.postReminderNotification) {
        window.AndroidVoice.postReminderNotification(
          receivedItem.id,
          receivedItem.senderName,
          receivedItem.title,
          timeStr,
          daysStr
        );
      }

      showPopup(isHi ? `नया रिमाइंडर: "${receivedItem.title}"` : `New reminder: "${receivedItem.title}"`);
      renderReceivedReminders();
      renderNotifications();
      updateReminderBadges();
    }
    else if (msg.type === 'reminder_response') {
      const sentItem = sentReminders.find(r => r.id === msg.reminderId);
      if (sentItem) {
        sentItem.status = msg.status;
        sentItem.respondedAt = msg.respondedAt || Date.now();
        saveSentReminders();

        const notifTitle = msg.status === 'accepted'
          ? (isHi ? `✓ ${msg.responderName || 'प्राप्तकर्ता'} ने स्वीकार किया` : `✓ ${msg.responderName || 'Recipient'} accepted`)
          : (isHi ? `✕ ${msg.responderName || 'प्राप्तकर्ता'} ने अस्वीकार किया` : `✕ ${msg.responderName || 'Recipient'} declined`);
        const notifMsg = msg.status === 'accepted'
          ? (isHi ? `"${sentItem.title}" उनके वॉयस क्लॉक टास्क में जोड़ दिया गया है।` : `"${sentItem.title}" was added to their Tasks.`)
          : (isHi ? `"${sentItem.title}" को स्वीकार नहीं किया गया।` : `"${sentItem.title}" was not accepted.`);

        notificationsList.unshift({
          id: 'NOTIF' + Date.now(),
          type: msg.status === 'accepted' ? 'reminder_accepted' : 'reminder_rejected',
          title: notifTitle,
          message: notifMsg,
          time: Date.now(),
          unread: true,
          reminderId: sentItem.id
        });
        saveNotifications();

        // Alert sender via phone notification bar
        if (window.AndroidVoice && window.AndroidVoice.postStatusNotification) {
          window.AndroidVoice.postStatusNotification(notifTitle, notifMsg);
        }

        showPopup(notifTitle);
        renderSentReminders();
        renderNotifications();
      }
    }
  }

  function startFamilyRealtimeSync() {
    if (!vcAccount || !vcAccount.verified || !vcAccount.vcId) return;
    const cleanId = vcAccount.vcId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

    if (familySyncEventSource) {
      try { familySyncEventSource.close(); } catch {}
      familySyncEventSource = null;
    }

    try {
      familySyncEventSource = new EventSource('https://ntfy.sh/vc_user_' + cleanId + '/sse');
      familySyncEventSource.onmessage = function(e) {
        try {
          const data = JSON.parse(e.data);
          if (data && data.message) {
            try {
              const inner = JSON.parse(data.message);
              handleIncomingPubSubMessage(inner);
            } catch {
              handleIncomingPubSubMessage(data);
            }
          } else {
            handleIncomingPubSubMessage(data);
          }
        } catch (err) {}
      };
      familySyncEventSource.onerror = function() {};
    } catch (e) {}

    // Polling fallback every 5s
    if (familyPollingInterval) clearInterval(familyPollingInterval);
    familyPollingInterval = setInterval(() => {
      if (!vcAccount || !vcAccount.verified) return;
      fetch('https://ntfy.sh/vc_user_' + cleanId + '/json?poll=1&since=5m')
        .then(res => res.text())
        .then(text => {
          if (!text) return;
          const lines = text.trim().split('\n');
          lines.forEach(line => {
            try {
              const obj = JSON.parse(line);
              if (obj && obj.message) {
                try {
                  const inner = JSON.parse(obj.message);
                  handleIncomingPubSubMessage(inner);
                } catch {
                  handleIncomingPubSubMessage(obj);
                }
              }
            } catch {}
          });
        })
        .catch(() => {});
    }, 5000);

    // Cross-account local sync listener
    window.addEventListener('storage', (e) => {
      if (e.key === 'vc_local_bus' && e.newValue) {
        try {
          const item = JSON.parse(e.newValue);
          if (vcAccount && item.to === vcAccount.vcId) {
            handleIncomingPubSubMessage(item.payload);
          }
        } catch {}
      }
    });
    window.addEventListener('vc_local_sync', (e) => {
      if (e.detail && vcAccount && e.detail.to === vcAccount.vcId) {
        handleIncomingPubSubMessage(e.detail.payload);
      }
    });
  }

  function switchFamilySubview(subviewId) {
    const subviews = ['subviewSendReminder', 'subviewSentReminders', 'subviewReceivedReminders', 'subviewTrustedVc', 'subviewMyAccount'];
    subviews.forEach(id => {
      const el = $(id);
      if (el) el.classList.toggle('hidden', id !== subviewId);
    });

    const navMap = {
      'subviewSendReminder': { navId: 'navSendReminderBtn', titleEn: 'Send Reminder', titleHi: 'रिमाइंडर भेजें' },
      'subviewSentReminders': { navId: 'navSentRemindersBtn', titleEn: 'Sent Reminders', titleHi: 'भेजे गए रिमाइंडर' },
      'subviewReceivedReminders': { navId: 'navReceivedRemindersBtn', titleEn: 'Received Reminders', titleHi: 'प्राप्त रिमाइंडर' },
      'subviewTrustedVc': { navId: 'navTrustedVcBtn', titleEn: 'Trusted VC IDs', titleHi: 'विश्वसनीय VC ID' },
      'subviewMyAccount': { navId: 'navMyAccountBtn', titleEn: 'My VC Account', titleHi: 'मेरा VC खाता' }
    };

    const isHi = userSettings.appLanguage === 'hi';
    const activeInfo = navMap[subviewId];
    if (activeInfo) {
      document.querySelectorAll('.sidebar-nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.id === activeInfo.navId);
      });
      const titleEl = $('familyHubTitle');
      if (titleEl) titleEl.textContent = isHi ? activeInfo.titleHi : activeInfo.titleEn;
    }

    $('remindFamilySidebar')?.classList.add('hidden');
    $('familySidebarOverlay')?.classList.add('hidden');

    if (subviewId === 'subviewSentReminders') renderSentReminders();
    if (subviewId === 'subviewReceivedReminders') renderReceivedReminders();
    if (subviewId === 'subviewTrustedVc') renderTrustedVcList();
    if (subviewId === 'subviewMyAccount') populateAccountDisplay();
  }

  function populateAccountDisplay() {
    if (!vcAccount) return;
    const nameEl = $('accountViewName');
    if (nameEl) nameEl.textContent = vcAccount.name;
    const sideNameEl = $('sidebarUserName');
    if (sideNameEl) sideNameEl.textContent = vcAccount.name;

    const emailEl = $('accountViewEmail');
    if (emailEl) emailEl.textContent = vcAccount.email;

    const idEl = $('accountViewVcId');
    if (idEl) idEl.textContent = vcAccount.vcId;
    const sideIdEl = $('sidebarUserVcId');
    if (sideIdEl) sideIdEl.textContent = vcAccount.vcId;

    const initials = (vcAccount.name || 'VC').trim().substring(0, 2).toUpperCase();
    const bigAvatar = $('accountBigAvatar');
    if (bigAvatar) bigAvatar.textContent = initials;
    const sideAvatar = $('sidebarAvatar');
    if (sideAvatar) sideAvatar.textContent = initials;
  }

  function startOtpResendTimer() {
    otpResendCountdown = 30;
    const timerEl = $('otpTimerDisplay');
    const resendBtn = $('btnResendVcOtp');
    const isHi = userSettings.appLanguage === 'hi';
    if (resendBtn) resendBtn.disabled = true;

    if (otpTimerInterval) clearInterval(otpTimerInterval);
    otpTimerInterval = setInterval(() => {
      otpResendCountdown--;
      if (timerEl) {
        timerEl.textContent = isHi
          ? `पुनः भेजें ${otpResendCountdown}s में उपलब्ध`
          : `Resend available in ${otpResendCountdown}s`;
      }
      if (otpResendCountdown <= 0) {
        clearInterval(otpTimerInterval);
        if (resendBtn) resendBtn.disabled = false;
        if (timerEl) timerEl.textContent = isHi ? 'अब आप दोबारा OTP भेज सकते हैं' : 'You can resend OTP now';
      }
    }, 1000);
  }

  // Event Listeners for Family & Notifications Views
  $('settingRemindFamilyBtn')?.addEventListener('click', () => {
    loadVcAccount();
    if (vcAccount && vcAccount.verified) {
      populateAccountDisplay();
      renderRecentVcIds();
      renderSentReminders();
      renderReceivedReminders();
      renderTrustedVcList();
      switchFamilySubview('subviewSendReminder');
      $('vcAccountCreateView')?.classList.add('hidden');
      $('vcOtpVerifyView')?.classList.add('hidden');
      $('remindFamilyHubView')?.classList.remove('hidden');
      startFamilyRealtimeSync();
    } else {
      $('remindFamilyHubView')?.classList.add('hidden');
      $('vcAccountCreateView')?.classList.remove('hidden');
      updateAuthVisibility();
    }
  });

  $('settingNotificationsBtn')?.addEventListener('click', () => {
    // Mark notifications as read
    notificationsList.forEach(n => { n.unread = false; });
    saveNotifications();
    renderNotifications();
    $('notificationsView')?.classList.remove('hidden');
  });

  $('btnHubNotifications')?.addEventListener('click', () => {
    notificationsList.forEach(n => { n.unread = false; });
    saveNotifications();
    renderNotifications();
    $('notificationsView')?.classList.remove('hidden');
  });

  $('closeNotificationsBtn')?.addEventListener('click', () => {
    $('notificationsView')?.classList.add('hidden');
  });

  $('clearAllNotifsBtn')?.addEventListener('click', () => {
    const isHi = userSettings.appLanguage === 'hi';
    if (confirm(isHi ? 'क्या आप सभी सूचनाएं हटाना चाहते हैं?' : 'Clear all notifications?')) {
      notificationsList = [];
      saveNotifications();
      renderNotifications();
      showPopup(isHi ? 'सभी सूचनाएं हटा दी गईं' : 'Notifications cleared');
    }
  });

  $('closeVcCreateBtn')?.addEventListener('click', () => {
    $('vcAccountCreateView')?.classList.add('hidden');
  });

  $('closeVcOtpBtn')?.addEventListener('click', () => {
    $('vcOtpVerifyView')?.classList.add('hidden');
  });

  $('closeFamilyHubBtn')?.addEventListener('click', () => {
    $('remindFamilyHubView')?.classList.add('hidden');
    $('remindFamilySidebar')?.classList.add('hidden');
    $('familySidebarOverlay')?.classList.add('hidden');
  });

  $('btnToggleFamilySidebar')?.addEventListener('click', () => {
    const sb = $('remindFamilySidebar');
    const ov = $('familySidebarOverlay');
    if (sb) sb.classList.toggle('hidden');
    if (ov) ov.classList.toggle('hidden');
  });

  $('familySidebarOverlay')?.addEventListener('click', () => {
    $('remindFamilySidebar')?.classList.add('hidden');
    $('familySidebarOverlay')?.classList.add('hidden');
  });

  // Sidebar Nav Items
  $('navSendReminderBtn')?.addEventListener('click', () => switchFamilySubview('subviewSendReminder'));
  $('navSentRemindersBtn')?.addEventListener('click', () => switchFamilySubview('subviewSentReminders'));
  $('navReceivedRemindersBtn')?.addEventListener('click', () => switchFamilySubview('subviewReceivedReminders'));
  $('navTrustedVcBtn')?.addEventListener('click', () => switchFamilySubview('subviewTrustedVc'));
  $('navMyAccountBtn')?.addEventListener('click', () => switchFamilySubview('subviewMyAccount'));
  $('navNotificationsBtn')?.addEventListener('click', () => {
    $('remindFamilySidebar')?.classList.add('hidden');
    $('familySidebarOverlay')?.classList.add('hidden');
    notificationsList.forEach(n => { n.unread = false; });
    saveNotifications();
    renderNotifications();
    $('notificationsView')?.classList.remove('hidden');
  });

  // Trusted VC IDs Form Handlers
  $('btnAddTrustedVc')?.addEventListener('click', () => {
    const isHi = userSettings.appLanguage === 'hi';
    const idInput = $('trustedVcIdInput');
    const nameInput = $('trustedVcNameInput');
    let rawId = (idInput?.value || '').trim().toUpperCase();
    const rawName = (nameInput?.value || '').trim();

    if (!rawId) {
      showPopup(isHi ? 'कृपया मान्य VC ID दर्ज करें' : 'Please enter a valid VC ID');
      if (idInput) idInput.focus();
      return;
    }

    if (vcAccount && rawId === vcAccount.vcId.trim().toUpperCase()) {
      showPopup(isHi ? 'आप अपनी स्वयं की VC ID नहीं जोड़ सकते' : 'You cannot add your own VC ID as a trusted contact');
      return;
    }

    if (trustedVcIds.some(t => (t.vcId || '').trim().toUpperCase() === rawId)) {
      showPopup(isHi ? 'यह VC ID पहले से आपकी विश्वसनीय सूची में है' : 'This VC ID is already in your trusted list');
      return;
    }

    const newTrusted = {
      id: 'TID' + Date.now(),
      vcId: rawId,
      name: rawName || (isHi ? 'विश्वसनीय संपर्क' : 'Trusted Contact'),
      addedAt: Date.now()
    };

    trustedVcIds.push(newTrusted);
    saveTrustedVcIds();

    if (idInput) idInput.value = '';
    if (nameInput) nameInput.value = '';

    showPopup(isHi ? `✓ ${newTrusted.name} को विश्वसनीय सूची में जोड़ा गया!` : `✓ Added ${newTrusted.name} to Trusted VC IDs!`);
  });

  $('btnPasteTrustedVcId')?.addEventListener('click', async () => {
    const isHi = userSettings.appLanguage === 'hi';
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && $('trustedVcIdInput')) {
          $('trustedVcIdInput').value = text.trim();
          showPopup(isHi ? 'क्लिपबोर्ड से चिपकाया गया' : 'Pasted from clipboard');
        }
      }
    } catch (_) {}
  });

  // -------------------- REAL EMAIL SERVICE (BREVO) & VERIFICATION --------------------
  window._brevoCallbacks = window._brevoCallbacks || {};
  window.onBrevoEmailResult = function(callbackId, success, resultMessage) {
    if (window._brevoCallbacks && typeof window._brevoCallbacks[callbackId] === 'function') {
      window._brevoCallbacks[callbackId](success, resultMessage);
    }
  };

  function getEmailServiceConfig() {
    let apiKey = localStorage.getItem('vc_brevo_api_key') || '';
    let senderEmail = localStorage.getItem('vc_brevo_sender_email') || '';
    let senderName = localStorage.getItem('vc_brevo_sender_name') || '';

    if (!apiKey && window.AndroidVoice && window.AndroidVoice.getBrevoApiKeyNative) {
      try {
        apiKey = window.AndroidVoice.getBrevoApiKeyNative() || '';
        if (apiKey) localStorage.setItem('vc_brevo_api_key', apiKey);
      } catch (e) {}
    }
    if (!senderEmail && window.AndroidVoice && window.AndroidVoice.getBrevoSenderEmailNative) {
      try {
        senderEmail = window.AndroidVoice.getBrevoSenderEmailNative() || '';
        if (senderEmail) localStorage.setItem('vc_brevo_sender_email', senderEmail);
      } catch (e) {}
    }
    if (!senderName && window.AndroidVoice && window.AndroidVoice.getBrevoSenderNameNative) {
      try {
        senderName = window.AndroidVoice.getBrevoSenderNameNative() || '';
        if (senderName) localStorage.setItem('vc_brevo_sender_name', senderName);
      } catch (e) {}
    }

    return {
      apiKey: apiKey || '',
      senderEmail: senderEmail || 'myadminss.businessss@gmail.com',
      senderName: senderName || 'SevasSetus'
    };
  }

  function saveEmailServiceConfig(apiKey, senderEmail, senderName) {
    const finalKey = apiKey ? apiKey.trim() : '';
    const finalEmail = senderEmail ? senderEmail.trim() : 'myadminss.businessss@gmail.com';
    const finalName = senderName ? senderName.trim() : 'SevasSetus';

    if (finalKey) localStorage.setItem('vc_brevo_api_key', finalKey);
    else localStorage.removeItem('vc_brevo_api_key');

    localStorage.setItem('vc_brevo_sender_email', finalEmail);
    localStorage.setItem('vc_brevo_sender_name', finalName);

    if (window.AndroidVoice && window.AndroidVoice.saveBrevoConfigNative) {
      try {
        window.AndroidVoice.saveBrevoConfigNative(finalKey, finalEmail, finalName);
      } catch (e) {}
    }

    updateEmailConfigBadge();
  }

  function updateEmailConfigBadge() {
    const config = getEmailServiceConfig();
    const configBtn = $('settingEmailConfigBtn');
    const openBtn = $('btnOpenEmailConfig');
    const openBtnRow = openBtn ? openBtn.closest('.family-auth-toggle-row') : null;

    if (config.apiKey && config.apiKey.trim()) {
      // Configuration has been filled: remove from Settings and registration screen forever!
      // This protects the API key and verified email so nobody else can see or modify it.
      if (configBtn) configBtn.style.setProperty('display', 'none', 'important');
      if (openBtnRow) openBtnRow.style.setProperty('display', 'none', 'important');
      else if (openBtn) openBtn.style.setProperty('display', 'none', 'important');
    } else {
      // Unconfigured: show in Settings so the owner can fill it once
      if (configBtn) configBtn.style.display = '';
      if (openBtnRow) openBtnRow.style.display = '';
      else if (openBtn) openBtn.style.display = '';

      const badge = $('settingsEmailConfigBadge');
      if (badge) {
        const isHi = userSettings.appLanguage === 'hi';
        badge.textContent = isHi ? 'सेटअप' : 'Setup';
        badge.style.background = 'rgba(234, 179, 8, 0.2)';
        badge.style.color = '#facc15';
      }
    }
  }

  function openEmailConfigModal() {
    const config = getEmailServiceConfig();
    const keyInput = $('brevoApiKeyInput');
    const senderEmailInput = $('brevoSenderEmailInput');
    const senderNameInput = $('brevoSenderNameInput');
    const statusMsg = $('emailConfigStatusMsg');

    if (keyInput) keyInput.value = config.apiKey;
    if (senderEmailInput) senderEmailInput.value = config.senderEmail;
    if (senderNameInput) senderNameInput.value = config.senderName;
    if (statusMsg) {
      statusMsg.classList.add('hidden');
      statusMsg.textContent = '';
      statusMsg.className = 'email-config-status-msg hidden';
    }

    $('emailConfigModal')?.classList.remove('hidden');
  }

  function closeEmailConfigModal() {
    $('emailConfigModal')?.classList.add('hidden');
  }

  $('btnOpenEmailConfig')?.addEventListener('click', openEmailConfigModal);
  $('settingEmailConfigBtn')?.addEventListener('click', openEmailConfigModal);
  $('btnCloseEmailConfig')?.addEventListener('click', closeEmailConfigModal);
  $('emailConfigModal')?.addEventListener('click', (e) => {
    if (e.target === $('emailConfigModal')) closeEmailConfigModal();
  });

  // Secret admin unlock: tapping the creator's name "Ayush Kumar Singh" 5 times quickly
  // Strictly attached to the owner's name, preventing any accidental activation from "About Voice Clock".
  let ownerTapCount = 0;
  let ownerTapTimer = null;

  document.addEventListener('click', (e) => {
    const ownerTarget = e.target.closest('.owner-secret-tap');
    if (!ownerTarget) return;

    ownerTapCount++;
    if (ownerTapTimer) clearTimeout(ownerTapTimer);
    ownerTapTimer = setTimeout(() => { ownerTapCount = 0; }, 2500);

    if (ownerTapCount >= 5) {
      ownerTapCount = 0;
      if (ownerTapTimer) clearTimeout(ownerTapTimer);
      if (window.AndroidInterface && typeof window.AndroidInterface.vibrate === 'function') {
        try { window.AndroidInterface.vibrate(60); } catch (_) {}
      }
      openEmailConfigModal();
    }
  });

  $('btnSaveEmailConfig')?.addEventListener('click', () => {
    const isHi = userSettings.appLanguage === 'hi';
    const apiKey = $('brevoApiKeyInput')?.value.trim();
    const senderEmail = $('brevoSenderEmailInput')?.value.trim();
    const senderName = $('brevoSenderNameInput')?.value.trim() || 'SevasSetus';
    const statusMsg = $('emailConfigStatusMsg');

    if (apiKey && !senderEmail) {
      if (statusMsg) {
        statusMsg.textContent = isHi ? 'कृपया Brevo में सत्यापित प्रेषक ईमेल भी दर्ज करें' : 'Please also enter your verified sender email in Brevo';
        statusMsg.className = 'email-config-status-msg error';
        statusMsg.classList.remove('hidden');
      }
      return;
    }

    saveEmailServiceConfig(apiKey, senderEmail, senderName);

    if (statusMsg) {
      statusMsg.textContent = isHi ? '✓ ईमेल सेटिंग्स सुरक्षित रूप से सहेजी गईं और सेटिंग्स से हटा दी गईं!' : '✓ Email settings saved permanently & locked from view!';
      statusMsg.className = 'email-config-status-msg success';
      statusMsg.classList.remove('hidden');
    }

    showPopup(isHi ? 'ईमेल सेटिंग्स सुरक्षित रूप से सहेजी गईं' : 'Email settings saved & locked');
    setTimeout(() => {
      closeEmailConfigModal();
      updateEmailConfigBadge();
    }, 700);
  });

  function sendOtpEmail(toEmail, toName, otpCode) {
    return new Promise((resolve, reject) => {
      const config = getEmailServiceConfig();
      if (!config.apiKey || !config.apiKey.trim()) {
        return reject(new Error('Brevo API key is not configured. Please tap "Email Service Settings" to add your API key.'));
      }
      if (!config.senderEmail || !config.senderEmail.trim()) {
        return reject(new Error('Brevo Sender Email is not configured. Please enter the sender email verified in your Brevo account.'));
      }

      const senderEmail = config.senderEmail.trim();
      const senderName = config.senderName ? config.senderName.trim() : 'Voice Clock';
      const subject = `Your Voice Clock Verification Code: ${otpCode}`;

      const safeName = (toName || 'User').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Voice Clock Verification Code</title>
</head>
<body style="margin:0;padding:24px 12px;background-color:#0b0f19;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e2e8f0;">
  <div style="max-width:480px;margin:0 auto;background:#131d2e;border:1px solid #1e293b;border-radius:18px;overflow:hidden;box-shadow:0 10px 25px rgba(0,0,0,0.5);">
    <div style="background:linear-gradient(135deg, #0284c7, #38bdf8);padding:24px;text-align:center;">
      <div style="font-size:36px;margin-bottom:6px;">⏰</div>
      <h1 style="margin:0;font-size:22px;color:#ffffff;font-weight:800;letter-spacing:0.5px;">Voice Clock</h1>
      <p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">Account Verification Protocol</p>
    </div>
    <div style="padding:28px 24px;text-align:center;">
      <h2 style="margin:0 0 12px;font-size:18px;color:#ffffff;font-weight:700;">Hello ${safeName},</h2>
      <p style="margin:0 0 20px;font-size:14px;color:#94a3b8;line-height:1.6;">
        Welcome to Voice Clock! To verify your email address (<strong>${toEmail}</strong>) and securely link your account, enter the 8-digit verification code below:
      </p>
      <div style="background:#070d19;border:2px solid #0284c7;border-radius:14px;padding:16px 20px;display:inline-block;margin:6px 0 22px;">
        <span style="font-family:'Courier New',Courier,monospace;font-size:32px;font-weight:800;letter-spacing:8px;color:#38bdf8;">${otpCode}</span>
      </div>
      <p style="margin:0 0 16px;font-size:12px;color:#64748b;line-height:1.5;">
        ⏱️ This verification code is valid for <strong>10 minutes</strong>.<br>
        If you did not request this verification, you can safely ignore this email.
      </p>
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #1e293b;font-size:11px;color:#475569;line-height:1.4;">
        Voice Clock • On-Device Voice &amp; Family Care Assistant<br>
        Created by Ayush Kumar Singh (2026)
      </div>
    </div>
  </div>
</body>
</html>`;

      const callbackId = 'brevo_cb_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

      const timeoutId = setTimeout(() => {
        delete window._brevoCallbacks[callbackId];
        reject(new Error('Email request timed out. Please check your internet connection and try again.'));
      }, 25000);

      window._brevoCallbacks[callbackId] = (success, resultMsg) => {
        clearTimeout(timeoutId);
        delete window._brevoCallbacks[callbackId];
        if (success) {
          resolve(resultMsg);
        } else {
          let errText = resultMsg || 'Failed to send email.';
          try {
            const parsed = JSON.parse(resultMsg);
            if (parsed.message) errText = parsed.message;
          } catch (_) {}
          reject(new Error(errText));
        }
      };

      if (window.AndroidVoice && typeof window.AndroidVoice.sendBrevoEmail === 'function') {
        window.AndroidVoice.sendBrevoEmail(
          config.apiKey.trim(),
          senderEmail,
          senderName,
          toEmail.trim(),
          toName ? toName.trim() : '',
          subject,
          htmlContent,
          callbackId
        );
      } else {
        // Direct browser fallback fetch
        fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'api-key': config.apiKey.trim(),
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            sender: { name: senderName, email: senderEmail },
            to: [{ email: toEmail.trim(), name: toName ? toName.trim() : '' }],
            subject: subject,
            htmlContent: htmlContent
          })
        })
        .then(async res => {
          const text = await res.text();
          if (res.ok) {
            clearTimeout(timeoutId);
            delete window._brevoCallbacks[callbackId];
            resolve(text);
          } else {
            clearTimeout(timeoutId);
            delete window._brevoCallbacks[callbackId];
            let errorMsg = `HTTP ${res.status}: ${text}`;
            try {
              const errJson = JSON.parse(text);
              if (errJson.message) errorMsg = errJson.message;
            } catch (_) {}
            reject(new Error(errorMsg));
          }
        })
        .catch(err => {
          clearTimeout(timeoutId);
          delete window._brevoCallbacks[callbackId];
          reject(err);
        });
      }
    });
  }

  // Account Creation & Verification
  $('btnCreateVcAccount')?.addEventListener('click', async () => {
    const isHi = userSettings.appLanguage === 'hi';
    const nameVal = $('vcInputName')?.value.trim();
    const emailVal = $('vcInputEmail')?.value.trim();

    if (!nameVal) {
      showPopup(isHi ? 'कृपया अपना नाम दर्ज करें' : 'Please enter your name', 'deleted');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailVal || !emailRegex.test(emailVal)) {
      showPopup(isHi ? 'कृपया एक मान्य ईमेल पता दर्ज करें' : 'Please enter a valid email address', 'deleted');
      return;
    }

    const emailConfig = getEmailServiceConfig();
    if (!emailConfig.apiKey || !emailConfig.senderEmail) {
      showPopup(isHi ? 'ईमेल सेवा अभी सेट नहीं है। कृपया व्यवस्थापक से संपर्क करें।' : 'Email service is not configured.', 'deleted');
      return;
    }

    const createBtn = $('btnCreateVcAccount');
    const createBtnText = $('btnCreateVcAccountText');
    const originalText = createBtnText ? createBtnText.textContent : 'Create Account & Send OTP';

    if (createBtn) createBtn.disabled = true;
    if (createBtnText) {
      createBtnText.innerHTML = `<span class="spinner-inline"></span> ${isHi ? 'OTP भेजा जा रहा है...' : 'Sending real OTP...'}`;
    }

    const uniqueId = generateCryptographicVcId();
    const otp = generate8DigitOtp();

    try {
      await sendOtpEmail(emailVal, nameVal, otp);

      pendingVcAccount = {
        name: nameVal,
        email: emailVal,
        vcId: uniqueId,
        otp: otp,
        createdAt: Date.now(),
        expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes valid
      };

      const emailDisp = $('vcOtpEmailDisplay');
      if (emailDisp) {
        emailDisp.textContent = isHi
          ? `8-अंकीय सत्यापन कोड वास्तविक रूप से ${emailVal} पर भेज दिया गया है।`
          : `8-digit verification code has been sent to ${emailVal}.`;
      }

      const otpInput = $('vcInputOtp');
      if (otpInput) otpInput.value = '';

      startOtpResendTimer();

      $('vcAccountCreateView')?.classList.add('hidden');
      $('vcOtpVerifyView')?.classList.remove('hidden');
      showPopup(isHi ? `✓ OTP कोड ${emailVal} पर भेजा गया!` : `✓ OTP code sent to ${emailVal}!`);
    } catch (err) {
      console.error('Email dispatch error:', err);
      const errMsg = isHi
        ? `ईमेल भेजने में विफल: ${err.message}`
        : `Failed to send verification email: ${err.message}`;
      showPopup(errMsg, 'deleted');
    } finally {
      if (createBtn) createBtn.disabled = false;
      if (createBtnText) createBtnText.textContent = originalText;
    }
  });

  $('btnResendVcOtp')?.addEventListener('click', async () => {
    if (otpResendCountdown > 0) return;
    const isHi = userSettings.appLanguage === 'hi';
    if (!pendingVcAccount) return;

    const resendBtn = $('btnResendVcOtp');
    const resendBtnText = $('btnResendVcOtpText');
    const originalText = resendBtnText ? resendBtnText.textContent : 'Resend OTP';

    if (resendBtn) resendBtn.disabled = true;
    if (resendBtnText) {
      resendBtnText.innerHTML = `<span class="spinner-inline"></span> ${isHi ? 'भेजा जा रहा है...' : 'Sending...'}`;
    }

    const newOtp = generate8DigitOtp();

    try {
      await sendOtpEmail(pendingVcAccount.email, pendingVcAccount.name, newOtp);
      pendingVcAccount.otp = newOtp;
      pendingVcAccount.expiresAt = Date.now() + 10 * 60 * 1000;
      startOtpResendTimer();
      showPopup(isHi ? `✓ नया OTP कोड ${pendingVcAccount.email} पर भेजा गया!` : `✓ New OTP code sent to ${pendingVcAccount.email}!`);
    } catch (err) {
      console.error('Resend email error:', err);
      showPopup(isHi ? `OTP पुनः भेजने में त्रुटि: ${err.message}` : `Error resending OTP: ${err.message}`, 'deleted');
      if (resendBtn) resendBtn.disabled = false;
    } finally {
      if (resendBtnText) resendBtnText.textContent = originalText;
    }
  });

  $('btnVerifyVcOtp')?.addEventListener('click', () => {
    const isHi = userSettings.appLanguage === 'hi';
    const enteredOtp = $('vcInputOtp')?.value.trim();

    if (!enteredOtp || enteredOtp.length !== 8) {
      showPopup(isHi ? 'कृपया 8-अंकीय OTP कोड दर्ज करें' : 'Please enter the 8-digit OTP code', 'deleted');
      return;
    }

    if (!pendingVcAccount) {
      showPopup(isHi ? 'कोई लंबित पंजीकरण नहीं मिला। कृपया पुनः खाता बनाएं।' : 'No pending registration found. Please register again.', 'deleted');
      return;
    }

    if (pendingVcAccount.expiresAt && Date.now() > pendingVcAccount.expiresAt) {
      showPopup(isHi ? 'OTP की समय सीमा (10 मिनट) समाप्त हो चुकी है। कृपया "दोबारा OTP भेजें" पर टैप करें।' : 'The OTP has expired (10-minute limit). Please click "Resend OTP" to receive a new code.', 'deleted');
      return;
    }

    if (enteredOtp !== pendingVcAccount.otp) {
      showPopup(isHi ? 'अमान्य OTP कोड। कृपया अपने ईमेल में आया 8-अंकीय कोड ही दर्ज करें।' : 'Invalid OTP code. Please enter the exact 8-digit code received in your email.', 'deleted');
      return;
    }

    // Activated!
    vcAccount = {
      name: pendingVcAccount.name,
      email: pendingVcAccount.email,
      vcId: pendingVcAccount.vcId,
      verified: true,
      createdAt: Date.now()
    };
    saveVcAccount();
    pendingVcAccount = null;

    notificationsList.unshift({
      id: 'NOTIF' + Date.now(),
      type: 'system',
      title: isHi ? 'वॉयस क्लॉक फैमिली में स्वागत है!' : 'Welcome to Voice Clock Family!',
      message: isHi
        ? `आपका ईमेल सफलतापूर्वक सत्यापित हो गया है! आपकी यूनिक VC ID है: ${vcAccount.vcId}। इसे परिजनों के साथ साझा करें।`
        : `Your email has been successfully verified! Your unique VC ID is: ${vcAccount.vcId}. Share with loved ones to connect.`,
      time: Date.now(),
      unread: true
    });
    saveNotifications();

    $('vcOtpVerifyView')?.classList.add('hidden');
    populateAccountDisplay();
    renderRecentVcIds();
    renderSentReminders();
    renderReceivedReminders();
    switchFamilySubview('subviewSendReminder');
    $('remindFamilyHubView')?.classList.remove('hidden');
    startFamilyRealtimeSync();

    showPopup(isHi ? '✓ VC खाता सफलतापूर्वक सत्यापित हुआ!' : '✓ VC Account verified successfully!');
  });

  $('linkLoginVcAccount')?.addEventListener('click', () => {
    $('vcCreateFormSection')?.classList.add('hidden');
    $('vcLoginFormSection')?.classList.remove('hidden');
    const headerTitle = $('vcCreateTitle');
    if (headerTitle) {
      headerTitle.textContent = userSettings.appLanguage === 'hi' ? 'VC खाते में लॉग इन करें' : 'Log In to VC Account';
    }
  });

  $('linkBackToCreateAccount')?.addEventListener('click', () => {
    $('vcLoginFormSection')?.classList.add('hidden');
    $('vcCreateFormSection')?.classList.remove('hidden');
    const headerTitle = $('vcCreateTitle');
    if (headerTitle) {
      headerTitle.textContent = userSettings.appLanguage === 'hi' ? 'VC खाता बनाएं' : 'Create VC Account';
    }
  });

  $('btnSubmitVcLogin')?.addEventListener('click', () => {
    const isHi = userSettings.appLanguage === 'hi';
    const idInput = $('vcLoginVcIdInput');
    const nameInput = $('vcLoginNameInput');
    const rawId = idInput ? idInput.value.trim().toUpperCase() : '';
    const rawName = nameInput ? nameInput.value.trim() : '';

    if (!rawId) {
      showPopup(isHi ? 'कृपया अपनी VC ID दर्ज करें' : 'Please enter your VC ID', 'deleted');
      return;
    }
    if (!rawId.startsWith('VC-') || rawId.length < 10) {
      showPopup(isHi ? 'अमान्य VC ID प्रारूप। VC ID "VC-" से शुरू होनी चाहिए।' : 'Invalid VC ID format. Must start with "VC-"', 'deleted');
      return;
    }

    vcAccount = {
      name: rawName || 'User',
      email: 'restored@voiceclock.local',
      vcId: rawId,
      verified: true,
      createdAt: Date.now()
    };
    saveVcAccount();
    populateAccountDisplay();
    $('vcAccountCreateView')?.classList.add('hidden');
    switchFamilySubview('subviewSendReminder');
    $('remindFamilyHubView')?.classList.remove('hidden');
    startFamilyRealtimeSync();
    showPopup(isHi ? '✓ खाता सफलतापूर्वक लॉग इन हुआ!' : '✓ Account successfully logged in!');
  });

  $('btnCopyAccountVcId')?.addEventListener('click', () => {
    if (!vcAccount || !vcAccount.vcId) return;
    copyVcIdToClipboard(vcAccount.vcId);
  });

  $('btnCopySidebarVcId')?.addEventListener('click', () => {
    if (!vcAccount || !vcAccount.vcId) return;
    copyVcIdToClipboard(vcAccount.vcId);
  });

  function copyVcIdToClipboard(text) {
    const isHi = userSettings.appLanguage === 'hi';
    if (window.AndroidVoice && window.AndroidVoice.copyToClipboard) {
      window.AndroidVoice.copyToClipboard(text);
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    }
    showPopup(isHi ? `✓ VC ID कॉपी किया: ${text}` : `✓ Copied VC ID: ${text}`);
  }

  $('btnShareAccountVcId')?.addEventListener('click', () => {
    if (!vcAccount || !vcAccount.vcId) return;
    const isHi = userSettings.appLanguage === 'hi';
    const title = isHi ? 'वॉयस क्लॉक पर मुझसे जुड़ें' : 'Connect with me on Voice Clock';
    const text = isHi
      ? `नमस्ते! मेरी वॉयस क्लॉक आईडी है: ${vcAccount.vcId}। मुझे देखभाल भरे रिमाइंडर भेजने के लिए ऐप में इस आईडी का उपयोग करें!`
      : `Hello! My Voice Clock ID is: ${vcAccount.vcId}. Use this ID in the app to send me caring reminders!`;

    if (window.AndroidVoice && window.AndroidVoice.shareText) {
      window.AndroidVoice.shareText(title, text);
    } else if (navigator.share) {
      navigator.share({ title, text }).catch(() => {});
    } else {
      copyVcIdToClipboard(vcAccount.vcId);
    }
  });

  $('btnEditAccountName')?.addEventListener('click', () => {
    if (!vcAccount) return;
    const isHi = userSettings.appLanguage === 'hi';
    const newName = prompt(isHi ? 'नया नाम दर्ज करें:' : 'Enter new display name:', vcAccount.name);
    if (newName && newName.trim()) {
      vcAccount.name = newName.trim();
      saveVcAccount();
      populateAccountDisplay();
      showPopup(isHi ? 'नाम अपडेट किया गया' : 'Name updated');
    }
  });

  $('btnLogoutAccount')?.addEventListener('click', () => {
    const isHi = userSettings.appLanguage === 'hi';
    if (confirm(isHi ? 'क्या आप खाता लॉग आउट करना चाहते हैं?' : 'Are you sure you want to log out of your account?')) {
      vcAccount = null;
      saveVcAccount();
      if (familySyncEventSource) {
        try { familySyncEventSource.close(); } catch {}
        familySyncEventSource = null;
      }
      $('remindFamilyHubView')?.classList.add('hidden');
      $('vcAccountCreateView')?.classList.remove('hidden');
      $('vcCreateFormSection')?.classList.remove('hidden');
      $('vcLoginFormSection')?.classList.add('hidden');
      const headerTitle = $('vcCreateTitle');
      if (headerTitle) {
        headerTitle.textContent = isHi ? 'VC खाता बनाएं' : 'Create VC Account';
      }
      showPopup(isHi ? 'खाता लॉग आउट हो गया' : 'Logged out successfully');
    }
  });

  $('btnPasteVcId')?.addEventListener('click', () => {
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(text => {
        if (text) {
          const inp = $('targetVcIdInput');
          if (inp) inp.value = text.trim().toUpperCase();
        }
      }).catch(() => {
        showPopup(userSettings.appLanguage === 'hi' ? 'क्लिपबोर्ड से पेस्ट नहीं कर सके' : 'Could not paste from clipboard');
      });
    }
  });

  // Quick caring chips
  document.querySelectorAll('.quick-reminder-chips .quick-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const text = chip.getAttribute('data-text');
      const input = $('reminderTitleInput');
      if (input && text) {
        input.value = text;
        input.focus();
      }
    });
  });

  // Toggle custom repetition box for family reminder
  const familyRepeatSelect = $('familyRepeatSelect');
  const familyCustomBox = $('familyCustomIntervalBox');
  familyRepeatSelect?.addEventListener('change', () => {
    if (familyCustomBox) {
      familyCustomBox.style.display = familyRepeatSelect.value === 'custom' ? 'block' : 'none';
    }
  });

  // Setup day pills for family reminder
  setupDayPillsRow('familyReminderDayPills');

  // Preview Voice in Family Reminder
  $('btnPreviewFamilyVoice')?.addEventListener('click', () => {
    const voiceSelect = $('familyVoiceSelect');
    const vId = voiceSelect ? voiceSelect.value : 'female_1';
    const isHi = userSettings.appLanguage === 'hi';
    speakVoicePreview(vId, isHi);
  });

  // Send Reminder Button
  $('btnSendFamilyReminder')?.addEventListener('click', sendFamilyReminder);

  // Initialize badges & realtime sync if user already logged in
  loadVcAccount();
  updateFamilySettingsBadge();
  updateEmailConfigBadge();
  updateNotificationBadges();
  updateReminderBadges();
  renderRecentVcIds();
  renderTrustedVcList();
  updateAuthVisibility();
  if (vcAccount && vcAccount.verified) {
    populateAccountDisplay();
    startFamilyRealtimeSync();
  }

  // Backup check when Android native bridge is ready
  setTimeout(() => {
    if (!vcAccount) {
      loadVcAccount();
      if (vcAccount && vcAccount.verified) {
        populateAccountDisplay();
        startFamilyRealtimeSync();
        updateFamilySettingsBadge();
        updateAuthVisibility();
      }
    }
  }, 350);

  // Pre-fill datetime picker to +1 hour from now
  const nowOneHour = new Date(Date.now() + 3600000);
  const nowIsoString = new Date(nowOneHour.getTime() - (nowOneHour.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
  const familyDtInp = $('reminderDateTimeInput');
  if (familyDtInp && !familyDtInp.value) {
    familyDtInp.value = nowIsoString;
  }

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
