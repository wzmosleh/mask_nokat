/*
 * Couche Android (Capacitor). Sur le web, window.Native.isNative vaut false et rien d'autre n'est utilisé.
 * Dans l'application Android, elle remplace ce que le navigateur ne fournit pas :
 *  - la reconnaissance vocale (service Android, phrase par phrase),
 *  - la voix de l'application,
 *  - l'enregistrement du fichier dans le téléphone et son partage (WhatsApp…).
 */
(function () {
  'use strict';
  const C = window.Capacitor;
  const isNative = !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
  const api = { isNative };
  window.Native = api;
  if (!isNative) return;
  const P = C.Plugins;

  api.speech = {
    async ensurePermission() {
      let s = await P.SpeechRecognition.checkPermissions();
      if (s.speechRecognition !== 'granted') s = await P.SpeechRecognition.requestPermissions();
      return s.speechRecognition === 'granted';
    },
    // écoute une phrase ; renvoie jusqu'à 5 transcriptions possibles (rejette si rien n'a été compris)
    async listenOnce(lang) {
      const r = await P.SpeechRecognition.start({ language: lang, maxResults: 5, partialResults: false, popup: false });
      return (r && r.matches) || [];
    },
    stop() { return P.SpeechRecognition.stop().catch(() => {}); },
  };

  api.speak = (text, lang) => P.TextToSpeech.speak({ text, lang, rate: 1.0 });

  // fichier enregistré dans Documents/Massar, visible depuis l'application « Fichiers »
  api.saveFile = async (name, base64) => {
    await P.Filesystem.writeFile({ path: 'Massar/' + name, data: base64, directory: 'DOCUMENTS', recursive: true });
    return 'Documents/Massar/' + name;
  };

  // partage du fichier lui-même (WhatsApp, e-mail…) par le menu de partage d'Android
  api.shareFile = async (name, base64, text) => {
    const w = await P.Filesystem.writeFile({ path: name, data: base64, directory: 'CACHE' });
    await P.Share.share({ title: name, text, files: [w.uri], dialogTitle: text });
  };

  api.onBack = (fn) => { if (P.App) P.App.addListener('backButton', fn); };
  api.exit = () => { if (P.App) P.App.exitApp(); };
})();
