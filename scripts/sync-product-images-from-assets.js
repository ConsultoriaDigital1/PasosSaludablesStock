import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSchema, sql } from '../src/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const assetRoot = path.join(workspaceRoot, 'public', 'assets');
const ignoredDirectories = new Set(['web-search']);
const supportedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']);
const minimumAutoScore = 0.75;
const minimumGapScore = 0.05;
const stopwords = new Set([
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'y',
  'en',
  'con',
  'sin',
  'para',
  'por',
  'tipo',
  'paquetes',
  'paquete',
  'aprox',
  'aproximado',
  'aproximada',
  'aproximados',
  'aproximadas',
  'unidad',
  'unid',
  'kg',
  'gr',
  'gramos',
  'gramo',
  'ml',
  'litro',
  'litros',
  'p',
  'organico',
  'organica'
]);
const replacementMap = new Map([
  ['dolccegusto', 'dolce gusto'],
  ['dolcegusto', 'dolce gusto'],
  ['espressointenso', 'espresso intenso'],
  ['py', 'paraguay'],
  ['buffala', 'bufala'],
  ['lingua', 'lengua'],
  ['sweet & salty', 'sweet and salty'],
  ['sweet salty', 'sweet and salty'],
  ['rebozados', 'rebozador'],
  ['galletitas', 'galletita'],
  ['huevos libres de jaula', 'huevos libres'],
  ['jamonnatural', 'jamon natural'],
  ['p kg', 'kg'],
  ['c/', 'con ']
]);
const manualMatches = new Map([
  ['chipita bastoncitos lievito', 'PasosSaludables - imagenes productos/CHIPITA BASTONCITO Lievito 45gr.png'],
  ['grasa de chancho kg viene en frasco de 350 450gr', 'PasosSaludables - imagenes productos/Grasa de chancho 500gr aprox.jpeg'],
  ['caldo de hueso guru 600ml', 'PasosSaludables - imagenes productos/Caldo de Huesos GURU 600ml.jpeg'],
  ['pate de ternera sin conservantes kg 300gr aprox', 'CARNEYDERIVADOS/Pate Sin Conservantes Kg.jpeg'],
  ['almendra y 500 gramos', 'FRUTOSSECOS/ALMENDRAS 500gr.png'],
  ['jamon cocido natural kg paquetes de 250 300gr', 'CARNEYDERIVADOS/jamonnatural.jpeg'],
  ['salame tipo peperoni envasado 250gr', 'PasosSaludables - imagenes productos/SALAME TIPO PEPPERONI Por unidad (500gr. aprox).png'],
  ['salame tipo tandil envasado 150gr', 'PasosSaludables - imagenes productos/SALAME TIPO TANDIL Por unidad (aprox. 500gr).png'],
  ['salame tipo tandil envasado 250gr', 'PasosSaludables - imagenes productos/SALAME TIPO TANDIL Por unidad (aprox. 500gr).png'],
  ['salame tipo colorado envasado 250gr', 'PasosSaludables - imagenes productos/SALAME COLORADO TIPO ESPANOL Por unidad (500gr aprox).png'],
  ['rebozador dani picante 500gr', 'HARINA/PREPARADO PARA REBOZADOS DANI Con picante.png'],
  ['pochoclo organico sal marina 40gr', 'POCHOCLOS/POCHOCLOS ORGANICOS BAMBOO Sal marina 40gr.png'],
  ['pochoclo organico sal marina 80gr', 'POCHOCLOS/POCHOCLOS ORGANICOS BAMBOO Sal marina 80gr.png'],
  ['pochoclo organico azucar organico and sal marina 40gr', 'POCHOCLOS/POCHOCLOS ORGANICOS BAMBOO Sweet and Salty 40gr.png'],
  ['pochoclo organico azucar organico and sal marina 80gr', 'POCHOCLOS/POCHOCLOS ORGANICOS BAMBOO Sweet and Salty 80gr.png'],
  ['pochoclo organico azucar organico 40gr', 'POCHOCLOS/POCHOCLOS ORGANICOS BAMBOO Azucar Organico 40gr.png'],
  ['pochoclo organico azucar organico 80gr', 'POCHOCLOS/POCHOCLOS ORGANICOS BAMBOO Azucar Organico 80gr.png']
]);

async function main() {
  await ensureSchema();

  const candidates = await loadAssetCandidates();
  const candidatesByRelativePath = new Map(candidates.map((candidate) => [candidate.relativePath, candidate]));
  const products = await sql`
    SELECT id, name, image, images
    FROM products
    ORDER BY id ASC
  `;

  if (products.length === 0) {
    console.log('No hay productos en la base.');
    return;
  }

  let updated = 0;
  let unchanged = 0;
  let manualUpdated = 0;
  let automaticUpdated = 0;
  const skipped = [];

  for (const row of products) {
    const match = findBestCandidate(row.name, candidates, candidatesByRelativePath);

    if (!match) {
      skipped.push({
        id: Number(row.id),
        name: row.name
      });
      continue;
    }

    const nextImage = match.assetPath;
    const nextImages = [nextImage];
    const currentImage = normalizeAsset(row.image);
    const currentImages = normalizeAssetArray(row.images);

    if (currentImage === nextImage && sameArray(currentImages, nextImages)) {
      unchanged += 1;
      continue;
    }

    await sql`
      UPDATE products
      SET
        image = ${nextImage},
        images = ${nextImages},
        updated_at = NOW()
      WHERE id = ${Number(row.id)}
    `;

    updated += 1;

    if (match.mode === 'manual') {
      manualUpdated += 1;
    } else {
      automaticUpdated += 1;
    }

    console.log(`[${row.id}] ${row.name}`);
    console.log(`  ${match.mode === 'manual' ? 'manual' : `auto ${match.score.toFixed(3)}`} -> ${nextImage}`);
  }

  const summaryRows = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE image LIKE '/assets/%'
          AND image NOT LIKE '/assets/web-search/%'
      )::int AS curated_asset_images,
      COUNT(*) FILTER (WHERE image LIKE '/assets/web-search/%')::int AS web_search_images
    FROM products
  `;
  const summary = summaryRows[0] || {};

  console.log('');
  console.log('Sincronizacion de imagenes locales completada.');
  console.log(`Productos en la base: ${Number(summary.total || 0)}`);
  console.log(`Actualizados: ${updated}`);
  console.log(`Actualizados por override manual: ${manualUpdated}`);
  console.log(`Actualizados por match automatico: ${automaticUpdated}`);
  console.log(`Ya correctos: ${unchanged}`);
  console.log(`Con imagen curada desde carpetas locales: ${Number(summary.curated_asset_images || 0)}`);
  console.log(`Todavia usando /assets/web-search: ${Number(summary.web_search_images || 0)}`);
  console.log(`Sin match confiable: ${skipped.length}`);

  if (skipped.length > 0) {
    console.log('');
    console.log('Productos omitidos por falta de match confiable:');
    skipped.forEach((item) => {
      console.log(`- [${item.id}] ${item.name}`);
    });
  }
}

async function loadAssetCandidates() {
  const dirents = await fs.readdir(assetRoot, { withFileTypes: true });
  const candidates = [];

  for (const dirent of dirents) {
    if (!dirent.isDirectory() || ignoredDirectories.has(dirent.name)) {
      continue;
    }

    const directoryPath = path.join(assetRoot, dirent.name);
    const catalogNamesByFilename = await readCatalogNames(directoryPath);
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();

      if (!supportedExtensions.has(extension)) {
        continue;
      }

      const relativePath = `${dirent.name}/${entry.name}`;
      const assetPath = `/assets/${relativePath}`.replaceAll('\\', '/');
      const names = [stripExtension(entry.name), ...(catalogNamesByFilename.get(entry.name) || [])];

      candidates.push({
        directory: dirent.name,
        filename: entry.name,
        relativePath,
        assetPath,
        matchNames: uniqueValues(names.map((value) => String(value || '').trim()).filter(Boolean))
      });
    }
  }

  return candidates;
}

async function readCatalogNames(directoryPath) {
  const catalogPath = path.join(directoryPath, '_lista_productos.txt');

  try {
    const raw = await fs.readFile(catalogPath, 'utf8');
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const namesByFilename = new Map();

    lines.forEach((line) => {
      const parts = line.split('\t');
      const productName = parts[1]?.trim();
      const filename = parts[2]?.trim();

      if (!productName || !filename) {
        return;
      }

      const existing = namesByFilename.get(filename) || [];
      existing.push(productName);
      namesByFilename.set(filename, existing);
    });

    return namesByFilename;
  } catch {
    return new Map();
  }
}

function findBestCandidate(productName, candidates, candidatesByRelativePath) {
  const productKey = normalizeKey(productName);
  const manualRelativePath = manualMatches.get(productKey);

  if (manualRelativePath) {
    const manualCandidate = candidatesByRelativePath.get(manualRelativePath);

    if (manualCandidate) {
      return {
        ...manualCandidate,
        mode: 'manual',
        score: Number.POSITIVE_INFINITY
      };
    }
  }

  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(productName, candidate.matchNames)
    }))
    .sort((left, right) => right.score - left.score);

  const best = ranked[0];
  const second = ranked[1];

  if (!best || best.score < minimumAutoScore) {
    return null;
  }

  if (second && best.score < 1 && best.score - second.score < minimumGapScore) {
    return null;
  }

  return {
    ...best.candidate,
    mode: 'auto',
    score: best.score
  };
}

function scoreCandidate(productName, candidateNames) {
  let bestScore = Number.NEGATIVE_INFINITY;

  candidateNames.forEach((candidateName) => {
    const score = scoreNamePair(productName, candidateName);

    if (score > bestScore) {
      bestScore = score;
    }
  });

  return Number(bestScore.toFixed(3));
}

function scoreNamePair(productName, candidateName) {
  const productNormalized = normalizeText(productName);
  const candidateNormalized = normalizeText(candidateName);
  const productTokens = tokenize(productName);
  const candidateTokens = tokenize(candidateName);
  const productTokenSet = new Set(productTokens);
  const candidateTokenSet = new Set(candidateTokens);
  const commonTokens = [...new Set(productTokens.filter((token) => candidateTokenSet.has(token)))];
  const union = new Set([...productTokenSet, ...candidateTokenSet]);
  const jaccard = union.size > 0 ? commonTokens.length / union.size : 0;
  const coverage = productTokenSet.size > 0 ? commonTokens.length / productTokenSet.size : 0;
  const reverseCoverage = candidateTokenSet.size > 0 ? commonTokens.length / candidateTokenSet.size : 0;
  let score = (jaccard * 0.35) + (coverage * 0.45) + (reverseCoverage * 0.2);

  if (productNormalized === candidateNormalized) {
    score += 0.7;
  }

  if (candidateNormalized.includes(productNormalized) || productNormalized.includes(candidateNormalized)) {
    score += 0.25;
  }

  const productMeasures = productNormalized.match(/\d+(?:ml|gr|kg|l)/g) || [];
  const candidateMeasures = candidateNormalized.match(/\d+(?:ml|gr|kg|l)/g) || [];

  if (
    productMeasures.length > 0 &&
    candidateMeasures.length > 0 &&
    !productMeasures.some((measure) => candidateMeasures.includes(measure))
  ) {
    score -= 0.18;
  }

  if (productNormalized.includes('sachet') !== candidateNormalized.includes('sachet')) {
    score -= 0.12;
  }

  ['tangerina', 'limon', 'choconilla', 'beijinho', 'original', 'pistacho', 'vainilla'].forEach((token) => {
    if (productNormalized.includes(token) !== candidateNormalized.includes(token)) {
      score -= 0.15;
    }
  });

  return score;
}

function tokenize(value) {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !stopwords.has(token));
}

function normalizeText(value) {
  let normalized = stripAccents(String(value || '').toLowerCase());

  normalized = normalized.replace(/&/g, ' and ');
  normalized = normalized.replace(/[\[\](){}.,;:+/_-]+/g, ' ');
  normalized = normalized.replace(/\b(\d+)\s*(ml|gr|kg|g|l)\b/g, '$1$2');

  replacementMap.forEach((replacement, source) => {
    normalized = normalized.replaceAll(source, replacement);
  });

  normalized = normalized.replace(/\bchico\b/g, '40gr');
  normalized = normalized.replace(/\bgrande\b/g, '80gr');
  normalized = normalized.replace(/\bsalty\b/g, 'sal marina');
  normalized = normalized.replace(/\bsweet\b/g, 'azucar organico');
  normalized = normalized.replace(/\bespanol\b/g, 'colorado');
  normalized = normalized.replace(/\btandil picado fino\b/g, 'tandil');
  normalized = normalized.replace(/\bmariposa\b/g, '');
  normalized = normalized.replace(/\btostada\b/g, '');
  normalized = normalized.replace(/\btostado\b/g, '');
  normalized = normalized.replace(/\bsalada\b/g, '');
  normalized = normalized.replace(/\bsalado\b/g, '');
  normalized = normalized.replace(/\b200ml\b/g, '200gr');
  normalized = normalized.replace(/\b1litro\b/g, '1l');
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

function normalizeKey(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function stripAccents(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function stripExtension(filename) {
  return filename.replace(/\.[^.]+$/, '');
}

function normalizeAsset(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAssetArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueValues(value.map(normalizeAsset).filter(Boolean));
}

function uniqueValues(values) {
  return [...new Set(values)];
}

function sameArray(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
