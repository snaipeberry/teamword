import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Avatar } from './Avatar';
import { AVATAR_PRESETS } from '../lib/avatarPresets';
import { fetchBlocked, fetchProfile, unblockPlayer, updateProfile, type Profile as ProfileData } from '../lib/roomClient';
import { activePlayerId, activePlayerName, currentSession, deleteAccount, logout } from '../lib/auth';
import { AuthScreen } from './Auth';
import { screenClassName, screenShell, screenTransition, screenVariants } from '../lib/motion';
import { BackButton } from './BackButton';
import { MedalIcon } from './MedalIcon';

/**
 * Profil du joueur : pseudo, photo, statistiques et médailles.
 *
 * Le profil est servi par le serveur temps réel, qui le conserve entre les
 * parties. Les médailles y sont DÉRIVÉES des compteurs à chaque lecture :
 * en ajouter une plus tard sera rétroactif, sans migration.
 */
export function ProfileScreen({ onClose }: { onClose: () => void }) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const name = activePlayerName();
  const [erreur, setErreur] = useState<string | null>(null);
  const [choixAvatarOuvert, setChoixAvatarOuvert] = useState(false);
  const [session, setSession] = useState(currentSession);
  const [authOuvert, setAuthOuvert] = useState(false);
  const [bloques, setBloques] = useState<{ id: string; name: string }[]>([]);
  const [suppressionConfirmee, setSuppressionConfirmee] = useState(false);
  const id = activePlayerId();

  const rechargerBloques = (ids: string[]) => {
    Promise.all(ids.map((pid) => fetchProfile(pid).then((p) => ({ id: pid, name: p.name })).catch(() => ({ id: pid, name: pid }))))
      .then(setBloques);
  };

  const recharger = () => fetchProfile(id).then(setProfile).catch(() => setErreur('Profil indisponible'));
  useEffect(() => {
    void recharger();
    fetchBlocked(id).then(rechargerBloques).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const debloquer = async (playerId: string) => {
    const restants = await unblockPlayer(id, playerId).catch(() => bloques.map((b) => b.id));
    rechargerBloques(restants);
  };

  // Le profil vit sur le serveur : on le met à jour par une requête HTTP
  // plutôt que par le socket, l'écran étant accessible hors partie. Seule la
  // photo passe encore par ici — le nom est fixe, voir auth.ts.
  const choisirAvatar = async (presetId: string) => {
    setChoixAvatarOuvert(false);
    await updateProfile(id, { avatar: presetId }).catch(() => setErreur('Enregistrement impossible'));
    await recharger();
  };

  const supprimerCompte = async () => {
    if (!suppressionConfirmee) {
      setSuppressionConfirmee(true);
      return;
    }
    const res = await deleteAccount();
    if (res === true) window.location.reload();
    else setErreur(res);
  };

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={authOuvert ? 'auth' : 'profil'}
        variants={screenVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={screenTransition}
        className={screenClassName}
      >
        {authOuvert ? (
          <AuthScreen
            onClose={() => setAuthOuvert(false)}
            onDone={(s) => {
              setSession(s);
              setAuthOuvert(false);
              // Le profil suit désormais le compte : on recharge tout.
              window.location.reload();
            }}
          />
        ) : (
    <div className={`${screenShell} overflow-y-auto`}>
      <BackButton onClick={onClose} />

      {/* Tout le contenu dépendant du profil apparaît D'UN SEUL COUP une
          fois chargé — un en-tête qui s'affiche puis des statistiques qui
          « popent » une seconde après donne une impression d'écran cassé.
          Le bouton retour reste seul en dehors : la navigation ne doit pas
          attendre le réseau. */}
      {!profile ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <motion.div
            animate={{ scale: [1, 1.25, 1], opacity: [0.5, 1, 0.5] }}
            transition={{ repeat: Infinity, duration: 1.1, ease: 'easeInOut' }}
            className="h-3 w-3 rounded-full bg-organic-accent-500"
          />
          <p className="text-sm font-semibold text-organic-neutral-600">Chargement du profil…</p>
        </div>
      ) : (
        <>
          {/* En-tête : photo à gauche, nom et statut à droite (maquette
              Organic) — plus compact que la grande carte centrée, et laisse
              la place aux statistiques sans faire défiler. */}
          <div className="mt-2.5 flex items-center gap-3.5">
            <button
              type="button"
              onClick={() => setChoixAvatarOuvert((v) => !v)}
              aria-expanded={choixAvatarOuvert}
              aria-label="Changer de photo"
              className="relative shrink-0 active:scale-95"
            >
              <Avatar name={name} color="#D67F48" src={profile.avatar} size={66} />
              <span className="absolute -bottom-1 -right-1 rounded-full bg-organic-bg px-1.5 py-0.5 text-[10px] font-bold text-organic-accent-700 shadow-sm">
                ✎
              </span>
            </button>
            <div className="min-w-0">
              {/* Nom fixe (pseudo du compte, ou nom généré pour l'invité) :
                  plus aucune UI ne permet de le changer, voir auth.ts. */}
              <h1 className="truncate font-display text-[26px] leading-[1.05] text-organic-text">{name}</h1>
              <p className="mt-0.5 text-[12px] font-bold uppercase tracking-[0.06em] text-organic-accent-700">
                {profile.title} · {profile.tier.icon} {profile.tier.label}
              </p>
            </div>
          </div>

          {choixAvatarOuvert && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 grid w-full grid-cols-5 gap-2"
            >
              {AVATAR_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => void choisirAvatar(p.id)}
                  aria-label={p.id}
                  className="active:scale-90"
                >
                  <span
                    className="flex h-11 w-11 items-center justify-center rounded-full text-xl"
                    style={{ backgroundColor: p.color }}
                  >
                    {p.emoji}
                  </span>
                </button>
              ))}
            </motion.div>
          )}

          {/* 2 colonnes plutôt que 4 : les nombres et leurs libellés tiennent
              sans être tronqués ni réduits à 9 px. Points/Rang (classement
              multijoueur) et Palier (progression solo) rejoignent les trois
              compteurs bruts — auparavant seuls ces trois-là étaient visibles
              ici, points et palier n'apparaissaient nulle part. */}
          <div className="mt-[18px] grid w-full grid-cols-2 gap-2">
            {[
              ['Points', profile.points],
              ['Rang', profile.rank ? `#${profile.rank}` : '—'],
              ['Palier', `${profile.tier.icon} ${profile.tier.label}`],
              ['Grilles', profile.games],
              ['Mots trouvés', profile.words],
              ['Victoires', profile.wins],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[20px] bg-organic-surface px-4 py-3.5">
                <p className="font-display text-[23px] tabular-nums text-organic-text">{value}</p>
                <p className="mt-0.5 text-[11px] font-bold uppercase tracking-[0.05em] text-organic-neutral-600">
                  {label}
                </p>
              </div>
            ))}
          </div>

          <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-[0.1em] text-organic-neutral-600">
            Médailles ({profile.medals.length}/{profile.allMedals.length})
          </p>
          <div className="flex flex-wrap gap-[7px]">
            {/* Catalogue COMPLET : les verrouillées restent visibles, en
                grisé, pour qu'on sache ce qui existe encore à débloquer —
                avant, une médaille non obtenue n'apparaissait tout
                simplement pas. Les deux premières du catalogue reprennent
                les teintes de la maquette (sauge, terre cuite) quand
                obtenues ; les suivantes restent neutres. */}
            {profile.allMedals.map((m, i) => (
              <motion.span
                key={m.id}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold ${
                  m.earned
                    ? i === 0
                      ? 'bg-organic-accent2-300 text-organic-accent2-900'
                      : i === 1
                        ? 'bg-organic-accent-200 text-organic-accent-800'
                        : 'bg-organic-surface text-organic-neutral-800'
                    : 'bg-organic-neutral-100 text-organic-neutral-500 opacity-70'
                }`}
                title={m.earned ? `${m.label} — obtenue : ${m.reason}` : `Verrouillée — condition : ${m.reason}`}
              >
                <MedalIcon id={m.id} className="h-[15px] w-[15px] shrink-0" />
                {m.label}
                {/* La raison ne s'affiche que pour les obtenues : pour les
                    verrouillées, on ne veut qu'un aperçu (icône + nom), la
                    condition reste dans l'infobulle plutôt qu'à l'écran. */}
                {m.earned && <span className="font-medium opacity-70">· {m.reason}</span>}
              </motion.span>
            ))}
          </div>
        </>
      )}

      {bloques.length > 0 && (
        <div className="mt-5 w-full">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-organic-neutral-600">
            Joueurs bloqués ({bloques.length})
          </p>
          <div className="flex flex-col gap-1">
            {bloques.map((b) => (
              <div key={b.id} className="flex items-center justify-between rounded-full bg-organic-neutral-100 py-1 pl-3 pr-1">
                <span className="truncate text-[12px] font-bold text-organic-text">{b.name}</span>
                <button
                  type="button"
                  onClick={() => void debloquer(b.id)}
                  className="shrink-0 rounded-full bg-organic-neutral-200 px-2.5 py-1 text-[10px] font-bold text-organic-text active:scale-95"
                >
                  Débloquer
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {erreur && <p className="mt-3 text-[11px] font-bold text-organic-accent-700">{erreur}</p>}

      {/* Gestion du compte en pied de page : ce sont des réglages, pas le
          contenu de l'écran — ils ne doivent pas s'intercaler entre les
          statistiques et les médailles. */}
      <div className="mt-auto w-full shrink-0 border-t border-organic-divider pb-3.5 pt-3.5">
        {session ? (
          <div className="flex flex-col items-center gap-1.5">
            <p className="text-[11px] text-organic-neutral-600">
              Connecté en tant que <strong className="text-organic-text">{session.username}</strong>
            </p>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => void logout().then(() => window.location.reload())}
                className="text-[12px] font-bold text-organic-neutral-600 underline underline-offset-2"
              >
                Se déconnecter
              </button>
              <button
                type="button"
                onClick={() => void supprimerCompte()}
                className={`rounded-full px-3 py-1 text-[11px] font-bold ${
                  suppressionConfirmee ? 'bg-organic-accent-700 text-organic-bg' : 'text-organic-accent-700/70'
                }`}
              >
                {suppressionConfirmee ? 'Confirmer la suppression' : 'Supprimer mon compte'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAuthOuvert(true)}
            className="w-full rounded-full border border-organic-neutral-300 bg-organic-neutral-100 py-2.5 font-display text-[13px] text-organic-text active:scale-95"
          >
            Créer un compte / se connecter
            <span className="mt-0.5 block text-[10px] font-medium text-organic-neutral-600">
              Pour retrouver sa progression sur un autre appareil
            </span>
          </button>
        )}
      </div>
    </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
