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
