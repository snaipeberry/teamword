import { createServer } from 'node:http';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { pool, ensureSchema } from './db.js';
import { verifyGoogleIdToken, verifyAppleIdToken } from './oauth.js';

/**
 * Serveur temps réel des parties — remplace Liveblocks.
 *
 * MODÈLE : le serveur fait autorité. Les clients n'écrivent jamais l'état
 * directement, ils envoient des INTENTIONS ; le serveur les applique et
 * rediffuse. C'est plus simple qu'un CRDT et cela supprime toute une classe
 * de désynchronisations : il n'existe qu'une seule vérité.
 *
 * Il rediffuse l'état COMPLET à chaque changement plutôt que des deltas. La
 * partie tient en quelques kilo-octets et le rythme d'un mots fléchés est
 * d'une frappe par seconde : le gain d'un protocole delta serait invisible,
 * son coût en bugs bien réel.
 *
 * Le serveur ignore tout des grilles. Le score est calculé côté client, qui
 * seul connaît les mots — exactement le même niveau de confiance qu'avec les
 * mutations Liveblocks, qui s'exécutaient elles aussi chez le client.
 */

const PORT = process.env.PORT || 8080;
const SNAPSHOT_EVERY_MS = 10_000;
// Une partie sans personne pendant ce délai est oubliée, pour ne pas garder
// indéfiniment en mémoire des salons abandonnés.
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

/** Durée de validité d'une session. Au-delà, il faut se reconnecter. */
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD = 8;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/**
 * "Se connecter avec…" : identifiants PUBLICS des applications OAuth
 * (Client ID Google, Services ID Apple) — pas des secrets, ils vont dans le
 * jeton `aud` que Google/Apple signent, exactement comme ils sont déjà
 * visibles dans le code du client. Aucun jeton ne sera accepté tant qu'ils
 * ne sont pas renseignés (voir .env.example) : `verifyXIdToken` échoue sur
 * un `aud` vide, ce qui ferme le flux plutôt que de l'accepter à l'aveugle.
 */
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const APPLE_AUDIENCE = process.env.APPLE_SERVICES_ID || '';

/**
 * Médailles : dérivées des compteurs, jamais stockées telles quelles.
 * Recalculées à chaque mise à jour, ce qui rend l'ajout d'une médaille
 * rétroactif sans migration.
 */
const MEDALS = [
  { id: 'first_win', label: 'Première victoire', icon: '🥉', reason: '1 victoire', test: (p) => p.wins >= 1 },
  { id: 'win_10', label: 'Habitué du podium', icon: '🥈', reason: '10 victoires', test: (p) => p.wins >= 10 },
  { id: 'win_50', label: 'Champion', icon: '🥇', reason: '50 victoires', test: (p) => p.wins >= 50 },
  { id: 'words_100', label: 'Centurion', icon: '💯', reason: '100 mots trouvés', test: (p) => p.words >= 100 },
  { id: 'words_1000', label: 'Verbicruciste', icon: '📚', reason: '1 000 mots trouvés', test: (p) => p.words >= 1000 },
  { id: 'daily_7', label: 'Assidu', icon: '🔥', reason: '7 grilles du jour', test: (p) => p.dailies >= 7 },
  { id: 'no_hint', label: 'Sans filet', icon: '🎯', reason: '5 grilles sans indice', test: (p) => p.cleanGrids >= 5 },
  // Le solo avait sa propre économie (soloPoints/soloGrids) mais aucune
  // médaille dédiée ; les trois suivantes sont aussi des paliers au-dessus
  // d'une médaille existante, pour qui la dépasse largement.
  { id: 'ermite', label: 'Ermite', icon: '🌱', reason: '50 grilles solo jouées', test: (p) => p.soloGrids >= 50 },
  { id: 'increvable', label: 'Increvable', icon: '⏳', reason: '100 parties jouées', test: (p) => p.games >= 100 },
  { id: 'perfectionniste', label: 'Perfectionniste', icon: '🏹', reason: '25 grilles sans indice', test: (p) => p.cleanGrids >= 25 },
  { id: 'fidele', label: 'Fidèle', icon: '☀️', reason: '30 grilles du jour', test: (p) => p.dailies >= 30 },
  { id: 'encyclopediste', label: 'Encyclopédiste', icon: '🗂️', reason: '5 000 mots trouvés', test: (p) => p.words >= 5000 },
];

/** Titre affiché : la médaille la plus haute obtenue. */
function titleFor(profile) {
  const gagnees = MEDALS.filter((m) => m.test(profile));
  return gagnees.length ? gagnees[gagnees.length - 1].label : 'Débutant';
}

/**
 * Paliers du mode solo, sur `profile.soloPoints`.
 *
 * Seuils volontairement élevés (~30 grilles pour Argent, ×2 à ×3 par palier
 * ensuite) : le solo est annoncé comme théoriquement infini, il doit rester
 * un vrai horizon de progression et non se vider en une soirée.
 */
const SOLO_TIERS = [
  { id: 'bronze', label: 'Bronze', icon: '🥉', min: 0 },
  { id: 'argent', label: 'Argent', icon: '🥈', min: 4_200 },
  { id: 'or', label: 'Or', icon: '🥇', min: 12_600 },
  { id: 'platine', label: 'Platine', icon: '💎', min: 30_000 },
  { id: 'diamant', label: 'Diamant', icon: '💠', min: 70_000 },
  { id: 'maitre', label: 'Maître', icon: '🔮', min: 150_000 },
  { id: 'grand_maitre', label: 'Grand Maître', icon: '⚡', min: 300_000 },
  { id: 'sorcier', label: 'Sorcier', icon: '🧙', min: 600_000 },
  { id: 'archimage', label: 'Archimage', icon: '🌌', min: 1_200_000 },
];

/** Index du palier courant dans SOLO_TIERS, à partir d'un total de points. */
function soloTierIndex(soloPoints) {
  let i = 0;
  for (let n = 0; n < SOLO_TIERS.length; n++) {
    if (soloPoints >= SOLO_TIERS[n].min) i = n;
  }
  return i;
}

/** Palier courant + progression vers le suivant, pour l'affichage. */
function soloTierFor(profile) {
  const i = soloTierIndex(profile.soloPoints);
  const suivant = SOLO_TIERS[i + 1] ?? null;
  return {
    tier: SOLO_TIERS[i],
    next: suivant,
    pointsToNext: suivant ? suivant.min - profile.soloPoints : null,
  };
}

function emptyRoom() {
  return {
    round: 0,
    game: 0,
    hostId: null,
    started: false,
    kicked: {},
    letters: {},
    revealed: {},
    scores: {},
    hints: {},
    ready: {},
    players: {},
    teams: {},
    // 'solo' | 'daily' | undefined (undefined = multijoueur classique,
    // comportement inchangé). Fixé au premier join, jamais réattribué.
    mode: undefined,
    // Répartition facile/moyen/difficile des indices — voir lib/difficulty.ts
    // côté client. Choisi par l'hôte dans le salon ; 'moyen' par défaut pour
    // les parties sans salon (bot, duel aléatoire), qui n'ont aucun moment
    // de configuration.
    grade: 'moyen',
    touchedAt: Date.now(),
  };
}

/** rooms: code -> état ; sockets: code -> Set<ws> */
const rooms = new Map();
const sockets = new Map();

/**
 * Profils persistants, indexés par playerId.
 *
 * ATTENTION : le playerId vient du localStorage du navigateur, il n'y a pas
 * de véritable compte. Un profil ne suit donc pas d'un appareil à l'autre et
 * reste falsifiable — acceptable pour un classement convivial, à remplacer
 * par une authentification si le classement devient un enjeu.
 */
const profiles = new Map();

function emptyProfile(id) {
  return {
    id,
    name: 'Joueur',
    avatar: null,
    points: 0,
    words: 0,
    wins: 0,
    games: 0,
    dailies: 0,
    cleanGrids: 0,
    // Économie solo : séparée du classement général (`points`) — voir
    // l'intent `soloGridDone` et l'intent `letter` (qui n'incrémente PAS
    // `points` en salle solo/quotidienne).
    soloPoints: 0,
    soloGrids: 0,
    hintBalance: 3,
    updatedAt: Date.now(),
  };
}

function getProfile(id) {
  if (!profiles.has(id)) profiles.set(id, emptyProfile(id));
  return profiles.get(id);
}

function publicProfile(id) {
  const p = getProfile(id);
  return {
    ...p,
    medals: MEDALS.filter((m) => m.test(p)).map(({ id, label, icon }) => ({ id, label, icon })),
    // Catalogue COMPLET (obtenues et non obtenues), pour que l'écran profil
    // puisse montrer les verrouillées en aperçu grisé plutôt que les omettre
    // — `medals` ci-dessus reste la liste filtrée (obtenues seulement), pour
    // ne rien casser chez qui l'utilisait déjà pour le compte "x/7".
    allMedals: MEDALS.map(({ id, label, icon, reason, test }) => ({ id, label, icon, reason, earned: test(p) })),
    title: titleFor(p),
    ...soloTierFor(p),
  };
}

// ---------- comptes ----------
//
// Mots de passe hachés avec scrypt (présent dans Node, aucune dépendance) :
// une fonction de dérivation à coût réglable, contrairement à un SHA brut qui
// se force en masse. Sel aléatoire par compte, comparaison à temps constant.

/** clé = pseudo en minuscules ; permet un pseudo insensible à la casse. */
const accounts = new Map();
/** clé = "provider:providerId" ; retrouver un compte Google/Apple à la
 *  reconnexion sans reparcourir tous les comptes. Reconstruit au chargement
 *  (voir loadAccounts), tenu à jour à chaque création. */
const accountsByProvider = new Map();
/** token -> { id, expiresAt } */
const tokens = new Map();
/** Limitation des tentatives, par adresse : ip -> { count, resetAt } */
const attempts = new Map();
/**
 * Blocages en duel aléatoire : playerId -> Set<playerId bloqué>. Un invité
 * (id éphémère, régénéré à chaque rechargement — voir auth.ts côté client)
 * bloque quand même pour la session en cours, juste sans effet au
 * rechargement suivant — cohérent avec le reste du modèle invité.
 */
const blocks = new Map();

function blockedIds(id) {
  return blocks.get(id) ?? new Set();
}

function isBlockedPair(a, b) {
  return blockedIds(a).has(b) || blockedIds(b).has(a);
}

function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (err, derived) => (err ? reject(err) : resolve(derived)));
  });
}

async function createAccount(username, password) {
  const salt = randomBytes(16);
  const hash = await hashPassword(password, salt);
  const account = {
    id: `acc_${randomBytes(12).toString('hex')}`,
    username,
    salt: salt.toString('hex'),
    hash: hash.toString('hex'),
    provider: null,
    providerId: null,
    email: null,
    createdAt: Date.now(),
  };
  accounts.set(username.toLowerCase(), account);
  markDirty();
  return account;
}

async function verifyPassword(account, password) {
  const attendu = Buffer.from(account.hash, 'hex');
  const fourni = await hashPassword(password, Buffer.from(account.salt, 'hex'));
  // timingSafeEqual exige des longueurs égales, sinon il lève.
  return attendu.length === fourni.length && timingSafeEqual(attendu, fourni);
}

/**
 * Dérive un pseudo valide (règles de USERNAME_RE) et disponible à partir
 * d'un indice — nom ou email renvoyé par Google/Apple, parfois absent
 * (Apple ne le fournit qu'au tout premier consentement). Ni Google ni Apple
 * ne garantissent un format compatible (espaces, accents, longueur libre) :
 * on ne peut donc jamais utiliser l'indice tel quel.
 */
function pickUsername(hint) {
  const base = String(hint ?? '')
    .split('@')[0]
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // accents décomposés (NFD) -> lettre nue
    .replace(/[^a-zA-Z0-9_]/g, '')
    .slice(0, 16);
  const racine = base.length >= 3 ? base : `Joueur${base}`;

  let candidat = racine.slice(0, 20);
  let n = 1;
  while (accounts.has(candidat.toLowerCase())) {
    n += 1;
    candidat = `${racine}${n}`.slice(0, 20);
  }
  return candidat;
}

/**
 * Compte lié à Google ou Apple ("Se connecter avec…") — pas de mot de passe
 * ici, `sub` (l'identifiant stable du fournisseur) en tient lieu de secret :
 * seul Google/Apple peut le prouver, via la signature du jeton (voir
 * oauth.js), donc pas besoin de scrypt ici.
 */
/**
 * Reprise de la progression jouée sans compte — commune à la création par
 * mot de passe (/register) et par Google/Apple (/oauth/callback), les deux
 * créant un compte de la même façon derrière des identités différentes.
 *
 * `claimed` garantit qu'un profil anonyme ne peut être revendiqué qu'UNE
 * fois : sans cela, quelqu'un qui devinerait l'identifiant d'un autre
 * joueur pourrait s'approprier ses points.
 */
function migrateAnonymousProgress(profile, accountId, migrateFrom) {
  const depuis = String(migrateFrom ?? '');
  if (!depuis || !profiles.has(depuis)) return;

  const ancien = profiles.get(depuis);
  if (ancien.claimed || ancien.id.startsWith('acc_')) return;

  profile.points += ancien.points;
  profile.words += ancien.words;
  profile.wins += ancien.wins;
  profile.games += ancien.games;
  profile.dailies += ancien.dailies;
  profile.cleanGrids += ancien.cleanGrids;
  profile.soloPoints += ancien.soloPoints;
  profile.soloGrids += ancien.soloGrids;
  // La monnaie d'indices s'ajoute (pas de remplacement) : le solde de
  // départ du nouveau profil ne doit pas être perdu.
  profile.hintBalance += ancien.hintBalance;
  if (!profile.avatar) profile.avatar = ancien.avatar;
  ancien.claimed = true;

  // La salle solo elle-même doit suivre : sans ce transfert, la progression
  // de points migre mais le numéro de grille repart de zéro (la salle solo
  // du nouveau compte est encore vierge).
  const salleAnonyme = `solo-${depuis}`;
  if (rooms.has(salleAnonyme) && !rooms.has(`solo-${accountId}`)) {
    const salle = rooms.get(salleAnonyme);
    rooms.delete(salleAnonyme);
    sockets.delete(salleAnonyme);
    rooms.set(`solo-${accountId}`, salle);
  }
}

function createOAuthAccount(provider, providerId, email, username) {
  const account = {
    id: `acc_${randomBytes(12).toString('hex')}`,
    username,
    salt: null,
    hash: null,
    provider,
    providerId,
    email,
    createdAt: Date.now(),
  };
  accounts.set(username.toLowerCase(), account);
  accountsByProvider.set(`${provider}:${providerId}`, account);
  markDirty();
  return account;
}

function issueToken(id) {
  const token = randomBytes(32).toString('hex');
  tokens.set(token, { id, expiresAt: Date.now() + TOKEN_TTL_MS });
  markDirty();
  return token;
}

function resolveToken(token) {
  const entry = tokens.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    tokens.delete(token);
    return null;
  }
  return entry.id;
}

/**
 * Vérifie qu'un id revendiqué comme COMPTE (`acc_…`) correspond bien au
 * jeton de session fourni, avant de le laisser agir sous ce nom.
 *
 * Jusqu'ici `player.id` (join/queue) et `id` (profile-update, block,
 * unblock) étaient acceptés tels quels : n'importe qui connaissant l'id
 * d'un compte — visible partout, classement compris — pouvait s'en servir
 * pour accumuler des points en son nom, changer son avatar, ou manipuler
 * ses blocages. Un id invité (`guest-…`) n'a par nature aucun secret à
 * vérifier (pas de mot de passe) : il reste falsifiable entre invités (rien
 * de précieux n'y est attaché — exclu du classement, voir /leaderboard),
 * mais ne peut plus se faire passer pour un compte réel.
 *
 * Renvoie l'id si la revendication est légitime (ou n'avait rien à
 * prouver), `null` si elle doit être rejetée.
 */
function verifiedId(claimedId, token) {
  const id = String(claimedId ?? '').slice(0, 64);
  if (!id) return null;
  if (!id.startsWith('acc_')) return id;
  return resolveToken(token ?? '') === id ? id : null;
}

/** Renvoie true si l'appelant a droit à une tentative supplémentaire. */
function allowAttempt(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 10;
}

/** File d'attente du 1v1 aléatoire. Volontairement non persistée. */
const queue = [];

// ---------- persistance (Postgres — voir db.js) ----------
// Sans elle, un simple redémarrage effacerait toutes les parties en cours —
// or reprendre une partie plus tard fait partie des attentes du jeu.
//
// Toujours pas de fichiers : les Map en mémoire (rooms/profiles/accounts/
// tokens/blocks) restent la source de vérité PENDANT que le process tourne
// — chaque intent continue de les muter directement, aucun appelant
// n'attend une écriture DB pour progresser. Seule la PERSISTANCE change de
// support : chargée depuis Postgres au démarrage, réécrite dedans par
// snapshot périodique (`saveSnapshot`, identique dans son principe à
// l'ancien `writeJsonAtomic`, juste vers une table plutôt qu'un fichier).

async function loadSnapshot() {
  try {
    const { rows } = await pool.query('SELECT code, data FROM rooms');
    const now = Date.now();
    for (const { code, data } of rows) {
      // Une salle solo n'expire jamais : la progression (numéro de grille en
      // cours) doit survivre indéfiniment, pas seulement les points/ampoules
      // déjà pérennes sur le profil.
      if (data.mode === 'solo' || now - (data.touchedAt ?? 0) < ROOM_TTL_MS) {
        rooms.set(code, data);
      }
    }
    console.log(`[boot] ${rooms.size} partie(s) restaurée(s)`);
  } catch (err) {
    console.log('[boot] aucune partie restaurée —', err.message);
  }
}

async function loadProfiles() {
  try {
    const { rows } = await pool.query('SELECT id, data FROM profiles');
    for (const { id, data } of rows) profiles.set(id, { ...emptyProfile(id), ...data });
    console.log(`[boot] ${profiles.size} profil(s) restauré(s)`);
  } catch (err) {
    console.log('[boot] aucun profil restauré —', err.message);
  }
}

async function loadAccounts() {
  try {
    const { rows: comptes } = await pool.query(
      'SELECT id, username, salt, hash, provider, provider_id, email, created_at FROM accounts',
    );
    for (const a of comptes) {
      const account = {
        id: a.id, username: a.username, salt: a.salt, hash: a.hash,
        provider: a.provider, providerId: a.provider_id, email: a.email,
        createdAt: Number(a.created_at),
      };
      accounts.set(a.username.toLowerCase(), account);
      if (a.provider && a.provider_id) accountsByProvider.set(`${a.provider}:${a.provider_id}`, account);
    }

    const now = Date.now();
    const { rows: sessions } = await pool.query(
      'SELECT token, account_id, expires_at FROM sessions WHERE expires_at > $1',
      [now],
    );
    for (const s of sessions) tokens.set(s.token, { id: s.account_id, expiresAt: Number(s.expires_at) });

    const { rows: blocages } = await pool.query('SELECT blocker_id, blocked_id FROM blocks');
    for (const b of blocages) {
      if (!blocks.has(b.blocker_id)) blocks.set(b.blocker_id, new Set());
      blocks.get(b.blocker_id).add(b.blocked_id);
    }

    console.log(`[boot] ${accounts.size} compte(s), ${tokens.size} session(s)`);
  } catch (err) {
    console.log('[boot] aucun compte restauré —', err.message);
  }
}

/**
 * Remplace intégralement le contenu d'une table par les lignes fournies,
 * DANS la transaction du client donné — un `DELETE` + `INSERT` en masse
 * plutôt qu'un UPSERT ligne à ligne : ce qui est en mémoire EST la vérité
 * complète du moment (une suppression en mémoire — compte supprimé, salle
 * expirée — doit disparaître de la table aussi), exactement le même
 * principe que l'ancien fichier réécrit en entier à chaque instantané.
 * `table` est toujours un littéral appelé ci-dessous, jamais une entrée
 * utilisateur : l'interpoler dans la requête est sûr ici.
 */
async function bulkReplace(client, table, columns, rows) {
  await client.query(`DELETE FROM ${table}`);
  if (!rows.length) return;
  const placeholders = rows
    .map((row, i) => `(${row.map((_, j) => `$${i * columns.length + j + 1}`).join(',')})`)
    .join(',');
  await client.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders}`, rows.flat());
}

// Un instantané complet sur 5 tables à chaque cycle, même quand rien n'a
// bougé (aucune partie active), gaspille des écritures Postgres pour rien —
// à la différence d'un fichier local, celles-ci ont un coût réseau et
// comptent contre les quotas de l'hébergeur. `markDirty()` est appelé à
// chaque mutation connue (intent de salle, connexion, compte, blocage) ;
// `saveSnapshot` n'écrit que si quelque chose a changé depuis la dernière
// fois — `force` (utilisé à l'extinction) contourne ce filtre.
let dirty = false;
function markDirty() {
  dirty = true;
}

async function saveSnapshot(force = false) {
  if (!dirty && !force) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await bulkReplace(client, 'rooms', ['code', 'data'],
      [...rooms].map(([code, state]) => [code, JSON.stringify(state)]));
    await bulkReplace(client, 'profiles', ['id', 'data'],
      [...profiles].map(([id, p]) => [id, JSON.stringify(p)]));
    await bulkReplace(client, 'accounts', ['id', 'username', 'salt', 'hash', 'provider', 'provider_id', 'email', 'created_at'],
      [...accounts.values()].map((a) => [
        a.id, a.username, a.salt ?? null, a.hash ?? null,
        a.provider ?? null, a.providerId ?? null, a.email ?? null, a.createdAt,
      ]));
    await bulkReplace(client, 'sessions', ['token', 'account_id', 'expires_at'],
      [...tokens].map(([token, entry]) => [token, entry.id, entry.expiresAt]));
    await bulkReplace(client, 'blocks', ['blocker_id', 'blocked_id'],
      [...blocks].flatMap(([blocker, set]) => [...set].map((blocked) => [blocker, blocked])));
    await client.query('COMMIT');
    // Effacé seulement après succès CONFIRMÉ : un échec laisse `dirty` à
    // true pour que le cycle suivant réessaie, plutôt que de perdre le
    // changement silencieusement.
    dirty = false;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[snapshot] échec', err.message);
  } finally {
    client.release();
  }
}

function pruneRooms() {
  const now = Date.now();
  let retire = false;

  for (const [code, state] of rooms) {
    if (state.mode === 'solo') continue; // jamais oubliée, voir loadSnapshot
    const vivants = sockets.get(code);
    if ((!vivants || vivants.size === 0) && now - state.touchedAt > ROOM_TTL_MS) {
      rooms.delete(code);
      sockets.delete(code);
      retire = true;
    }
  }

  // Un jeton expiré n'était jusqu'ici retiré qu'à sa PROCHAINE consultation
  // (voir resolveToken) — une session ouverte puis jamais réutilisée restait
  // en mémoire (et en base) indéfiniment. Le même passage périodique que les
  // salles s'en charge maintenant.
  for (const [token, entry] of tokens) {
    if (entry.expiresAt < now) {
      tokens.delete(token);
      retire = true;
    }
  }

  if (retire) markDirty();
}

// ---------- diffusion ----------
function peers(code) {
  return sockets.get(code) ?? new Set();
}

function send(ws, message) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function broadcastState(code) {
  const state = rooms.get(code);
  if (!state) return;
  const message = JSON.stringify({ t: 'state', state });
  for (const ws of peers(code)) {
    if (ws.readyState === ws.OPEN) ws.send(message);
  }
}

function broadcastPresence(code) {
  const list = [...peers(code)]
    .filter((ws) => ws.player)
    .map((ws) => ({ ...ws.player, connectionId: ws.connectionId }));
  const message = JSON.stringify({ t: 'presence', players: list });
  for (const ws of peers(code)) {
    if (ws.readyState === ws.OPEN) ws.send(message);
  }
}

// ---------- intentions ----------
// Chaque entrée reçoit (state, payload, playerId) et renvoie true si l'état a
// changé — c'est ce qui décide de rediffuser ou non.
const INTENTS = {
  letter(state, { cellId, letter, scored = 0 }, playerId) {
    if (typeof cellId !== 'string') return false;
    if (letter) state.letters[cellId] = String(letter).slice(0, 1);
    else delete state.letters[cellId];
    if (scored > 0) {
      state.scores[playerId] = (state.scores[playerId] ?? 0) + scored;
      // Les points de profil suivent les mots trouvés, pas les grilles : c'est
      // immédiat et cela récompense aussi les parties abandonnées en cours.
      const profile = getProfile(playerId);
      // Le classement général ne doit refléter QUE le duel aléatoire classé
      // (state.ranked, posé uniquement par tryMatch) : le solo/quotidien a
      // son propre système de points (soloGridDone), et le bot comme les
      // parties privées n'ont aucune valeur compétitive — les y compter
      // permettrait de gonfler son classement en s'entraînant contre un bot
      // ou entre amis complices.
      if (state.ranked === true) {
        profile.points += scored;
      }
      profile.words += scored;
      profile.updatedAt = Date.now();
    }
    return true;
  },

  reveal(state, { cellId, letter }, playerId) {
    if (typeof cellId !== 'string') return false;

    if (state.mode === 'solo' || state.mode === 'daily') {
      // Monnaie persistante (« ampoules ») : gagnée en jouant, dépensée ici.
      const profile = getProfile(playerId);
      if (profile.hintBalance <= 0) return false;
      profile.hintBalance -= 1;
      profile.updatedAt = Date.now();
    } else {
      // Multijoueur classique : pas de monnaie, un plafond fixe par salle
      // (state.hints n'est jamais remis à zéro entre les manches d'une même
      // salle — donc 3 indices pour toute la partie, pas 3 par grille).
      if ((state.hints[playerId] ?? 0) >= 3) return false;
    }

    state.letters[cellId] = String(letter).slice(0, 1);
    state.revealed[cellId] = true;
    // Volontairement SANS point : une lettre donnée par l'aide ne doit pas
    // faire gagner le mot.
    state.hints[playerId] = (state.hints[playerId] ?? 0) + 1;
    return true;
  },

  ready(state, { round }, playerId) {
    state.ready[playerId] = round;
    return true;
  },

  advance(state, { fromRound }) {
    // Fin de grille : on solde les compteurs de profil avant de repartir.
    const teams = state.teams ?? {};
    // Un joueur n'entre dans `scores` qu'en marquant. S'en tenir à cette clé
    // priverait de sa victoire l'équipier qui n'a rien trouvé — alors que
    // c'est le camp qui gagne. On réunit donc les deux sources.
    const joueurs = [...new Set([...Object.keys(state.scores), ...Object.keys(teams)])];
    if (joueurs.length > 0) {
      const camps = [...new Set(Object.values(teams))];

      /**
       * En partie par ÉQUIPES, la victoire revient au camp, pas au meilleur
       * marqueur : un joueur peut très bien gagner en ayant moins de points
       * qu'un adversaire, si ses coéquipiers ont porté l'équipe.
       */
      let gagnants;
      if (camps.length > 1) {
        const totaux = camps.map((c) => ({
          camp: c,
          total: joueurs
            .filter((id) => teams[id] === c)
            .reduce((n, id) => n + (state.scores[id] ?? 0), 0),
        }));
        const meilleur = Math.max(...totaux.map((t) => t.total));
        // Égalité : on ne départage pas, tous les camps à égalité gagnent.
        const campsGagnants = totaux.filter((t) => t.total === meilleur).map((t) => t.camp);
        gagnants = new Set(joueurs.filter((id) => campsGagnants.includes(teams[id])));
      } else {
        const meilleur = Math.max(...joueurs.map((id) => state.scores[id] ?? 0));
        gagnants = new Set(
          joueurs.length > 1 ? joueurs.filter((id) => (state.scores[id] ?? 0) === meilleur) : [],
        );
      }

      for (const id of joueurs) {
        const profile = getProfile(id);
        profile.games += 1;
        if (gagnants.has(id)) profile.wins += 1;
        if (!state.hints[id]) profile.cleanGrids += 1;
        profile.updatedAt = Date.now();
      }
    }

    // Idempotent : tous les clients détectent « tout le monde est prêt » au
    // même instant et émettent en même temps. Sans cette garde on sauterait
    // plusieurs grilles d'un coup.
    if (fromRound !== undefined && state.round !== fromRound) return false;
    state.round += 1;
    state.letters = {};
    state.revealed = {};
    return true;
  },

  reset(state) {
    // Nouvelle partie : la graine change (via `game`), donc grille NEUVE et
    // non celle déjà jouée.
    state.game += 1;
    state.round = 0;
    state.letters = {};
    state.revealed = {};
    state.scores = {};
    state.hints = {};
    state.ready = {};
    return true;
  },

  start(state) {
    state.started = true;
    return true;
  },

  /**
   * Signale une grille solo ou quotidienne terminée : `points` (pondérés par
   * la complexité des mots) est calculé côté client, qui seul connaît les
   * mots — même niveau de confiance que `scored` sur l'intent `letter`.
   */
  soloGridDone(state, { points, daily = false }, playerId) {
    const profile = getProfile(playerId);
    const gagne = Math.max(0, Math.floor(Number(points) || 0));

    const avant = soloTierIndex(profile.soloPoints);
    profile.soloPoints += gagne;
    profile.soloGrids += 1;
    const apres = soloTierIndex(profile.soloPoints);

    // +1 ampoule à chaque grille, +5 de plus si on vient de franchir un
    // palier — la progression solo doit se sentir, pas juste s'afficher.
    profile.hintBalance += 1 + (apres > avant ? 5 : 0);

    if (daily) profile.dailies += 1;
    profile.updatedAt = Date.now();
    return false; // rien de partagé au niveau salle ne change
  },

  kick(state, { playerId: cible }, playerId) {
    // Contrôle côté SERVEUR : masquer le bouton chez le client ne protège de
    // rien, le message restant forgeable.
    if (state.hostId !== playerId) return false;
    if (cible === playerId) return false;
    state.kicked[cible] = true;
    return true;
  },

  /** Photo et pseudo. La photo est une vignette base64 envoyée par le client. */
  profile(state, { name, avatar }, playerId) {
    const profile = getProfile(playerId);
    if (typeof name === 'string' && name.trim()) {
      const clean = name.trim().slice(0, 16);
      profile.name = clean;
      const existant = state.players[playerId] ?? {};
      state.players[playerId] = { ...existant, name: clean };
    }
    if (typeof avatar === 'string') {
      // Plafond volontaire : la vignette est réduite côté client à 96 px, ce
      // qui tient largement sous cette limite. Au-delà, on refuse plutôt que
      // de laisser gonfler l'instantané.
      profile.avatar = avatar.length <= 40_000 ? avatar : null;
    } else if (avatar === null) {
      profile.avatar = null;
    }
    profile.updatedAt = Date.now();
    return true;
  },

  /** Équipe choisie dans le salon (matchmaking privé 2v2 / 3v3). */
  team(state, { team }, playerId) {
    if (!state.teams) state.teams = {};
    if (team === null) delete state.teams[playerId];
    else state.teams[playerId] = String(team).slice(0, 1).toUpperCase();
    return true;
  },

  /**
   * Grade choisi dans le salon — répartition des indices de la partie.
   * Contrôle côté serveur comme `kick` : seul l'hôte peut le changer, un
   * client qui masquerait le bouton ne protégerait de rien.
   */
  grade(state, { grade }, playerId) {
    if (state.hostId !== playerId) return false;
    if (!['facile', 'moyen', 'difficile'].includes(grade)) return false;
    state.grade = grade;
    return true;
  },

  rename(state, { name }, playerId) {
    const clean = String(name ?? '').trim().slice(0, 16);
    if (!clean) return false;
    const existant = state.players[playerId] ?? {};
    state.players[playerId] = { ...existant, name: clean };
    return true;
  },
};

// ---------- appariement 1v1 aléatoire ----------

function randomCode(length = 6) {
  // Mêmes caractères que côté client : on évite ceux qu'on confond à l'oral.
  const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += CHARS[Math.floor(Math.random() * CHARS.length)];
  return out;
}

function leaveQueue(ws) {
  const i = queue.indexOf(ws);
  if (i >= 0) queue.splice(i, 1);
}

function tryMatch() {
  // Un joueur peut s'être déconnecté en attendant : le laisser tomber plutôt
  // que de l'apparier dans le vide.
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].readyState !== queue[i].OPEN) queue.splice(i, 1);
  }

  // Pas un simple shift/shift : deux joueurs qui se sont mutuellement
  // bloqués ne doivent jamais se retrouver appariés. On cherche la PREMIÈRE
  // paire valide dans la file plutôt que de perdre les autres en attente —
  // la file reste minuscule en pratique, le O(n²) est hors de propos.
  let apparie = true;
  while (apparie) {
    apparie = false;
    outer: for (let i = 0; i < queue.length; i++) {
      for (let j = i + 1; j < queue.length; j++) {
        const a = queue[i];
        const b = queue[j];
        if (!a.player || !b.player || isBlockedPair(a.player.id, b.player.id)) continue;

        queue.splice(j, 1);
        queue.splice(i, 1);

        const code = randomCode();
        const state = emptyRoom();
        // Partie déjà lancée : en 1v1 aléatoire, il n'y a personne à
        // attendre ni rien à régler dans un salon.
        state.started = true;
        state.ranked = true;
        rooms.set(code, state);

        for (const ws of [a, b]) send(ws, { t: 'matched', room: code });

        apparie = true;
        break outer;
      }
    }
  }
}

// ---------- serveur ----------
await ensureSchema();
await loadSnapshot();
await loadProfiles();
await loadAccounts();
setInterval(saveSnapshot, SNAPSHOT_EVERY_MS);
setInterval(pruneRooms, 60 * 60 * 1000);

function json(res, body) {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    // Le front est servi depuis une autre origine que ce service.
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body));
}

const http = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Le front est servi depuis une autre origine ; sans préflight, le POST du
  // profil serait bloqué par le navigateur.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (req.method === 'POST' && (url.pathname === '/register' || url.pathname === '/login')) {
    const ip = req.socket.remoteAddress ?? 'inconnu';
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4_000) req.destroy();
    });
    req.on('end', async () => {
      // Limitation avant tout traitement : elle protège aussi bien le coût
      // du scrypt que le compte lui-même.
      if (!allowAttempt(ip)) {
        res.writeHead(429, { 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ error: 'Trop de tentatives, réessayez plus tard' }));
      }

      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
        return res.end();
      }

      const username = String(payload.username ?? '').trim();
      const password = String(payload.password ?? '');

      if (url.pathname === '/register') {
        if (!USERNAME_RE.test(username)) {
          return json(res, { error: 'Pseudo : 3 à 20 caractères, lettres, chiffres ou _' });
        }
        if (password.length < MIN_PASSWORD) {
          return json(res, { error: `Mot de passe : ${MIN_PASSWORD} caractères minimum` });
        }
        if (accounts.has(username.toLowerCase())) {
          return json(res, { error: 'Ce pseudo est déjà pris' });
        }

        const account = await createAccount(username, password);
        const profile = getProfile(account.id);
        profile.name = username;
        migrateAnonymousProgress(profile, account.id, payload.migrateFrom);

        return json(res, { id: account.id, username, token: issueToken(account.id) });
      }

      const account = accounts.get(username.toLowerCase());
      // Message identique que le compte existe ou non : sinon on révélerait
      // quels pseudos sont enregistrés.
      const echec = { error: 'Pseudo ou mot de passe incorrect' };
      if (!account) return json(res, echec);
      if (!(await verifyPassword(account, password))) return json(res, echec);

      return json(res, {
        id: account.id,
        username: account.username,
        token: issueToken(account.id),
      });
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/oauth/callback') {
    const ip = req.socket.remoteAddress ?? 'inconnu';
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 8_000) req.destroy();
    });
    req.on('end', async () => {
      if (!allowAttempt(ip)) {
        res.writeHead(429, { 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ error: 'Trop de tentatives, réessayez plus tard' }));
      }

      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
        return res.end();
      }

      const provider = payload.provider === 'google' || payload.provider === 'apple' ? payload.provider : null;
      const credential = String(payload.credential ?? '');
      if (!provider || !credential) return json(res, { error: 'Requête invalide' });

      // Un jeton refusé ici veut dire : signature invalide, expiré, ou pas
      // destiné à CETTE app (`aud`) — jamais un problème de compte, donc un
      // seul message, générique, comme pour /login.
      let claims;
      try {
        claims = provider === 'google'
          ? await verifyGoogleIdToken(credential, GOOGLE_CLIENT_ID)
          : await verifyAppleIdToken(credential, APPLE_AUDIENCE);
      } catch (err) {
        console.error(`[oauth] jeton ${provider} refusé —`, err.message);
        return json(res, { error: 'Connexion refusée, réessaie' });
      }

      let account = accountsByProvider.get(`${provider}:${claims.sub}`);
      if (!account) {
        // Le nom n'est fourni qu'à la toute première connexion (surtout
        // vrai pour Apple) : `payload.name`, capturé côté client à cet
        // instant précis, sert de repli quand le jeton lui-même n'en a pas.
        const indice = ('name' in claims ? claims.name : null) || payload.name || claims.email;
        const username = pickUsername(indice);
        account = createOAuthAccount(provider, claims.sub, claims.email, username);
        const profile = getProfile(account.id);
        profile.name = username;
        migrateAnonymousProgress(profile, account.id, payload.migrateFrom);
      }

      return json(res, { id: account.id, username: account.username, token: issueToken(account.id) });
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/logout') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000) req.destroy();
    });
    req.on('end', () => {
      try {
        const { token } = JSON.parse(body);
        if (token) {
          tokens.delete(token);
          markDirty();
        }
      } catch {
        /* rien à faire : se déconnecter ne doit jamais échouer bruyamment */
      }
      json(res, { ok: true });
    });
    return;
  }

  if (url.pathname === '/session') {
    const id = resolveToken(url.searchParams.get('token') ?? '');
    if (!id) return json(res, { valid: false });
    const account = [...accounts.values()].find((a) => a.id === id);
    return json(res, { valid: true, id, username: account?.username ?? null });
  }

  /**
   * Suppression de compte (obligatoire pour la review App Store/Play Store :
   * un joueur doit pouvoir supprimer son compte DEPUIS l'app, pas seulement
   * s'en déconnecter). Efface tout ce qui est identifié par ce compte —
   * irréversible, d'où l'instantané forcé immédiatement après plutôt que
   * d'attendre le tick de 10s : un crash entre les deux ne doit pas pouvoir
   * ressusciter le compte depuis un ancien instantané.
   */
  if (req.method === 'POST' && url.pathname === '/account-delete') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000) req.destroy();
    });
    req.on('end', async () => {
      try {
        const { token } = JSON.parse(body);
        const id = resolveToken(token ?? '');
        if (!id) return json(res, { error: 'Session invalide' });

        const entree = [...accounts.entries()].find(([, a]) => a.id === id);
        if (entree) accounts.delete(entree[0]);

        for (const [t, entry] of [...tokens.entries()]) {
          if (entry.id === id) tokens.delete(t);
        }

        profiles.delete(id);

        const salleSolo = `solo-${id}`;
        rooms.delete(salleSolo);
        sockets.delete(salleSolo);

        // force=true : une suppression de compte doit être durablement
        // actée immédiatement, pas attendre le prochain changement pour
        // qu'un cycle d'instantané la remarque.
        await saveSnapshot(true);
        json(res, { ok: true });
      } catch {
        res.writeHead(400);
        res.end();
      }
    });
    return;
  }

  // Mise à jour du profil hors partie : l'écran de profil est accessible
  // depuis l'accueil, où aucun socket n'est ouvert.
  if (req.method === 'POST' && url.pathname === '/profile-update') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 60_000) req.destroy(); // garde-fou
    });
    req.on('end', () => {
      try {
        const { id: claimedId, token, name, avatar } = JSON.parse(body);
        const id = verifiedId(claimedId, token);
        if (!id) {
          res.writeHead(400);
          return res.end();
        }
        const profile = getProfile(id);
        if (typeof name === 'string' && name.trim()) profile.name = name.trim().slice(0, 16);
        if (typeof avatar === 'string') profile.avatar = avatar.length <= 40_000 ? avatar : profile.avatar;
        else if (avatar === null) profile.avatar = null;
        profile.updatedAt = Date.now();
        markDirty();
        json(res, publicProfile(id));
      } catch {
        res.writeHead(400);
        res.end();
      }
    });
    return;
  }

  if (req.method === 'POST' && (url.pathname === '/block' || url.pathname === '/unblock')) {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000) req.destroy();
    });
    req.on('end', () => {
      try {
        const { id: claimedId, token, playerId } = JSON.parse(body);
        const id = verifiedId(claimedId, token);
        if (!id || !playerId || id === playerId) {
          res.writeHead(400);
          return res.end();
        }
        if (url.pathname === '/block') {
          if (!blocks.has(id)) blocks.set(id, new Set());
          blocks.get(id).add(String(playerId).slice(0, 64));
        } else {
          blocks.get(id)?.delete(playerId);
        }
        markDirty();
        json(res, { blocked: [...blockedIds(id)] });
      } catch {
        res.writeHead(400);
        res.end();
      }
    });
    return;
  }

  if (url.pathname === '/blocks') {
    const id = url.searchParams.get('id');
    if (!id) {
      res.writeHead(400);
      return res.end();
    }
    return json(res, { blocked: [...blockedIds(id)] });
  }

  if (url.pathname === '/health') {
    return json(res, { status: 'ok', rooms: rooms.size, profiles: profiles.size, queue: queue.length });
  }

  if (url.pathname === '/leaderboard') {
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
    const solo = url.searchParams.get('mode') === 'solo';
    const top = [...profiles.values()]
      // Un invité (id préfixé `guest-`, jamais persisté côté client) ne doit
      // jamais apparaître au classement — c'est explicitement ce qu'« aucune
      // persistance, pas de classement » veut dire. L'adversaire artificiel
      // (id préfixé `bot-`, voir BotGame.tsx) n'est pas un joueur non plus.
      .filter((p) => !p.id.startsWith('guest-') && !p.id.startsWith('bot-'))
      .filter((p) => (solo ? p.soloPoints > 0 : p.points > 0))
      .sort((a, b) =>
        solo ? b.soloPoints - a.soloPoints || b.soloGrids - a.soloGrids : b.points - a.points || b.words - a.words,
      )
      .slice(0, limit)
      .map((p, i) => ({
        rank: i + 1,
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        points: solo ? p.soloPoints : p.points,
        words: p.words,
        wins: p.wins,
        soloGrids: p.soloGrids,
        title: solo ? soloTierFor(p).tier.label : titleFor(p),
      }));
    return json(res, { top });
  }

  if (url.pathname === '/profile') {
    const id = url.searchParams.get('id');
    if (!id) {
      res.writeHead(400);
      return res.end();
    }
    const me = publicProfile(id);
    // Rang calculé à la volée : le nombre de profils reste modeste et cela
    // évite de maintenir un index à jour. Un invité n'a pas de rang — il
    // n'apparaît jamais au classement (voir /leaderboard) — et ne doit pas
    // non plus en gonfler le calcul pour les autres ; même chose pour le bot.
    const horsClassement = id.startsWith('guest-') || id.startsWith('bot-');
    const mieux = [...profiles.values()]
      .filter((p) => !p.id.startsWith('guest-') && !p.id.startsWith('bot-'))
      .filter((p) => p.points > me.points).length;
    return json(res, { ...me, rank: !horsClassement && me.points > 0 ? mieux + 1 : null });
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: http });
let nextConnectionId = 1;

wss.on('connection', (ws) => {
  ws.connectionId = nextConnectionId++;
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.t === 'join') {
      // 80, pas 32 : une salle solo encode l'identifiant du joueur dans son
      // code (`solo-<playerId>`), et un id de compte (`acc_` + 24 hex) ou un
      // UUID anonyme dépasse déjà 32 caractères à lui seul.
      const code = String(msg.room ?? '').slice(0, 80);
      const player = msg.player ?? {};
      if (!code || !player.id) return;

      const playerId = verifiedId(player.id, player.token);
      if (!playerId) {
        send(ws, { t: 'error', reason: 'identité invalide' });
        ws.close();
        return;
      }

      // Isolation des salles solo : le propriétaire se déduit du code
      // lui-même, aucun champ à faire confiance séparément. Un tiers qui
      // devine ou reçoit ce code ne peut pas rejoindre la partie de
      // quelqu'un d'autre — seul le même playerId (donc le même compte,
      // éventuellement depuis un autre appareil) le peut.
      if (code.startsWith('solo-') && code.slice(5) !== playerId) {
        send(ws, { t: 'error', reason: 'forbidden' });
        ws.close();
        return;
      }

      ws.room = code;
      ws.player = {
        id: playerId,
        name: String(player.name ?? 'Joueur').slice(0, 16),
        color: String(player.color ?? '#9CA3AF').slice(0, 9),
        activeCell: null,
      };

      if (!rooms.has(code)) {
        const room = emptyRoom();
        // Fixé à la création, jamais réattribué sur les joins suivants —
        // même logique que `hostId` juste en dessous.
        const demande = String(msg.mode ?? '');
        if (demande === 'solo' || demande === 'daily') room.mode = demande;
        rooms.set(code, room);
      }
      if (!sockets.has(code)) sockets.set(code, new Set());
      sockets.get(code).add(ws);

      const state = rooms.get(code);
      state.touchedAt = Date.now();
      // Le PREMIER arrivant devient hôte, et le reste : réattribuer ferait
      // hériter le rôle au moindre départ du créateur.
      if (state.hostId == null) state.hostId = ws.player.id;
      state.players[ws.player.id] = { name: ws.player.name, color: ws.player.color };

      // Le profil persistant reprend le pseudo courant : sans cela, un joueur
      // qui n'a jamais ouvert l'écran de profil apparaîtrait « Joueur » au
      // classement alors qu'il porte un nom en partie.
      const profile = getProfile(ws.player.id);
      if (profile.name === 'Joueur' || !profile.name) profile.name = ws.player.name;
      markDirty(); // nouvelle salle et/ou nouveau profil potentiellement créés

      send(ws, { t: 'welcome', connectionId: ws.connectionId });
      broadcastState(code);
      broadcastPresence(code);
      return;
    }

    // La file d'attente se traite AVANT le garde-fou de partie : on cherche
    // un adversaire précisément quand on n'est encore dans aucune partie.
    if (msg.t === 'queue') {
      // Il faut connaître le joueur AVANT de l'apparier, pour pouvoir
      // vérifier les blocages — contrairement à `join`, la file d'attente ne
      // rejoint aucune salle et n'identifiait donc personne jusqu'ici.
      const player = msg.player ?? {};
      if (player.id) {
        const playerId = verifiedId(player.id, player.token);
        if (!playerId) {
          send(ws, { t: 'error', reason: 'identité invalide' });
          return;
        }
        ws.player = {
          id: playerId,
          name: String(player.name ?? 'Joueur').slice(0, 16),
          color: String(player.color ?? '#9CA3AF').slice(0, 9),
          activeCell: null,
        };
      }
      if (!queue.includes(ws)) queue.push(ws);
      send(ws, { t: 'queued', position: queue.indexOf(ws) + 1 });
      tryMatch();
      return;
    }

    if (msg.t === 'unqueue') {
      leaveQueue(ws);
      return;
    }

    if (!ws.room || !rooms.has(ws.room)) return;
    const state = rooms.get(ws.room);
    state.touchedAt = Date.now();

    if (msg.t === 'presence') {
      ws.player.activeCell = msg.activeCell ?? null;
      broadcastPresence(ws.room);
      return;
    }

    const intent = INTENTS[msg.t];
    if (intent) {
      const changed = intent(state, msg, ws.player.id);
      markDirty();
      if (changed) broadcastState(ws.room);
    }
  });

  ws.on('close', () => {
    leaveQueue(ws);
    if (!ws.room) return;
    peers(ws.room).delete(ws);
    broadcastPresence(ws.room);
  });
});

// Sans ce battement, un client parti sans fermer proprement resterait compté
// comme présent — et bloquerait par exemple l'attente du « prêt » de tous.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

http.listen(PORT, () => console.log(`[ws] écoute sur :${PORT}`));

// Un hébergeur (Railway, Fly, ...) envoie SIGTERM avant de tuer le process à
// chaque redéploiement. Sans ce handler, Node quitte immédiatement et perd
// jusqu'à SNAPSHOT_EVERY_MS de parties, points et comptes non encore
// écrits en base.
async function arreterProprement() {
  console.log('[arrêt] instantané final avant extinction');
  await saveSnapshot(true); // force : même si rien n'a été marqué "dirty"
  process.exit(0);
}
process.on('SIGTERM', arreterProprement);
process.on('SIGINT', arreterProprement);
