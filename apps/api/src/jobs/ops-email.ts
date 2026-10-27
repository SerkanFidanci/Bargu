import type { OpsEmailJob } from './email-jobs.js';
import type { OutgoingEmail } from './mailer.js';

/**
 * The operator's emails (docs/ADR/0035 §9, §10), in Turkish: what happened and an id, nothing that
 * was said or shown, no person, no address. Reports are read on the server.
 */
export function opsEmail(job: OpsEmailJob): OutgoingEmail {
  if (job.topic === 'report') {
    return {
      to: job.to,
      subject: 'Bargu: yeni bildirim',
      text: [
        'Yeni bildirim var.',
        `Neden: ${job.detail}`,
        `Kimlik: ${job.id}`,
        '',
        'İçerik bu e-postada yok; sunucuda okunur.',
      ].join('\n'),
    };
  }
  return {
    to: job.to,
    subject: 'Bargu: fotoğraf alanı dolmak üzere',
    text: [
      `Mesaj ve hikaye fotoğraflarına ayrılan alanın %${job.detail} kadarı dolu.`,
      'Dolunca yeni fotoğraf alınmaz, yazılar çalışmaya devam eder (MEDIA_MAX_BYTES).',
      `Kimlik: ${job.id}`,
    ].join('\n'),
  };
}
