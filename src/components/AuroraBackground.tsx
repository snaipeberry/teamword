/**
 * Fond plein, sans décoration — Organic n'a pas de dégradé/blobs (contraste
 * avec l'ancien thème aurora). Composant gardé tel quel (nom compris) pour
 * ne pas retoucher son unique site d'appel (App.tsx) ; son contenu, lui, a
 * changé du tout au tout.
 */
export function AuroraBackground() {
  return <div aria-hidden="true" className="fixed inset-0 -z-10 bg-organic-bg" />;
}
