/**
 * Annonces : ce que l'application dit être en train de faire, ou d'avoir fait.
 *
 * Un seul mécanisme pour deux besoins qui n'en font qu'un. Un retour visible —
 * « Avatar enregistré », « Enregistrement impossible » — doit de toute façon
 * parvenir à quelqu'un qui ne voit pas l'écran ; les séparer aurait produit
 * deux vérités à maintenir, dont l'une aurait fini périmée.
 *
 * L'appelant n'a donc rien à savoir : `announce()` affiche ET énonce.
 */
export type TonAnnonce = 'info' | 'succes' | 'erreur';

export interface Annonce {
  /** Identité de l'annonce, pour rejouer l'animation d'un même texte répété. */
  id: number;
  texte: string;
  ton: TonAnnonce;
  /**
   * Énoncée, mais pas affichée.
   *
   * Pour ce qui revient sans arrêt — un mot trouvé toutes les quinze
   * secondes — et que l'écran raconte déjà par ailleurs : la cascade de
   * cases, le carillon, le rail qui pulse. Une pastille de plus n'y ajoutait
   * rien, et masquait le bas de la grille à chaque mot. Qui ne voit pas
   * l'écran, lui, n'a que cette phrase : elle reste.
   */
  discret: boolean;
}

type Ecouteur = (annonce: Annonce | null) => void;

const ecouteurs = new Set<Ecouteur>();
let compteur = 0;
let courante: Annonce | null = null;
let minuteur: ReturnType<typeof setTimeout> | undefined;

/** Une annonce reste lisible le temps de la lire, pas plus : elle raconte un
 *  événement passé, elle n'est pas un élément d'interface permanent. */
const DUREE_MS = 3200;
const DUREE_ERREUR_MS = 5200;

/**
 * Dit quelque chose au joueur.
 *
 * `erreur` passe en `aria-live="assertive"` (voir Announcer) : une action qui a
 * échoué doit interrompre, alors qu'une réussite peut attendre la fin de la
 * phrase en cours.
 */
export function announce(
  texte: string,
  ton: TonAnnonce = 'info',
  { discret = false }: { discret?: boolean } = {},
): void {
  compteur += 1;
  courante = { id: compteur, texte, ton, discret };
  ecouteurs.forEach((e) => e(courante));
  clearTimeout(minuteur);
  minuteur = setTimeout(() => {
    courante = null;
    ecouteurs.forEach((e) => e(null));
  }, ton === 'erreur' ? DUREE_ERREUR_MS : DUREE_MS);
}

export function onAnnounce(ecouteur: Ecouteur): () => void {
  ecouteurs.add(ecouteur);
  ecouteur(courante);
  return () => ecouteurs.delete(ecouteur);
}
