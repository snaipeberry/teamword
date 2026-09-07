/**
 * Migration UNE FOIS : importe les fichiers JSON existants
 * (server/data/{rooms,profiles,accounts}.json) dans Postgres.
 *
 * À lancer une seule fois, avant de considérer les fichiers JSON comme
 * obsolètes. Idempotent par construction (mêmes clés primaires que
 * `saveSnapshot` produirait) : le relancer par erreur ne duplique rien, au
 * pire écrase avec le même contenu.
 *
 * Usage : node migrate-from-json.mjs [dossier data, défaut ../data]
 */

import { readFileSync } from 'node:fs';
import { pool, ensureSchema } from './db.js';

const dataDir = process.argv[2] || '../data';

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.log(`[migration] ${path} introuvable ou illisible (${err.message}) — ignoré`);
    return null;
  }
}

async function main() {
  await ensureSchema();

  const rooms = readJson(`${dataDir}/rooms.json`) ?? {};
  const profiles = readJson(`${dataDir}/profiles.json`) ?? {};
  const accountsRaw = readJson(`${dataDir}/accounts.json`) ?? {};
  const accounts = accountsRaw.accounts ?? {};
  const tokens = accountsRaw.tokens ?? {};
  const blocksRaw = accountsRaw.blocks ?? {};

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let n = 0;
    for (const [code, state] of Object.entries(rooms)) {
      await client.query(
        'INSERT INTO rooms (code, data) VALUES ($1, $2) ON CONFLICT (code) DO UPDATE SET data = EXCLUDED.data',
        [code, JSON.stringify(state)],
      );
      n++;
    }
    console.log(`[migration] ${n} salle(s)`);

    n = 0;
    for (const [id, p] of Object.entries(profiles)) {
      await client.query(
        'INSERT INTO profiles (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
        [id, JSON.stringify(p)],
      );
      n++;
    }
    console.log(`[migration] ${n} profil(s)`);

    n = 0;
    for (const acc of Object.values(accounts)) {
      await client.query(
        `INSERT INTO accounts (id, username, salt, hash, created_at) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username, salt=EXCLUDED.salt, hash=EXCLUDED.hash`,
        [acc.id, acc.username, acc.salt, acc.hash, acc.createdAt],
      );
      n++;
    }
    console.log(`[migration] ${n} compte(s)`);

    n = 0;
    const now = Date.now();
    for (const [token, entry] of Object.entries(tokens)) {
      if (entry.expiresAt <= now) continue; // pas la peine d'importer des sessions déjà expirées
      await client.query(
        'INSERT INTO sessions (token, account_id, expires_at) VALUES ($1,$2,$3) ON CONFLICT (token) DO NOTHING',
        [token, entry.id, entry.expiresAt],
      );
      n++;
    }
    console.log(`[migration] ${n} session(s) encore valide(s)`);

    n = 0;
    for (const [blockerId, blockedList] of Object.entries(blocksRaw)) {
      for (const blockedId of blockedList) {
        await client.query(
          'INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [blockerId, blockedId],
        );
        n++;
      }
    }
    console.log(`[migration] ${n} blocage(s)`);

    await client.query('COMMIT');
    console.log('[migration] terminée avec succès');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[migration] échec, rien n\'a été appliqué —', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
