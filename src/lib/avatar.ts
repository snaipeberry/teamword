/**
 * Réduction d'une photo en vignette carrée, côté client.
 *
 * Indispensable : une photo de téléphone pèse plusieurs mégaoctets, or le
 * profil transite par le WebSocket et finit dans l'instantané du serveur.
 * On redescend à 96 px et en JPEG de qualité modeste, ce qui donne quelques
 * kilo-octets — largement sous le plafond serveur de 40 Ko.
 */
const SIZE = 96;
const QUALITY = 0.7;

export async function fileToAvatar(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);

  // Recadrage centré : une photo verticale ne doit pas être écrasée.
  const cote = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - cote) / 2;
  const sy = (bitmap.height - cote) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas indisponible');
  ctx.drawImage(bitmap, sx, sy, cote, cote, 0, 0, SIZE, SIZE);
  bitmap.close();

  return canvas.toDataURL('image/jpeg', QUALITY);
}
