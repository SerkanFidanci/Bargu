import type { OutgoingEmail } from './mailer.js';

type Locale = 'tr' | 'en';

const COPY: Record<Locale, { subject: string; body: (code: string) => string }> = {
  tr: {
    subject: 'Bargu giriş kodun',
    body: (code) =>
      `Bargu giriş kodun: ${code}\n\n` +
      'Kod 10 dakika geçerli. Kodu kimseyle paylaşma; Bargu senden bu kodu asla istemez.\n' +
      'Girişi sen istemediysen bu e-postayı yok sayabilirsin.\n',
  },
  en: {
    subject: 'Your Bargu sign-in code',
    body: (code) =>
      `Your Bargu sign-in code: ${code}\n\n` +
      'The code is valid for 10 minutes. Never share it; Bargu will never ask you for it.\n' +
      "If you didn't try to sign in, you can ignore this email.\n",
  },
};

/** The code goes in the body only: lock-screen previews of the subject do not reveal it. */
export function otpEmail(to: string, locale: Locale, code: string): OutgoingEmail {
  const copy = COPY[locale];
  return { to, subject: copy.subject, text: copy.body(code) };
}

const WEB_COPY: Record<Locale, { subject: string; body: (code: string) => string }> = {
  tr: {
    subject: 'Bargu hesap sayfası kodun',
    body: (code) =>
      `Bargu hesap sayfası kodun: ${code}\n\n` +
      'Bu kod yalnızca hesap sayfası içindir: kaybolan telefonu hesabından çıkarmak için. ' +
      'Uygulamada geçmez. Kod 10 dakika geçerli; kimseyle paylaşma.\n' +
      'Sen istemediysen bu e-postayı yok sayabilirsin; telefonun hesabında kalır.\n',
  },
  en: {
    subject: 'Your Bargu account page code',
    body: (code) =>
      `Your Bargu account page code: ${code}\n\n` +
      'This code is for the account page only: to take a lost phone off your account. ' +
      'It does not work in the app. It is valid for 10 minutes; never share it.\n' +
      "If you didn't ask for it, ignore this email; your phone stays on your account.\n",
  },
};

const UNLOCK_COPY: Record<Locale, { subject: string; body: (link: string) => string }> = {
  tr: {
    subject: 'Bargu hesap sayfası: tarayıcını tanıt',
    body: (link) =>
      'Bugün Bargu hesap sayfasında bu adres için çok sayıda yerden kod istendi. Bu yüzden ' +
      'tanımadığımız tarayıcılara bir süre kod göndermiyoruz.\n\n' +
      'Hesap sayfasını kullanmak isteyen sensen bu bağlantıyı, sayfayı kullanacağın bilgisayarda ' +
      `aç. O tarayıcı tanınır, sonra kodunu isteyebilirsin:\n${link}\n\n` +
      'Bağlantı 24 saat geçerli ve bir kez çalışır. Tek başına hesabına giriş sağlamaz; kod yine ' +
      'bu adrese gelir. Kimseyle paylaşma.\n' +
      'Sen istemediysen bu e-postayı yok sayabilirsin; hesabın ve telefonun yerinde.\n',
  },
  en: {
    subject: 'Bargu account page: recognise your browser',
    body: (link) =>
      'Today the Bargu account page was asked for codes for this address from many places, so ' +
      'for a while we send no codes to browsers we do not know.\n\n' +
      'If you want to use the account page, open this link on the computer you will use it on. ' +
      `That browser is recognised, then you can ask for your code:\n${link}\n\n` +
      'The link is valid for 24 hours and works once. It does not sign you in by itself; the ' +
      'code still comes to this address. Never share it.\n' +
      "If you didn't ask for it, ignore this email; your account and phone are untouched.\n",
  },
};

/**
 * The account web page's "recognise this browser" link (QA 4 K2b): the secret after the "#", so
 * opening it sends it to no server log.
 */
export function webUnlockEmail(to: string, locale: Locale, link: string): OutgoingEmail {
  const copy = UNLOCK_COPY[locale];
  return { to, subject: copy.subject, text: copy.body(link) };
}

/** The account web page's code (docs/ADR/0021); like the login code, in the body only. */
export function webCodeEmail(to: string, locale: Locale, code: string): OutgoingEmail {
  const copy = WEB_COPY[locale];
  return { to, subject: copy.subject, text: copy.body(code) };
}
