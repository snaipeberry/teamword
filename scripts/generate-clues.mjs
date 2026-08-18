#!/usr/bin/env node
// Bulk-drafts short mots-fléchés-style clues for a French word list using the
// Claude API. Output is a JSON list of { word, clue } pairs for human review —
// it does NOT lay out a grid. Grid layout (placing words so they interlock) is
// a separate constraint-satisfaction problem; see the generators linked in
// README.md for that.
//
// Requires Node 18+ (uses global fetch). Usage:
//
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/generate-clues.mjs \
//     --words scripts/words.fr.txt --out scripts/clues.fr.json --limit 200
//
// Word list: a plain text file, one French word per line. Generate one with:
//   npm install --no-save an-array-of-french-words
//   node -e "require('node:fs').writeFileSync('scripts/words.fr.txt', require('an-array-of-french-words').join('\n'))"

import { readFile, writeFile } from 'node:fs/promises';

function getArg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : fallback;
}

const wordsPath = getArg('words', 'scripts/words.fr.txt');
const outPath = getArg('out', 'scripts/clues.fr.json');
const limit = Number(getArg('limit', '100'));
const minLength = Number(getArg('minLength', '3'));
const maxLength = Number(getArg('maxLength', '9'));
const batchSize = Number(getArg('batchSize', '20'));

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('Set ANTHROPIC_API_KEY before running this script.');
  process.exit(1);
}

async function loadWords() {
  let raw;
  try {
    raw = await readFile(wordsPath, 'utf8');
  } catch {
    console.error(
      `Could not read ${wordsPath}.\n\n` +
        'Generate a word list first, e.g.:\n' +
        '  npm install --no-save an-array-of-french-words\n' +
        '  node -e "require(\'node:fs\').writeFileSync(\'scripts/words.fr.txt\', require(\'an-array-of-french-words\').join(\'\\n\'))"',
    );
    process.exit(1);
  }
  const words = raw
    .split('\n')
    .map((w) => w.trim().toUpperCase())
    .filter((w) => /^[A-ZÀ-Ÿ]+$/.test(w) && w.length >= minLength && w.length <= maxLength);
  return [...new Set(words)].slice(0, limit);
}

async function draftClues(batch) {
  const prompt = [
    'Tu écris des définitions courtes pour des mots fléchés français.',
    'Pour chaque mot ci-dessous, donne UNE définition courte (2 à 5 mots, sans ponctuation finale),',
    "dans le style des mots fléchés : pas une phrase complète, jamais le mot lui-même, pas un synonyme trivial à une lettre près.",
    'Réponds UNIQUEMENT avec un objet JSON de la forme {"MOT": "définition", ...}, un mot par entrée, rien d\'autre — pas de texte avant ou après.',
    '',
    'Mots :',
    batch.join(', '),
  ].join('\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text ?? '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Could not find JSON in model response:\n${text}`);
  return JSON.parse(jsonMatch[0]);
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

async function main() {
  const words = await loadWords();
  if (words.length === 0) {
    console.error('No words matched the length filters — nothing to do.');
    return;
  }
  console.log(`Drafting clues for ${words.length} words in batches of ${batchSize}…`);

  const results = {};
  for (const batch of chunk(words, batchSize)) {
    const clues = await draftClues(batch);
    Object.assign(results, clues);
    console.log(`  +${Object.keys(clues).length} clues (${Object.keys(results).length}/${words.length})`);
  }

  const entries = Object.entries(results).map(([word, clue]) => ({ word, clue }));
  await writeFile(outPath, JSON.stringify(entries, null, 2), 'utf8');
  console.log(`Wrote ${entries.length} clues to ${outPath}.`);
  console.log("Review these before shipping — an LLM draft is a starting point, not published copy.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
