import { sha256 } from '@bargu/crypto';

import { INVITE_CARD_HEIGHT, INVITE_CARD_WIDTH } from './invite-card.js';

/**
 * The page an invite link opens in a browser (docs/ADR/0009 Ek and Ek 2, 2026-10-22):
 * https://<host>/i#<token> and /g#<token>, and the earlier /i/<token> and /g/<token>. It does two
 * things: a messaging app that fetches it shows a card (Open Graph and Twitter tags), and a phone
 * without the app (or without the App Link) lands on something kind.
 *
 * It is built to give nothing away. The same bytes go out for every token, whether it exists,
 * works, has expired or was used: the page is made once from the host name and never from the
 * token, and nothing looks the token up. So it holds no name, photo, circle name, member count or
 * avatar, shows no invitation that may not exist, and does not even repeat the token. In a shared
 * link the token is in the fragment, which never reaches the server; the page has no script, so it
 * does not read the fragment either. It has no link at all: a button back to its own address would
 * lose the fragment (a browser drops it when it resolves an empty href), and carrying it on would take
 * a script. Instead it says what to do: with the app installed, tap the link again in the messaging
 * app, where Android opens it in the app (App Links).
 */

export type InviteLanguage = 'tr' | 'en';

/** Where the card image is served (invite-page.controller.ts). */
export const INVITE_CARD_PATH = '/invite/card.png';

interface Words {
  locale: string;
  title: string;
  description: string;
  lead: string;
  hint: string;
  soon: string;
  help: string;
  imageAlt: string;
}

const WORDS: Record<InviteLanguage, Words> = {
  tr: {
    locale: 'tr_TR',
    title: "Bargu'ya davet",
    description: 'Konumunu yalnızca seçtiğin kişilerle, uçtan uca şifreli paylaş.',
    lead: 'Bu bağlantı Bargu için. Bargu, konumunu yalnızca seçtiğin arkadaşların ve ailenle, uçtan uca şifreli paylaşmanı sağlar.',
    hint: 'Uygulama yüklüyse bağlantıya mesajlaşma uygulamasından yeniden dokun.',
    soon: "Bargu yakında Google Play'de.",
    help: 'Bağlantı çalışmıyorsa ya da süresi dolduysa, seni davet eden kişiden yeni bir bağlantı iste.',
    imageAlt: 'Bargu: beyaz bir konum işareti',
  },
  en: {
    locale: 'en_US',
    title: 'Invitation to Bargu',
    description: 'Share your location, end-to-end encrypted, only with the people you choose.',
    lead: 'This link is for Bargu. Bargu lets you share your location, end-to-end encrypted, only with the friends and family you choose.',
    hint: 'If the app is installed, tap the link again in your messaging app.',
    soon: 'Bargu is coming soon to Google Play.',
    help: 'If the link does not work or has expired, ask the person who invited you for a new one.',
    imageAlt: 'Bargu: a white location pin',
  },
};

/**
 * The page's one stylesheet, inline and allowed by its hash (no file to fetch, nothing from
 * anywhere else). Colours follow the account page's (apps/api/src/auth/web-page.ts), light and dark.
 */
const STYLE = `:root{color-scheme:light dark;--bg:#ffffff;--text:#16151c;--muted:#5e5c68;--primary:#5b34f2;--dot:#ff6a3d}
@media (prefers-color-scheme:dark){:root{--bg:#121118;--text:#f3f2f7;--muted:#a9a7b3;--primary:#8c72ff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:17px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:28rem;margin:0 auto;padding:3rem 1rem;display:grid;gap:1rem;justify-items:center;text-align:center}
.mark{width:5rem;height:5.7rem}
.pin{fill:var(--primary);fill-rule:evenodd}
.dot{fill:var(--dot)}
h1{font-size:1.6rem;margin:0}
p{margin:0;color:var(--muted)}
.hint{color:var(--text)}
.soon{color:var(--text);font-weight:600}
.help{font-size:.9rem}
`;

/** The location pin of the app icon (apps/mobile/scripts/build-icons.mjs), in a 0.7 x 0.8 box. */
const PIN =
  '<svg class="mark" viewBox="-0.35 -0.4 0.7 0.8" aria-hidden="true" focusable="false">' +
  '<path class="pin" d="M-0.2186 0.0585A0.27 0.27 0 1 1 0.2186 0.0585L0 0.36ZM0.11-0.1A0.11 0.11 0 1 0-0.11-0.1A0.11 0.11 0 1 0 0.11-0.1Z"/>' +
  '<circle class="dot" cx="0" cy="-0.1" r="0.065"/></svg>';

/**
 * Content-Security-Policy of the page: nothing may load or run except its own inline stylesheet,
 * by hash. No scripts, no fonts, no images, no frames, no forms, no <base>.
 */
export const INVITE_PAGE_CSP = [
  "default-src 'none'",
  `style-src 'sha256-${Buffer.from(sha256(new TextEncoder().encode(STYLE))).toString('base64')}'`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** The headers of the page, the same for every token and every language. */
export const INVITE_PAGE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': INVITE_PAGE_CSP,
  // Short: the page is the same for everyone, and the card should follow a changed host soon.
  'cache-control': 'public, max-age=300',
  // The words follow the browser's language, so caches keep one copy per language.
  vary: 'accept-language',
  // The address holds a secret: it never goes to another site in a Referer header.
  'referrer-policy': 'no-referrer',
  // Link previews still read the tags; search engines must not list invite links.
  'x-robots-tag': 'noindex, nofollow',
};

/** Escapes text for HTML text and double-quoted attribute values. */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** The page in one language; `host` is the invite host, for the card image's absolute address. */
export function renderInvitePage(language: InviteLanguage, host: string): string {
  const words = WORDS[language];
  const image = escapeHtml(`https://${host}${INVITE_CARD_PATH}`);
  const title = escapeHtml(words.title);
  const description = escapeHtml(words.description);
  const alt = escapeHtml(words.imageAlt);
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#5b34f2">
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Bargu">
<meta property="og:locale" content="${words.locale}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${image}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="${String(INVITE_CARD_WIDTH)}">
<meta property="og:image:height" content="${String(INVITE_CARD_HEIGHT)}">
<meta property="og:image:alt" content="${alt}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${image}">
<meta name="twitter:image:alt" content="${alt}">
<style>${STYLE}</style>
</head>
<body>
<main>
${PIN}
<h1>${title}</h1>
<p>${escapeHtml(words.lead)}</p>
<p class="hint">${escapeHtml(words.hint)}</p>
<p class="soon">${escapeHtml(words.soon)}</p>
<p class="help">${escapeHtml(words.help)}</p>
</main>
</body>
</html>
`;
}

/** Both languages, made once at start: a request only picks one. */
export function renderInvitePages(host: string): Record<InviteLanguage, string> {
  return { tr: renderInvitePage('tr', host), en: renderInvitePage('en', host) };
}

/** Longest Accept-Language read; anything longer is no browser's and gets the default. */
const MAX_ACCEPT_LANGUAGE = 256;

/**
 * Turkish or English from the browser's Accept-Language, by its preference order (q values);
 * Turkish when it names neither or says nothing (the app's first language).
 */
export function pickInviteLanguage(acceptLanguage: string | undefined): InviteLanguage {
  if (acceptLanguage === undefined || acceptLanguage.length > MAX_ACCEPT_LANGUAGE) return 'tr';
  const preferences = acceptLanguage.split(',').map((part, index) => {
    const [tag = '', ...parameters] = part.trim().split(';');
    const weight = parameters
      .map((parameter) => /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(parameter)?.[1])
      .find((value) => value !== undefined);
    const q = weight === undefined ? 1 : Number(weight);
    return { primary: tag.trim().toLowerCase().split('-')[0] ?? '', q, index };
  });
  const ranked = preferences
    .filter((preference) => Number.isFinite(preference.q) && preference.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { primary } of ranked) {
    if (primary === 'tr' || primary === 'en') return primary;
  }
  return 'tr';
}
