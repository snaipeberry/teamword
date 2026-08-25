import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Avatar } from './Avatar';
import { AVATAR_PRESETS } from '../lib/avatarPresets';
import { fetchBlocked, fetchProfile, unblockPlayer, updateProfile, type Profile as ProfileData } from '../lib/roomClient';
import { activePlayerId, activePlayerName, currentSession, deleteAccount, logout } from '../lib/auth';
import { AuthScreen } from './Auth';
import { screenClassName, screenTransition, screenVariants } from '../lib/motion';

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
    <div className="flex min-h-0 w-full max-w-[380px] flex-1 flex-col items-center gap-4 overflow-y-auto px-5 py-6">
      <h1 className="font-display text-xl text-organic-text">Profil</h1>

      <div className="flex w-full flex-col items-center gap-3 rounded-[28px] border border-organic-divider bg-organic-neutral-100 p-5">
        <button
          type="button"
          onClick={() => setChoixAvatarOuvert((v) => !v)}
          aria-expanded={choixAvatarOuvert}
          className="relative active:scale-95"
        >
          <Avatar name={name} color="#D67F48" src={profile?.avatar} size={84} />
          <span className="absolute -bottom-1 -right-1 rounded-full bg-organic-bg px-1.5 py-0.5 text-[10px] font-bold text-organic-accent-700 shadow-sm">
            ✎
          </span>
        </button>

        {choixAvatarOuvert && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="grid w-full grid-cols-5 gap-2"
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

        {/* Nom fixe (pseudo du compte, ou nom généré pour l'invité) : plus
            aucune UI ne permet de le changer, voir auth.ts. */}
        <p className="font-display text-[15px] text-organic-text">{name}</p>

        {profile && (
          <p className="text-center text-[12px] font-bold text-organic-accent-700">{profile.title}</p>
        )}
      </div>

      {profile && (
        <>
          <div className="grid w-full grid-cols-4 gap-2">
            {[
              ['Points', profile.points],
              ['Mots', profile.words],
              ['Victoires', profile.wins],
              ['Rang', profile.rank ? `#${profile.rank}` : '—'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[20px] border border-organic-divider bg-organic-neutral-100 p-2 text-center">
                <p className="font-display text-[15px] text-organic-text">{value}</p>
                <p className="text-[9px] font-bold uppercase tracking-wide text-organic-neutral-500">{label}</p>
              </div>
            ))}
          </div>

          <div className="w-full">
            <p className="mb-1.5 text-center text-[11px] font-bold uppercase tracking-wider text-organic-neutral-500">
              Médailles ({profile.medals.length}/7)
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {profile.medals.length === 0 && (
                <p className="text-[12px] text-organic-neutral-500">Aucune pour l’instant — jouez une partie !</p>
              )}
              {profile.medals.map((m) => (
                <motion.span
                  key={m.id}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="rounded-full border border-organic-divider bg-organic-neutral-100 px-2.5 py-1 text-[11px] font-bold text-organic-text"
                  title={m.label}
                >
                  {m.icon} {m.label}
                </motion.span>
              ))}
            </div>
          </div>
        </>
      )}

      {bloques.length > 0 && (
        <div className="w-full">
          <p className="mb-1.5 text-center text-[11px] font-bold uppercase tracking-wider text-organic-neutral-500">
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

      {erreur && <p className="text-[11px] font-bold text-organic-accent-700">{erreur}</p>}

      {session ? (
        <div className="flex w-full flex-col items-center gap-1.5">
          <p className="text-[11px] text-organic-neutral-500">
            Connecté en tant que <strong className="text-organic-text">{session.username}</strong>
          </p>
          <button
            type="button"
            onClick={() => void logout().then(() => window.location.reload())}
            className="text-[12px] font-bold text-organic-neutral-500 underline underline-offset-2"
          >
            Se déconnecter
          </button>
          <button
            type="button"
            onClick={() => void supprimerCompte()}
            className={`mt-1 rounded-full px-3 py-1 text-[11px] font-bold ${
              suppressionConfirmee ? 'bg-organic-accent-700 text-organic-bg' : 'text-organic-accent-700/70'
            }`}
          >
            {suppressionConfirmee ? 'Confirmer la suppression du compte' : 'Supprimer mon compte'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAuthOuvert(true)}
          className="w-full rounded-full border border-organic-divider bg-organic-neutral-100 py-2.5 font-display text-[13px] text-organic-text active:scale-95"
        >
          Créer un compte / se connecter
          <span className="mt-0.5 block text-[10px] font-medium text-organic-neutral-500">
            Pour retrouver sa progression sur un autre appareil
          </span>
        </button>
      )}

      <button
        type="button"
        onClick={onClose}
        className="rounded-full bg-organic-neutral-200 px-5 py-2.5 font-display text-[14px] text-organic-text active:scale-95"
      >
        Retour
      </button>
    </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
