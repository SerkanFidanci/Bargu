import type { TestApp } from './app.js';

/**
 * Every row of every table (app and the job queue) and every Redis key and value, as text: what
 * must not mention an ended event or a deleted account any more.
 */
export async function dumpEverything(test: TestApp): Promise<string> {
  const parts: string[] = [];
  const { rows: tables } = await test.admin.query<{ name: string }>(
    `SELECT format('%I.%I', schemaname, tablename) AS name FROM pg_tables
      WHERE schemaname IN ('app', 'pgboss')`,
  );
  for (const { name } of tables) {
    const { rows } = await test.admin.query<{ dump: string | null }>(
      `SELECT json_agg(t)::text AS dump FROM ${name} t`,
    );
    parts.push(rows[0]?.dump ?? '');
  }
  const redis = (await import('redis')).createClient({ url: test.env.REDIS_URL });
  await redis.connect();
  try {
    for await (const keys of redis.scanIterator({ COUNT: 500 })) {
      for (const key of keys) {
        parts.push(key);
        const type = await redis.type(key);
        if (type === 'string') parts.push((await redis.get(key)) ?? '');
        if (type === 'hash') parts.push(JSON.stringify(await redis.hGetAll(key)));
        if (type === 'stream') parts.push(JSON.stringify(await redis.xRange(key, '-', '+')));
        if (type === 'list') parts.push(JSON.stringify(await redis.lRange(key, 0, -1)));
        if (type === 'set') parts.push(JSON.stringify(await redis.sMembers(key)));
        if (type === 'zset') parts.push(JSON.stringify(await redis.zRange(key, 0, -1)));
        if (type === 'zset') parts.push(JSON.stringify(await redis.zRange(key, 0, -1)));
      }
    }
  } finally {
    await redis.close();
  }
  return parts.join('\n');
}
