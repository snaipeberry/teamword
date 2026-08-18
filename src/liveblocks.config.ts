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
      letters: LiveMap<string, string>;
      /** playerId -> words found. Lives in Storage (not Presence) so it survives disconnects. */
      scores: LiveMap<string, number>;
      /** playerId -> last-known display info, so the scoreboard still shows offline players who scored earlier. */
      players: LiveMap<string, { name: string; color: string }>;
    };
  }
}

export {};
