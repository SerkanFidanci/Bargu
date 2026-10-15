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

/** The account web page's code (docs/ADR/0021); like the login code, in the body only. */
export function webCodeEmail(to: string, locale: Locale, code: string): OutgoingEmail {
  const copy = WEB_COPY[locale];
  return { to, subject: copy.subject, text: copy.body(code) };
}
