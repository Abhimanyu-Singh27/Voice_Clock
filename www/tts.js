// import { TextToSpeech } from '@capacitor-community/text-to-speech';

// window.nativeTTS = async function (text) {
//   try {
//     await TextToSpeech.speak({
//       text: text,
//       lang: 'en-US',
//       rate: 1.0,
//       pitch: 1.0,
//       volume: 1.0
//     });
//   } catch (e) {
//     console.log('TTS ERROR:', e);
//   }
// };
window.nativeTTS = async function (text) {

    // Browser mode
    if (!window.Capacitor) {

        const speech = new SpeechSynthesisUtterance(text);

        speech.lang = "en-US";
        speech.rate = 1;
        speech.pitch = 1;

        speechSynthesis.speak(speech);

        return;
    }

    // Android Capacitor mode
    try {

        const { TextToSpeech } =
            await import("@capacitor-community/text-to-speech");

        await TextToSpeech.speak({
            text,
            lang: "en-US",
            rate: 1,
            pitch: 1,
            volume: 1
        });

    } catch (e) {

        console.log(e);

    }

};