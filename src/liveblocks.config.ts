import type { LiveMap } from '@liveblocks/client';

// Module augmentation is how Liveblocks' current React API (LiveblocksProvider +
// plain hook imports) learns the shape of Presence/Storage, instead of the older
// createRoomContext<Presence, Storage>() generic pattern.
declare global {
  interface Liveblocks {
    Presence: {
      name: string;
      color: string;
      activeCell: string | null;
      /** Stable per-browser id (see lib/playerName.ts) — Liveblocks' own connectionId isn't stable across reconnects. */
      playerId: string;
    };
    Storage: {
      /**
       * Numéro de la grille en cours. Il détermine la graine, donc la grille
       * elle-même : il DOIT être partagé, sinon les deux joueurs
       * enchaîneraient sur des grilles différentes en fin de partie.
       *
       * C'est aussi pourquoi la room reste la même sur toute la session (elle
       * n'en dépend pas) — sinon il faudrait déjà connaître ce numéro pour
       * savoir quelle room rejoindre. Effet de bord souhaitable : les scores
       * se cumulent sur l'ensemble de la session.
       */
      round: number;
      letters: LiveMap<string, string>;
      /** playerId -> words found. Lives in Storage (not Presence) so it survives disconnects. */
      scores: LiveMap<string, number>;
      /** playerId -> nombre de lettres révélées, affiché pour que l'aide reste visible de tous. */
      hints: LiveMap<string, number>;
      /** cellId -> true pour les cases révélées : un mot terminé par une révélation ne rapporte pas de point. */
      revealed: LiveMap<string, boolean>;
      /**
       * playerId -> numéro de grille pour laquelle ce joueur s'est déclaré prêt.
       *
       * On stocke le NUMÉRO de grille plutôt qu'un booléen : le drapeau
       * s'invalide alors tout seul au passage à la grille suivante, sans avoir
       * à vider la map (et sans risque qu'un « prêt » périmé fasse sauter la
       * grille suivante dès son affichage).
       */
      ready: LiveMap<string, number>;
      /** playerId -> last-known display info, so the scoreboard still shows offline players who scored earlier. */
      players: LiveMap<string, { name: string; color: string }>;
    };
    /**
     * Réactions envoyées en direct. Volontairement éphémères : elles passent
     * par le canal de diffusion et ne sont jamais écrites dans Storage — une
     * réaction n'a de sens qu'au moment où elle est envoyée, et la persister
     * ferait réapparaître de vieux emojis à chaque reconnexion.
     */
    RoomEvent:
      | { type: 'reaction'; emoji: string; playerId: string; name: string }
      /**
       * Talkie-walkie. La voix est enregistrée pendant l'appui puis envoyée
       * découpée au relâchement : les événements de diffusion doivent rester
       * petits, un message de quelques secondes tient en 2 ou 3 morceaux.
       * `voice-start` sert seulement à afficher « untel parle » en direct.
       */
      | { type: 'voice-start'; playerId: string; name: string }
      | { type: 'voice-end'; playerId: string }
      | {
          type: 'voice-chunk';
          playerId: string;
          name: string;
          clipId: string;
          seq: number;
          total: number;
          data: string;
        };
  }
}

export {};
