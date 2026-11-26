// backend/utils/embedder.js
// Локальные нейросетевые мультиязычные ONNX-эмбеддинги (Xenova/multilingual-e5-small, 384-dim)
// с кэшированием модели на диск и сверхбыстрым CPU-инференсом через onnxruntime-node.

const path = require('path');

const ONNX_VECTOR_DIM = 384;
const LEGACY_VECTOR_DIM = 128;
const MODEL_NAME = process.env.EMBEDDING_MODEL || 'Xenova/multilingual-e5-small';
const HF_CACHE_DIR = process.env.HF_CACHE_DIR || path.join(__dirname, '../../.hf_cache');

let extractorPipeline = null;
let initPromise = null;
let onnxLoadError = null;
let isLoading = false;

/**
 * Инициализация и прогрев локальной ONNX-модели эмбеддингов (вызывается 1 раз, потокобезопасно).
 */
async function initEmbedder() {
  if (extractorPipeline) return extractorPipeline;
  if (initPromise) return initPromise;

  isLoading = true;
  onnxLoadError = null;

  initPromise = (async () => {
    try {
      const startMs = Date.now();
      console.log(`[Embedder ONNX] Загрузка мультиязычной модели "${MODEL_NAME}" (кэш: ${HF_CACHE_DIR})...`);
      const transformers = await import('@xenova/transformers');
      transformers.env.cacheDir = HF_CACHE_DIR;
      transformers.env.allowLocalModels = true;
      transformers.env.allowRemoteModels = true;

      extractorPipeline = await transformers.pipeline('feature-extraction', MODEL_NAME, {
        quantized: true
      });
      const elapsed = Date.now() - startMs;
      console.log(`[Embedder ONNX] ✅ Модель "${MODEL_NAME}" (${ONNX_VECTOR_DIM}-dim) готова за ${elapsed} мс!`);
      return extractorPipeline;
    } catch (err) {
      onnxLoadError = err.message || String(err);
      console.error(`[Embedder ONNX] ⚠️ Не удалось загрузить ONNX-модель (${onnxLoadError}). Будет использован резервный вектор.`);
      initPromise = null;
      return null;
    } finally {
      isLoading = false;
    }
  })();

  return initPromise;
}

/**
 * Подготовка входного текста для семейства моделей E5 (асимметричные префиксы query: / passage:)
 */
function prepareE5Input(text, mode = 'passage') {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  // Ограничиваем длину до ~1800 символов (~420-480 токенов для кириллицы), чтобы не обрезаться внезапно
  const truncated = clean.length > 1800 ? clean.slice(0, 1800) : clean;
  const prefix = mode === 'query' ? 'query: ' : 'passage: ';
  return `${prefix}${truncated}`;
}

/**
 * Извлечение L2-нормализованного 384-мерного вектора из тензора Transformers.js
 */
function tensorToVectors(output, expectedCount) {
  const data = output.data;
  const dims = output.dims; // [batch, 384] или [1, 384] или [384]
  const dim = dims[dims.length - 1] || ONNX_VECTOR_DIM;
  const count = expectedCount || (dims.length >= 2 ? dims[0] : 1);
  const vectors = [];

  for (let b = 0; b < count; b++) {
    const start = b * dim;
    const vec = new Array(dim);
    let normSq = 0;
    for (let i = 0; i < dim; i++) {
      const v = data[start + i] || 0;
      vec[i] = v;
      normSq += v * v;
    }
    const norm = Math.sqrt(normSq) || 1;
    for (let i = 0; i < dim; i++) {
      vec[i] = Number((vec[i] / norm).toFixed(6));
    }
    vectors.push(vec);
  }
  return vectors;
}

/**
 * Асинхронная генерация 384-dim ONNX эмбеддинга для одного текста.
 * @param {string} text
 * @param {'query'|'passage'} mode
 * @returns {Promise<number[]>}
 */
async function embedText(text, mode = 'passage') {
  const prepared = prepareE5Input(text, mode);
  if (!prepared) return new Array(ONNX_VECTOR_DIM).fill(0);

  const pipe = await initEmbedder();
  if (!pipe) {
    return generateSignedFallbackVector(text, ONNX_VECTOR_DIM);
  }

  const output = await pipe(prepared, { pooling: 'mean', normalize: true });
  return tensorToVectors(output, 1)[0];
}

/**
 * Пакетная асинхронная генерация 384-dim ONNX эмбеддингов (для чанков и предложений Extractive QA).
 * @param {string[]} texts
 * @param {'query'|'passage'} mode
 * @param {number} batchSize
 * @returns {Promise<number[][]>}
 */
async function embedBatch(texts, mode = 'passage', batchSize = 8) {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  const pipe = await initEmbedder();
  if (!pipe) {
    return texts.map(t => generateSignedFallbackVector(t, ONNX_VECTOR_DIM));
  }

  const results = new Array(texts.length);
  const nonEmptyIndices = [];
  const nonEmptyInputs = [];

  for (let i = 0; i < texts.length; i++) {
    const prepared = prepareE5Input(texts[i], mode);
    if (!prepared) {
      results[i] = new Array(ONNX_VECTOR_DIM).fill(0);
    } else {
      nonEmptyIndices.push(i);
      nonEmptyInputs.push(prepared);
    }
  }

  for (let start = 0; start < nonEmptyInputs.length; start += batchSize) {
    const slice = nonEmptyInputs.slice(start, start + batchSize);
    const output = await pipe(slice, { pooling: 'mean', normalize: true });
    const vecs = tensorToVectors(output, slice.length);
    for (let j = 0; j < vecs.length; j++) {
      results[nonEmptyIndices[start + j]] = vecs[j];
    }
    // Отдаём квант Event Loop между батчами
    await new Promise(r => setImmediate(r));
  }

  return results;
}

/**
 * Преобразование числового вектора в строковый литерал pgvector: "[0.123,-0.456,...]"
 */
function toPgVector(vec) {
  if (!Array.isArray(vec) || vec.length === 0) return null;
  return `[${vec.join(',')}]`;
}

function getEmbedderStatus() {
  return {
    ready: Boolean(extractorPipeline),
    loading: isLoading,
    model: MODEL_NAME,
    dim: ONNX_VECTOR_DIM,
    cacheDir: HF_CACHE_DIR,
    error: onnxLoadError
  };
}

// =========================================================================
// СИНХРОННЫЕ УТИЛИТЫ (ТОКЕНИЗАЦИЯ, СТЕММИНГ, COSINE, FALLBACK HASHING)
// =========================================================================

const STOPWORDS = new Set([
  'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все', 'она',
  'так', 'его', 'но', 'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по', 'только', 'ее',
  'мне', 'было', 'вот', 'от', 'меня', 'еще', 'нет', 'о', 'из', 'ему', 'теперь', 'когда',
  'даже', 'ну', 'вдруг', 'ли', 'если', 'уже', 'или', 'ни', 'быть', 'был', 'него', 'до',
  'вас', 'нибудь', 'опять', 'уж', 'вам', 'ведь', 'там', 'потом', 'себя', 'ничего', 'ей',
  'может', 'они', 'тут', 'где', 'есть', 'надо', 'ней', 'для', 'мы', 'тебя', 'их', 'чем',
  'была', 'сам', 'чтоб', 'без', 'будто', 'чего', 'раз', 'тоже', 'себе', 'под', 'будет',
  'ж', 'тогда', 'кто', 'этот', 'того', 'потому', 'этого', 'какой', 'какая', 'какие', 'какое',
  'совсем', 'ним', 'здесь', 'этом', 'один', 'почти', 'мой', 'тем', 'чтобы', 'нее', 'сейчас',
  'были', 'куда', 'зачем', 'про', 'при', 'через', 'после', 'над', 'под', 'между',
  'the', 'and', 'a', 'to', 'of', 'in', 'is', 'that', 'for', 'it', 'as', 'was', 'with', 'on'
]);

const SEMANTIC_CLUSTERS = [
  { id: 'sem_contract', words: ['договор', 'соглашен', 'контракт', 'сделк', 'contract', 'agreement'] },
  { id: 'sem_procurement', words: ['поставк', 'закупк', 'снабжен', 'поставщик', 'заказчик', 'supply', 'procurement'] },
  { id: 'sem_equipment', words: ['оборудован', 'станок', 'техник', 'агрегат', 'сервер', 'equipment'] },
  { id: 'sem_finance', words: ['оплат', 'платеж', 'счет', 'финанс', 'бюджет', 'аванс', 'стоимост', 'payment'] },
  { id: 'sem_directive', words: ['приказ', 'распоряжен', 'положен', 'регламент', 'инструкц', 'regulation'] },
  { id: 'sem_report', words: ['отчет', 'протокол', 'заключен', 'справк', 'report', 'protocol'] },
  { id: 'sem_hr', words: ['сотрудник', 'работник', 'персонал', 'зарплат', 'преми', 'отпуск', 'командировк', 'суточн', 'увольнен'] },
  { id: 'sem_legal', words: ['претензи', 'арбитраж', 'комплаенс', 'неустойк', 'штраф', 'пеня', 'legal', 'compliance'] },
  { id: 'sem_audit', words: ['аудит', 'проверк', 'ревизи', 'контрол', 'инспекци', 'audit'] },
  { id: 'sem_security', words: ['безопасн', 'охран', 'защит', 'доступ', 'инцидент', 'секретн', 'security'] },
  { id: 'sem_project', words: ['проект', 'задач', 'план', 'срок', 'дедлайн', 'этап', 'project'] }
];

function stemRussian(word) {
  if (!word || word.length < 4) return word;
  return word.replace(/(ому|ему|ыми|ими|ого|его|ых|их|ую|юю|ая|яя|ое|ее|ия|ья|ей|ой|ам|ям|ами|ями|ах|ях|ов|ев|ы|и|а|я|у|ю|е|о)$/i, '');
}

function stemEnglish(word) {
  if (!word || word.length < 4) return word;
  return word.replace(/(ing|ed|es|s|ly|tion|ment)$/i, '');
}

function fnv1a(str, seed = 2166136261) {
  let hash = seed;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  const clean = text.toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s_-]/g, ' ')
    .trim();

  const words = clean.split(/\s+/).filter(w => w.length >= 2);
  const tokens = [];

  for (const w of words) {
    if (STOPWORDS.has(w)) continue;
    const stem = /[а-я]/i.test(w) ? stemRussian(w) : stemEnglish(w);
    if (stem.length < 2) continue;
    tokens.push(stem);

    // Фикс бага коротких корней: кластер срабатывает только если стем >= 4 символов
    if (stem.length >= 4) {
      for (const cluster of SEMANTIC_CLUSTERS) {
        if (cluster.words.some(cw => stem.startsWith(cw) || (cw.length >= 4 && cw.startsWith(stem)))) {
          tokens.push(cluster.id);
          break;
        }
      }
    }
  }

  return tokens;
}

/**
 * Знаковое хеширование признаков (±1 projection, Weinberger et al.) — исключает положительный дрейф коллизий.
 */
function generateSignedFallbackVector(text, dim = LEGACY_VECTOR_DIM) {
  const vector = new Float32Array(dim);
  const tokens = tokenize(text);
  if (tokens.length === 0) return Array.from(vector);

  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  for (const [token, count] of counts.entries()) {
    const idx = fnv1a(token, 2166136261) % dim;
    const sign = (fnv1a(token, 16777619) & 1) === 0 ? 1 : -1;
    const weight = token.startsWith('sem_') ? 1.5 : (1.0 + Math.log(count));
    vector[idx] += sign * weight;
  }

  let norm = 0.0;
  for (let i = 0; i < dim; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) {
      vector[i] = parseFloat((vector[i] / norm).toFixed(6));
    }
  }
  return Array.from(vector);
}

// Обратная совместимость со старыми синхронными вызовами (128-dim)
function generateEmbedding(text) {
  return generateSignedFallbackVector(text, LEGACY_VECTOR_DIM);
}

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0.0;
  let dot = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return Math.max(-1.0, Math.min(1.0, dot));
}

module.exports = {
  VECTOR_DIM: LEGACY_VECTOR_DIM,
  ONNX_VECTOR_DIM,
  MODEL_NAME,
  initEmbedder,
  embedText,
  embedBatch,
  toPgVector,
  getEmbedderStatus,
  generateEmbedding,
  cosineSimilarity,
  tokenize,
  stemRussian,
  STOPWORDS
};
