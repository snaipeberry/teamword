import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { fetchFriends, friendAction, type FriendState, type FriendView } from '../lib/roomClient';
import { PRESENCE_PING_MS } from '../lib/presence';
import { playNoticeSound } from '../lib/sounds';
import { activePlayerId, currentSession } from '../lib/auth';
import { generateSessionCode } from '../lib/sessionCode';
import { screenShell } from '../lib/motion';
import { BackButton } from './BackButton';
import { Avatar } from './Avatar';

/**
 * Amis : ajouter, répondre aux demandes, voir qui est là.
 *
 * Une amitié est SYMÉTRIQUE et confirmée des deux côtés (voir les routes
 * `/friend` côté serveur) — pas d'abonnement à sens unique : la liste sert
 * aussi de classement restreint et de carnet d'invitations, deux choses qui
 * n'ont de sens qu'entre gens d'accord.
 *
 * Réservé aux comptes : l'identité d'un invité disparaît à chaque
 * rechargement (voir auth.ts), une relation ne survivrait pas à sa première
 * visite.
 */
const VIDE: FriendState = { friends: [], incoming: [], outgoing: [] };

/** « Vu il y a 2 h » — on reste volontairement grossier : la minute près
 *  n'apporte rien et donnerait l'impression d'être suivi à la trace. */
function vuIlYA(ts: number): string {
  if (!ts) return 'Jamais vu';
  const min = Math.floor((Date.now() - ts) / 60_000);
  if (min < 2) return 'À l’instant';
  if (min < 60) return `Vu il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Vu il y a ${h} h`;
  const j = Math.floor(h / 24);
  return j === 1 ? 'Vu hier' : `Vu il y a ${j} jours`;
}

export function FriendsScreen({ onClose }: { onClose: () => void }) {
  const moi = activePlayerId();
  const estInvite = !currentSession();
  const [etat, setEtat] = useState<FriendState>(VIDE);
  const [chargement, setChargement] = useState(!estInvite);
  const [pseudo, setPseudo] = useState('');
  const [message, setMessage] = useState<{ texte: string; erreur: boolean } | null>(null);
  const [enCours, setEnCours] = useState(false);
  // Des refs et non des états : la relecture périodique doit lire la valeur
  // du moment sans reconstruire son minuteur à chaque clic.
  const enCoursRef = useRef(false);
  const versionRef = useRef(0);

  useEffect(() => {
    if (estInvite) return;
    fetchFriends(moi)
      .then((suivant) => {
        setEtat(suivant);
        // Une demande en attente arrivait sans un mot : la pastille de
        // l'accueil apparaissait, et c'était tout. Un repère léger à
        // l'ouverture de l'écran — un repère, pas une alerte.
        if (suivant.incoming.length > 0) playNoticeSound();
      })
      .catch(() => setMessage({ texte: 'Liste indisponible', erreur: true }))
      .finally(() => setChargement(false));
  }, [moi, estInvite]);

  // Relecture périodique : les statuts « en ligne » et les demandes reçues
  // bougent pendant qu'on regarde l'écran. Le compteur d'actions empêche une
  // réponse partie AVANT un accept/refus d'écraser le résultat de celui-ci.
  useEffect(() => {
    if (estInvite) return;
    const relire = () => {
      if (document.visibilityState !== 'visible' || enCoursRef.current) return;
      const attendu = ++versionRef.current;
      fetchFriends(moi)
        .then((suivant) => {
          if (versionRef.current === attendu) setEtat(suivant);
        })
        .catch(() => {});
    };
    const minuteur = window.setInterval(relire, PRESENCE_PING_MS);
    document.addEventListener('visibilitychange', relire);
    return () => {
      window.clearInterval(minuteur);
      document.removeEventListener('visibilitychange', relire);
    };
  }, [moi, estInvite]);

  /** Chaque action renvoie l'état complet : rien à recharger derrière. */
  const agir = async (
    action: 'request' | 'accept' | 'decline' | 'cancel' | 'remove',
    cible: { username?: string; playerId?: string },
    succes?: string,
  ) => {
    enCoursRef.current = true;
    versionRef.current++;
    setEnCours(true);
    try {
      const suivant = await friendAction(moi, action, cible);
      setEtat(suivant);
      if (suivant.error) setMessage({ texte: suivant.error, erreur: true });
      else if (succes) setMessage({ texte: succes, erreur: false });
    } catch {
      setMessage({ texte: 'Action impossible pour le moment', erreur: true });
    } finally {
      enCoursRef.current = false;
      setEnCours(false);
    }
  };

  const envoyer = async () => {
    const nom = pseudo.trim();
    if (!nom) return;
    await agir('request', { username: nom }, `Demande envoyée à ${nom}.`);
    setPseudo('');
  };

  // Inviter : on ouvre une partie privée et on atterrit dans le salon, où le
  // lien se partage. Une vraie invitation poussée à l'ami demanderait un
  // canal de notification que l'app n'a pas — le socket n'est ouvert qu'une
  // fois dans une partie.
  const inviter = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('session', generateSessionCode());
    for (const p of ['daily', 'bot', 'solo']) url.searchParams.delete(p);
    window.location.href = url.toString();
  };

  if (estInvite) {
    return (
      <div className={screenShell}>
        <BackButton onClick={onClose} />
        <h1 className="mt-1.5 shrink-0 font-display text-[30px] leading-none text-organic-text">Amis</h1>
        <p className="mt-4 text-[13px] leading-[1.5] text-organic-neutral-700">
          Les amis sont rattachés à un compte : votre identité d’invité change à chaque visite, une relation ne
          survivrait pas.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 self-start rounded-full bg-organic-accent-500 px-5 py-2.5 font-display text-[14px] text-organic-bg active:bg-organic-accent-600"
        >
          Créer un compte
        </button>
      </div>
    );
  }

  const ligne = (a: FriendView, actions: React.ReactNode, accent = false) => (
    <div
      key={a.id}
      className={`flex items-center gap-2.5 rounded-[18px] border px-3 py-2 ${
        accent
          ? 'border-organic-accent-200 bg-organic-accent-100'
          : 'border-organic-neutral-300 bg-organic-neutral-100'
      }`}
    >
      <span className={a.online ? '' : 'opacity-45'}>
        <Avatar name={a.name} color="#A19786" src={a.avatar} size={34} square />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold text-organic-text">{a.name}</span>
        <span
          className={`block text-[10.5px] font-bold ${
            a.online ? 'text-organic-accent2-800' : 'text-organic-neutral-600'
          }`}
        >
          {a.online ? 'En ligne' : vuIlYA(a.lastSeenAt)}
        </span>
      </span>
      {actions}
    </div>
  );

  return (
    <div className={`${screenShell} overflow-y-auto`}>
      <BackButton onClick={onClose} />
      <h1 className="mt-1.5 shrink-0 font-display text-[30px] leading-none text-organic-text">Amis</h1>

      {/* Ajout par pseudo EXACT : pas de recherche floue, qui exposerait la
          liste des comptes à qui tape trois lettres au hasard. */}
      <div className="mt-3.5 flex shrink-0 items-center gap-2 rounded-full border border-organic-neutral-300 bg-organic-neutral-100 py-1.5 pl-3.5 pr-1.5">
        <input
          value={pseudo}
          onChange={(e) => {
            setPseudo(e.target.value);
            setMessage(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void envoyer();
            e.stopPropagation();
          }}
          autoCapitalize="none"
          autoComplete="off"
          placeholder="Pseudo de votre ami"
          aria-label="Pseudo de votre ami"
          className="min-w-0 flex-1 bg-transparent text-[13.5px] font-bold text-organic-text placeholder:font-medium placeholder:text-organic-neutral-500 focus:outline-none"
        />
        {pseudo && (
          <button
            type="button"
            onClick={() => {
              setPseudo('');
              setMessage(null);
            }}
            aria-label="Effacer"
            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-organic-neutral-600 active:bg-organic-neutral-200"
          >
            ⌫
          </button>
        )}
        <button
          type="button"
          onClick={() => void envoyer()}
          disabled={!pseudo.trim() || enCours}
          className={`shrink-0 rounded-full px-3.5 py-1.5 font-display text-[12.5px] ${
            pseudo.trim() && !enCours
              ? 'bg-organic-accent-500 text-organic-bg active:bg-organic-accent-600'
              : 'cursor-default bg-organic-neutral-300 text-organic-neutral-600'
          }`}
        >
          Ajouter
        </button>
      </div>
      {/* Région live en PLACE plutôt qu'annonce globale : le message
          commente la barre d'ajout juste au-dessus, le déporter ailleurs
          lui ferait perdre son contexte. */}
      <p
        role="status"
        aria-live="polite"
        className={`mt-2 shrink-0 text-[11.5px] font-bold ${
          message?.erreur ? 'text-organic-accent-700' : message ? 'text-organic-accent2-800' : 'text-organic-neutral-600'
        }`}
      >
        {message?.texte ?? 'Le pseudo doit être exact.'}
      </p>

      {chargement && (
        <div className="mt-4 flex flex-col gap-1.5" aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-[50px] animate-pulse rounded-[18px] bg-organic-neutral-100" />
          ))}
        </div>
      )}

      {etat.incoming.length > 0 && (
        <div className="mt-4 shrink-0">
          <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.1em] text-organic-accent-700">
            Demandes reçues · {etat.incoming.length}
          </p>
          <div className="flex flex-col gap-[7px]">
            {etat.incoming.map((a) =>
              ligne(
                a,
                <>
                  <button
                    type="button"
                    onClick={() => void agir('decline', { playerId: a.id })}
                    disabled={enCours}
                    aria-label={`Refuser ${a.name}`}
                    className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-organic-neutral-400 text-[13px] font-bold text-organic-neutral-700 active:bg-organic-neutral-200"
                  >
                    ✕
                  </button>
                  <button
                    type="button"
                    onClick={() => void agir('accept', { playerId: a.id }, `${a.name} fait maintenant partie de vos amis.`)}
                    disabled={enCours}
                    className="shrink-0 rounded-full bg-organic-accent-500 px-3.5 py-[7px] font-display text-[12px] text-organic-bg active:bg-organic-accent-600"
                  >
                    Accepter
                  </button>
                </>,
                true,
              ),
            )}
          </div>
        </div>
      )}

      {etat.outgoing.length > 0 && (
        <div className="mt-4 shrink-0">
          <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.1em] text-organic-neutral-600">
            Demandes envoyées
          </p>
          <div className="flex flex-wrap gap-1.5">
            {etat.outgoing.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => void agir('cancel', { playerId: a.id }, `Demande à ${a.name} annulée.`)}
                disabled={enCours}
                title="Annuler la demande"
                className="rounded-full bg-organic-surface px-3 py-[7px] text-[11px] font-bold text-organic-neutral-700 active:bg-organic-neutral-300"
              >
                {a.name} · en attente ✕
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="mb-2 mt-[18px] shrink-0 text-[10.5px] font-bold uppercase tracking-[0.1em] text-organic-neutral-600">
        Vos amis · {etat.friends.length}
      </p>
      {!chargement && etat.friends.length === 0 && (
        <p className="shrink-0 text-[12.5px] leading-[1.5] text-organic-neutral-600">
          Personne pour l’instant. Ajoutez quelqu’un par son pseudo ci-dessus — il devra accepter.
        </p>
      )}
      <div className="flex flex-col gap-[7px] pb-3.5">
        {etat.friends.map((a) =>
          ligne(
            a,
            <>
              <motion.button
                type="button"
                whileTap={{ scale: 0.95 }}
                onClick={inviter}
                className={`shrink-0 rounded-full px-3 py-[7px] text-[11px] font-bold ${
                  a.online
                    ? 'bg-organic-accent2-300 text-organic-accent2-900'
                    : 'border border-organic-neutral-400 text-organic-neutral-700'
                }`}
              >
                Inviter
              </motion.button>
              {/* Absent de la maquette, mais indispensable : sans lui une
                  relation ne peut jamais être défaite autrement qu'en
                  bloquant la personne. */}
              <button
                type="button"
                onClick={() => void agir('remove', { playerId: a.id }, `${a.name} retiré de vos amis.`)}
                disabled={enCours}
                aria-label={`Retirer ${a.name} de vos amis`}
                className="shrink-0 px-1 text-[13px] font-bold text-organic-neutral-500 active:text-organic-accent-700"
              >
                ✕
              </button>
            </>,
          ),
        )}
      </div>
    </div>
  );
}
