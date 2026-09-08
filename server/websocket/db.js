/**
 * Connexion Postgres (Supabase) — remplace la persistance en fichiers JSON.
 *
 * Connexion DIRECTE (`POSTGRES_URL_NON_POOLING`, port 5432), pas via le
 * pooler PgBouncer (`POSTGRES_URL`, port 6543) : ce dernier est pensé pour
 * des fonctions serverless qui ouvrent/ferment une connexion par requête
 * (Vercel). Ce serveur est un process Node long-vivant qui maintient son
 * propre pool (`pg.Pool`) sur toute sa durée de vie — lui faire, EN PLUS,
 * passer par un pooler externe n'aiderait à rien et empêcherait certaines
 * fonctionnalités de session (prepared statements).
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Le process tourne avec `cwd` = server/ (voir run.sh) ou est packagé tel
// quel sur Railway ; dans les deux cas le fichier de creds local vit à la
// racine du dépôt. En production, les variables sont injectées directement
// par la plateforme (Railway) — ce chargement est un no-op silencieux si le
// fichier n'existe pas.
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: join(__dirname, '..', '..', '.env.supabase.postgres') });
} catch {
  // dotenv non installé ou fichier absent : les variables d'env réelles
  // (Railway) prennent le relais, rien à faire.
}

const rawConnectionString = process.env.POSTGRES_URL_NON_POOLING;
if (!rawConnectionString) {
  throw new Error(
    '[db] POSTGRES_URL_NON_POOLING manquant — attendu dans .env.supabase.postgres ' +
    'en local, ou dans les variables d\'environnement de la plateforme en prod.',
  );
}

// `?sslmode=require` dans la chaîne pousse les versions récentes de `pg` à
// vérifier la chaîne de certificats en entier (comportement `verify-full`,
// voir l'avertissement de pg-connection-string) — or le certificat Supabase
// échoue cette vérification stricte depuis Node (chaîne auto-signée en
// intermédiaire, cas documenté côté Supabase). On retire donc ce paramètre
// de l'URL et on pilote TLS explicitement via `ssl` ci-dessous à la place :
// la connexion reste chiffrée, seule la vérification stricte de la chaîne
// est désactivée.
const connectionString = rawConnectionString.replace(/[?&]sslmode=[^&]*/, '');

export const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 10,
});

pool.on('error', (err) => {
  // Une connexion IDLE du pool qui tombe ne doit pas planter tout le
  // process — `pg` remonte ça en évènement plutôt qu'en exception.
  console.error('[db] erreur de connexion inattendue', err.message);
});

/**
 * Crée les tables si elles n'existent pas — pas de système de migration à
 * part entière, le schéma est encore assez simple pour vivre ici. Toutes
 * les opérations sont `IF NOT EXISTS` : sûr à rappeler à chaque démarrage.
 */
export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      salt TEXT,
      hash TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_username_lower
      ON accounts (lower(username));

    -- Comptes liés à Google/Apple ("Se connecter avec…") : pas de mot de
    -- passe, donc salt/hash y restent NULL — d'où leur passage en colonnes
    -- optionnelles ci-dessus. Ajoutées via ALTER plutôt que dans le CREATE
    -- pour rester rétrocompatible avec la table déjà en production (les
    -- comptes existants, mot de passe uniquement, ne changent pas de forme).
    ALTER TABLE accounts ALTER COLUMN salt DROP NOT NULL;
    ALTER TABLE accounts ALTER COLUMN hash DROP NOT NULL;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS provider TEXT;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS provider_id TEXT;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_provider
      ON accounts (provider, provider_id) WHERE provider IS NOT NULL;

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      expires_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions (account_id);

    CREATE TABLE IF NOT EXISTS blocks (
      blocker_id TEXT NOT NULL,
      blocked_id TEXT NOT NULL,
      PRIMARY KEY (blocker_id, blocked_id)
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY,
      data JSONB NOT NULL
    );
  `);
}
