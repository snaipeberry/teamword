import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Avatar } from './Avatar';
import { NameField } from './NameField';
import { fileToAvatar } from '../lib/avatar';
import { fetchProfile, type Profile as ProfileData } from '../lib/roomClient';
import { getOrCreatePlayerName, setPlayerName } from '../lib/playerName';
import { activePlayerId, currentSession, logout } from '../lib/auth';
import { AuthScreen } from './Auth';

/**
 * Profil du joueur : pseudo, photo, statistiques et médailles.
 *
 * Le profil est servi par le serveur temps réel, qui le conserve entre les
 * parties. Les médailles y sont DÉRIVÉES des compteurs à chaque lecture :
 * en ajouter une plus tard sera rétroactif, sans migration.
 */
export function ProfileScreen({ onClose }: { onClose: () => void }) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [name, setName] = useState(getOrCreatePlayerName);
  const [erreur, setErreur] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState(currentSession);
  const [authOuvert, setAuthOuvert] = useState(false);
  const id = activePlayerId();

  const recharger = () => fetchProfile(id).then(setProfile).catch(() => setErreur('Profil indisponible'));
  useEffect(() => {
    void recharger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Le profil vit sur le serveur : on le met à jour par une requête HTTP
  // plutôt que par le socket, l'écran étant accessible hors partie.
  const envoyer = async (patch: { name?: string; avatar?: string | null }) => {
    await fetch(`/rt/profile-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    }).catch(() => setErreur('Enregistrement impossible'));
    await recharger();
  };

  const choisirPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      await envoyer({ avatar: await fileToAvatar(file) });
    } catch {
      setErreur('Image illisible');
    }
  };

  if (authOuvert) {
    return (
      <AuthScreen
        onClose={() => setAuthOuvert(false)}
        onDone={(s) => {
          setSession(s);
          setAuthOuvert(false);
          // Le profil suit désormais le compte : on recharge tout.
          window.location.reload();
        }}
      />
    );
  }

  return (
    <div className="flex min-h-0 w-full max-w-[380px] flex-1 flex-col items-center justify-center gap-4 px-5">
      <h1 className="font-display text-xl font-bold text-white/90">Profil</h1>

      <div className="flex w-full flex-col items-center gap-3 rounded-3xl border border-white/20 bg-white/10 p-5 backdrop-blur-md">
        <button type="button" onClick={() => fileRef.current?.click()} className="relative active:scale-95">
          <Avatar name={name} color="#8E7CFF" src={profile?.avatar} size={84} />
          <span className="absolute -bottom-1 -right-1 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-aurora-violet">
            ✎
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void choisirPhoto(e.target.files?.[0])}
        />

        <NameField
          value={name}
          onChange={(n) => {
            const clean = setPlayerName(n);
            setName(clean);
            void envoyer({ name: clean });
          }}
        />

        {profile && (
          <p className="text-center text-[12px] font-bold text-amber-200">{profile.title}</p>
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
              <div key={label} className="rounded-2xl border border-white/15 bg-white/10 p-2 text-center">
                <p className="font-display text-[15px] font-bold text-white">{value}</p>
                <p className="text-[9px] font-bold uppercase tracking-wide text-white/45">{label}</p>
              </div>
            ))}
          </div>

          <div className="w-full">
            <p className="mb-1.5 text-center text-[11px] font-bold uppercase tracking-wider text-white/50">
              Médailles ({profile.medals.length}/7)
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {profile.medals.length === 0 && (
                <p className="text-[12px] text-white/40">Aucune pour l’instant — jouez une partie !</p>
              )}
              {profile.medals.map((m) => (
                <motion.span
                  key={m.id}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="rounded-full border border-white/20 bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white"
                  title={m.label}
                >
                  {m.icon} {m.label}
                </motion.span>
              ))}
            </div>
          </div>
        </>
      )}

      {erreur && <p className="text-[11px] font-bold text-rose-300">{erreur}</p>}

      {session ? (
        <div className="flex w-full flex-col items-center gap-1.5">
          <p className="text-[11px] text-white/50">
            Connecté en tant que <strong className="text-white/80">{session.username}</strong>
          </p>
          <button
            type="button"
            onClick={() => void logout().then(() => window.location.reload())}
            className="text-[12px] font-bold text-white/50 underline underline-offset-2"
          >
            Se déconnecter
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAuthOuvert(true)}
          className="w-full rounded-full border border-white/30 bg-white/15 py-2.5 font-display text-[13px] font-bold text-white active:scale-95"
        >
          🔐 Créer un compte / se connecter
          <span className="mt-0.5 block text-[10px] font-medium text-white/50">
            Pour retrouver sa progression sur un autre appareil
          </span>
        </button>
      )}

      <button
        type="button"
        onClick={onClose}
        className="rounded-full bg-white/20 px-5 py-2.5 font-display text-[14px] font-bold text-white active:scale-95"
      >
        Retour
      </button>
    </div>
  );
}
