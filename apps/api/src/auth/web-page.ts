/**
 * The account web page (docs/ADR/0021), served by the API at /hesap: plain HTML, one script and
 * one stylesheet of its own, nothing from anywhere else. Its words follow the browser's language
 * (Turkish, else English). Text goes into the page as text only, never as markup.
 */

export const WEB_PAGE_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const WEB_PAGE_HTML = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>Bargu hesabı</title>
<link rel="stylesheet" href="/hesap/app.css">
</head>
<body>
<main>
  <h1 id="title">Bargu hesabı</h1>
  <p id="lead"></p>
  <form id="email-step">
    <label for="email" id="email-label"></label>
    <input id="email" type="email" autocomplete="email" required maxlength="254">
    <button type="submit" id="email-send"></button>
  </form>
  <form id="code-step" hidden>
    <p id="code-hint"></p>
    <label for="code" id="code-label"></label>
    <input id="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{8}"
      maxlength="8" required>
    <button type="submit" id="code-send"></button>
  </form>
  <section id="device-step" hidden>
    <p id="device-text"></p>
    <button type="button" id="revoke" class="danger"></button>
    <p id="delete-text"></p>
    <button type="button" id="delete" class="danger"></button>
  </section>
  <section id="done-step" hidden>
    <p id="done-text"></p>
  </section>
  <p id="status" role="status" aria-live="polite"></p>
  <p><a id="privacy" href="/gizlilik"></a></p>
</main>
<script src="/hesap/app.js"></script>
</body>
</html>
`;

export const WEB_PAGE_CSS = `:root {
  color-scheme: light dark;
  --bg: #ffffff; --text: #16151c; --muted: #5e5c68; --surface: #f5f4f1;
  --primary: #5b34f2; --on-primary: #ffffff; --danger: #c62f2f; --on-danger: #ffffff;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #121118; --text: #f3f2f7; --muted: #a9a7b3; --surface: #1f1d27;
    --primary: #8c72ff; --on-primary: #121118; --danger: #ff6b6b; --on-danger: #121118;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 17px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
main { max-width: 28rem; margin: 0 auto; padding: 2rem 1rem; display: grid; gap: 1rem; }
h1 { font-size: 1.6rem; margin: 0; }
p { margin: 0; color: var(--muted); }
form, section { display: grid; gap: 0.75rem; padding: 1.25rem; border-radius: 1.25rem;
  background: var(--surface); }
label { font-weight: 600; color: var(--text); }
input { font: inherit; padding: 0.75rem 1rem; border-radius: 0.75rem; border: 1px solid var(--muted);
  background: var(--bg); color: var(--text); }
#code { letter-spacing: 0.3em; font-size: 1.4rem; }
button { font: inherit; font-weight: 600; padding: 0.8rem 1rem; border: 0; border-radius: 999px;
  background: var(--primary); color: var(--on-primary); cursor: pointer; min-height: 48px; }
button.danger { background: var(--danger); color: var(--on-danger); }
button:disabled { opacity: 0.5; cursor: default; }
#status { min-height: 1.5em; color: var(--text); }
a { color: var(--primary); }
article { display: grid; gap: 0.5rem; }
article h2 { font-size: 1.15rem; margin: 1rem 0 0; color: var(--text); }
article p, article li { color: var(--text); }
article ul { margin: 0; padding-left: 1.25rem; }
[hidden] { display: none !important; }
`;

export const WEB_PAGE_JS = `'use strict';
(function () {
  var WORDS = {
    tr: {
      title: 'Bargu hesabı',
      lead: 'Telefonun kaybolduysa ya da çalındıysa onu buradan hesabından çıkarabilirsin. Çıkarılan telefon bir daha bağlandığında kendini kapatır ve içindeki anahtarları siler; çemberlerin yeni anahtara geçer.',
      emailLabel: 'E-posta adresin',
      emailSend: 'Kod gönder',
      codeHint: 'Hesabın varsa e-postana 8 haneli bir kod gönderdik. Kod 10 dakika geçerli.',
      codeLabel: 'Kod',
      codeSend: 'Devam',
      device: function (platform, since) {
        return 'Hesabında şu an bir ' + (platform === 'ios' ? 'iPhone' : 'Android telefon') +
          ' var (' + since + ' tarihinden beri).';
      },
      noDevice: 'Hesabında şu an giriş yapmış bir telefon yok.',
      revoke: 'Telefonumu hesaptan çıkar',
      deleteText: 'Ya da hesabını tamamen sil: çemberlerinden çıkarsın, telefonun kapanır, hesabın ve verilerin kalıcı olarak silinir. Geri alınamaz.',
      deleteButton: 'Hesabımı sil',
      deleteConfirm: 'Hesabın ve bütün verilerin kalıcı olarak silinsin mi? Bu geri alınamaz.',
      deleted: 'Hesabın silindi. Verilerin birkaç dakika içinde, en geç 7 günde tamamen kaldırılır.',
      privacy: 'Gizlilik politikası ve aydınlatma metni',
      confirm: 'Telefon hesabından çıkarılsın mı? Geri alınamaz; yeni bir telefonla yeniden giriş yapabilirsin.',
      done: 'Telefon hesabından çıkarıldı. Yeni telefonunda Bargu\\'ya e-postanla giriş yapabilirsin.',
      nothing: 'Çıkarılacak bir telefon yoktu.',
      wait: 'Bekle…',
      invalid: 'Kod yanlış. Yeniden dene.',
      expired: 'Kodun süresi doldu. Yeni kod iste.',
      locked: 'Çok fazla yanlış deneme oldu. Daha sonra yeniden dene.',
      limited: 'Çok fazla istek oldu. Biraz bekleyip yeniden dene.',
      addressLimited: 'Bugün çok fazla istek oldu. Adres seninse e-postana, bu tarayıcıyı tanıtan bir bağlantı gelmiş olabilir: onu bu bilgisayarda aç, sonra yeniden kod iste.',
      unlocked: 'Bu tarayıcı tanındı. Şimdi e-postanı yazıp kod isteyebilirsin.',
      unlockFailed: 'Bu bağlantı geçersiz ya da daha önce kullanılmış.',
      session: 'Oturumun süresi doldu. Baştan başla.',
      failed: 'Bir şeyler ters gitti. Bağlantını kontrol edip yeniden dene.'
    },
    en: {
      title: 'Bargu account',
      lead: 'If your phone is lost or stolen, take it off your account here. The phone shuts itself out and deletes its keys the next time it connects; your circles move to new keys.',
      emailLabel: 'Your email',
      emailSend: 'Send a code',
      codeHint: 'If you have an account, we sent an 8-digit code to your email. It is valid for 10 minutes.',
      codeLabel: 'Code',
      codeSend: 'Continue',
      device: function (platform, since) {
        return 'An ' + (platform === 'ios' ? 'iPhone' : 'Android phone') +
          ' is signed in to your account (since ' + since + ').';
      },
      noDevice: 'No phone is signed in to your account right now.',
      revoke: 'Take my phone off my account',
      deleteText: 'Or delete your account altogether: you leave your circles, your phone is signed out, and your account and data are deleted for good. This cannot be undone.',
      deleteButton: 'Delete my account',
      deleteConfirm: 'Delete your account and all your data for good? This cannot be undone.',
      deleted: 'Your account was deleted. Your data is removed completely within minutes, at most 7 days.',
      privacy: 'Privacy policy',
      confirm: 'Take the phone off your account? This cannot be undone; you can sign in again on a new phone.',
      done: 'The phone was taken off your account. Sign in to Bargu with your email on your new phone.',
      nothing: 'There was no phone to take off.',
      wait: 'Wait…',
      invalid: 'Wrong code. Try again.',
      expired: 'The code has expired. Ask for a new one.',
      locked: 'Too many wrong tries. Try again later.',
      limited: 'Too many requests. Wait a little and try again.',
      addressLimited: 'Too many requests today. If the address is yours, we may have emailed you a link that recognises this browser: open it on this computer, then ask for a code again.',
      unlocked: 'This browser is now recognised. Enter your email to get a code.',
      unlockFailed: 'This link is not valid or was already used.',
      session: 'Your session has expired. Start again.',
      failed: 'Something went wrong. Check your connection and try again.'
    }
  };
  var lang = (navigator.language || 'tr').toLowerCase().indexOf('tr') === 0 ? 'tr' : 'en';
  var w = WORDS[lang];
  document.documentElement.lang = lang;
  var $ = function (id) { return document.getElementById(id); };
  var text = function (id, value) { $(id).textContent = value; };

  document.title = w.title;
  text('title', w.title);
  text('lead', w.lead);
  text('email-label', w.emailLabel);
  text('email-send', w.emailSend);
  text('code-hint', w.codeHint);
  text('code-label', w.codeLabel);
  text('code-send', w.codeSend);
  text('revoke', w.revoke);
  text('delete-text', w.deleteText);
  text('delete', w.deleteButton);
  text('privacy', w.privacy);

  function base64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  }
  // The code works only with this page: a random value it keeps for this tab.
  function binding() {
    var held = sessionStorage.getItem('bargu-binding');
    if (held) return held;
    var made = base64url(crypto.getRandomValues(new Uint8Array(32)));
    sessionStorage.setItem('bargu-binding', made);
    return made;
  }

  // A browser that came in with a code is remembered: someone who only knows the address cannot
  // lock it out (it gives no access by itself).
  function remembered() {
    try {
      var held = localStorage.getItem('bargu-remember');
      return held && /^[A-Za-z0-9_-]{43}$/.test(held) ? held : undefined;
    } catch (error) {
      return undefined;
    }
  }
  function remember(value) {
    try {
      if (value) localStorage.setItem('bargu-remember', value);
    } catch (error) {
      // Not kept (private window): the page works the same.
    }
  }

  var state = { challengeId: null, token: null };

  function show(step) {
    ['email-step', 'code-step', 'device-step', 'done-step'].forEach(function (id) {
      $(id).hidden = id !== step;
    });
  }

  function explain(status, code) {
    if (code === 'OTP_INVALID') return w.invalid;
    if (code === 'OTP_EXPIRED') return w.expired;
    if (code === 'OTP_LOCKED') return w.locked;
    if (code === 'UNAUTHENTICATED') return w.session;
    if (status === 429) return w.limited;
    return w.failed;
  }

  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store'
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) {
          var error = new Error('request failed');
          error.message = explain(response.status, data && data.code);
          error.status = response.status;
          error.code = data && data.code;
          error.restart = data && (data.code === 'OTP_EXPIRED' || data.code === 'UNAUTHENTICATED');
          throw error;
        }
        return data;
      });
    });
  }

  function busy(button, on) {
    button.disabled = on;
    text('status', on ? w.wait : '');
  }

  function fail(button, error) {
    busy(button, false);
    text('status', error.message || w.failed);
    if (error.restart) { state.challengeId = null; state.token = null; show('email-step'); }
  }

  $('email-step').addEventListener('submit', function (event) {
    event.preventDefault();
    var button = $('email-send');
    busy(button, true);
    post('/v1/web/code', { email: $('email').value.trim(), locale: lang, binding: binding(), remember: remembered() })
      .then(function (data) {
        busy(button, false);
        state.challengeId = data.challengeId;
        show('code-step');
        $('code').focus();
      }, function (error) {
        if (error.status === 429) error.message = w.addressLimited;
        fail(button, error);
      });
  });

  // Opened from the "recognise this browser" email (QA 4 K2b): the secret is after the "#", so it
  // reaches no server log, and it leaves the address bar at once.
  var unlock = /^#unlock=([0-9a-f-]{36})\\.([A-Za-z0-9_-]{43})$/.exec(location.hash);
  if (unlock) {
    history.replaceState(null, '', location.pathname);
    text('status', w.wait);
    post('/v1/web/unlock', { id: unlock[1], token: unlock[2] }).then(function (data) {
      remember(data.remember);
      text('status', w.unlocked);
      $('email').focus();
    }, function (error) {
      text('status', error.code === 'OTP_INVALID' || error.code === 'OTP_EXPIRED'
        ? w.unlockFailed : error.message);
    });
  }

  $('code-step').addEventListener('submit', function (event) {
    event.preventDefault();
    var button = $('code-send');
    busy(button, true);
    post('/v1/web/verify', { challengeId: state.challengeId, code: $('code').value.trim(), binding: binding(), remember: remembered() })
      .then(function (data) {
        busy(button, false);
        state.token = data.token;
        remember(data.remember);
        if (data.device) {
          var since = new Date(data.device.since).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-GB');
          text('device-text', w.device(data.device.platform, since));
          $('revoke').hidden = false;
        } else {
          text('device-text', w.noDevice);
          $('revoke').hidden = true;
        }
        show('device-step');
      }, function (error) { fail(button, error); });
  });

  $('delete').addEventListener('click', function () {
    if (!window.confirm(w.deleteConfirm)) return;
    var button = $('delete');
    busy(button, true);
    post('/v1/web/delete-account', { token: state.token })
      .then(function () {
        busy(button, false);
        state.token = null;
        text('done-text', w.deleted);
        show('done-step');
      }, function (error) { fail(button, error); });
  });

  $('revoke').addEventListener('click', function () {
    if (!window.confirm(w.confirm)) return;
    var button = $('revoke');
    busy(button, true);
    post('/v1/web/revoke-device', { token: state.token })
      .then(function (data) {
        busy(button, false);
        state.token = null;
        text('done-text', data.revoked ? w.done : w.nothing);
        show('done-step');
      }, function (error) { fail(button, error); });
  });
})();
`;
