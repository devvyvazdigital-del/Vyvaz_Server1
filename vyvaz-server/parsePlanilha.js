const XLSX = require("xlsx");

/**
 * Lê workbook a partir do buffer (.xlsx, .xls, .csv).
 */
function readWorkbook(buffer, originalname = "") {
  const name = String(originalname || "").toLowerCase();
  const isCsv = name.endsWith(".csv");
  const options = { type: "buffer" };
  if (isCsv) {
    options.codepage = 65001;
  }
  return XLSX.read(buffer, options);
}

/**
 * Cabeçalhos da primeira linha da planilha (fallback quando não há linhas de dados).
 */
function headersFromFirstSheetRow(sheet) {
  const ref = sheet["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const headers = [];
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const addr = XLSX.utils.encode_cell({ r: range.s.r, c });
    const cell = sheet[addr];
    const v = cell && cell.v != null ? String(cell.v).trim() : "";
    headers.push(v || `__col_${c}`);
  }
  return headers;
}

/**
 * Pontua colunas candidatas a ID (maior = melhor).
 * Regras: id, sku, mlb — case insensitive; evita falsos positivos óbvios em "custo".
 */
function scoreIdColumn(header) {
  const raw = String(header ?? "").trim();
  if (!raw) return 0;
  const h = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (h === "id") return 100;
  if (h === "sku") return 95;
  if (h.includes("mlb")) return 92;
  if (/\bsku\b/.test(h)) return 88;
  if (/\bmlb\b/.test(h)) return 90;
  if (/(^|_)id$/.test(h) || /^id[_\s-]/.test(h)) return 85;
  if (/\bid\b/.test(h)) return 70;
  if (h.includes("id")) return 45;

  return 0;
}

function pickIdColumn(keys) {
  let best = null;
  let bestScore = 0;
  for (const key of keys) {
    const s = scoreIdColumn(key);
    if (s > bestScore) {
      bestScore = s;
      best = key;
    }
  }
  if (bestScore < 40) return null;
  return best;
}

function normalizeCellValue(val) {
  if (val == null) return "";
  if (typeof val === "number" && Number.isFinite(val)) {
    if (Number.isInteger(val)) return String(val);
    return String(val);
  }
  return String(val).trim();
}

/**
 * Extrai ID legível (ex.: número longo de anúncio ML dentro de texto).
 */
function extractIdFromValue(raw) {
  const s = normalizeCellValue(raw);
  if (!s) return null;
  const mlbCompact = s.match(/^MLB\s*(\d{8,})$/i);
  if (mlbCompact) return mlbCompact[1];
  const digits = s.match(/\d{8,}/g);
  if (digits && digits.length) {
    return digits.sort((a, b) => b.length - a.length)[0];
  }
  return s || null;
}

function extractIdsFromRows(rows, idColumnKey) {
  const seen = new Set();
  const ids = [];
  for (const row of rows) {
    const v = row[idColumnKey];
    const id = extractIdFromValue(v);
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function scoreDataColumn(header, keywords) {
  const h = String(header ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!h) return 0;
  let best = 0;
  for (const kw of keywords) {
    if (h.includes(kw)) best = Math.max(best, kw.length);
  }
  return best;
}

function pickOptionalColumn(keys, keywords) {
  let best = null;
  let bestScore = 0;
  for (const key of keys) {
    const s = scoreDataColumn(key, keywords);
    if (s > bestScore) {
      bestScore = s;
      best = key;
    }
  }
  return bestScore > 0 ? best : null;
}

/**
 * Monta linhas de preview no formato esperado pelo popup (chaves dinâmicas).
 */
function buildPreview(rows, idKey, custoKey, impostoKey, taxaKey, limit = 8) {
  const slice = rows.slice(0, limit);
  return slice.map((row) => ({
    id: extractIdFromValue(row[idKey]) ?? "",
    custo_produto: custoKey != null ? normalizeCellValue(row[custoKey]) : "",
    imposto_percentual: impostoKey != null ? normalizeCellValue(row[impostoKey]) : "",
    taxa_fixa: taxaKey != null ? normalizeCellValue(row[taxaKey]) : ""
  }));
}

/**
 * @param {Buffer} buffer
 * @param {object} options
 * @param {string} [options.originalname] - nome do arquivo (define .csv)
 * @param {string} [options.colunaIdManual] - força coluna de ID pelo cabeçalho exato da planilha
 * @returns {{ ok: true, total: number, colunaUsada: string, ids: string[], rows: object[], colunas: string[], preview: object[] } | { ok: false, erro: string, colunasDisponiveis: string[] }}
 */
function parsePlanilha(buffer, options = {}) {
  const { originalname = "", colunaIdManual = null } = options;

  if (!buffer || !buffer.length) {
    return { ok: false, erro: "Arquivo vazio", colunasDisponiveis: [] };
  }

  let workbook;
  try {
    workbook = readWorkbook(buffer, originalname);
  } catch (e) {
    return {
      ok: false,
      erro: `Falha ao ler planilha: ${e.message}`,
      colunasDisponiveis: []
    };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { ok: false, erro: "Planilha sem abas", colunasDisponiveis: [] };
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: null,
    raw: false
  });

  let colunas;
  if (rows.length > 0) {
    colunas = Object.keys(rows[0]);
  } else {
    colunas = headersFromFirstSheetRow(sheet);
  }

  console.log("[parsePlanilha] aba:", sheetName, "| colunas detectadas:", colunas);

  if (!colunas.length) {
    return {
      ok: false,
      erro: "Nenhuma coluna encontrada na planilha",
      colunasDisponiveis: []
    };
  }

  let colunaUsada = null;
  if (colunaIdManual && typeof colunaIdManual === "string") {
    const manual = colunaIdManual.trim();
    const exact = colunas.find((c) => String(c).trim() === manual);
    const ci = colunas.find(
      (c) => String(c).trim().toLowerCase() === manual.toLowerCase()
    );
    colunaUsada = exact ?? ci ?? null;
  }
  if (!colunaUsada) {
    colunaUsada = pickIdColumn(colunas);
  }

  if (!colunaUsada) {
    return {
      ok: false,
      erro:
        "Não foi possível detectar a coluna de ID. Use um cabeçalho contendo id, sku ou mlb, ou envie colunaId no formulário.",
      colunasDisponiveis: colunas
    };
  }

  console.log("[parsePlanilha] coluna de ID escolhida:", colunaUsada);

  const ids = rows.length ? extractIdsFromRows(rows, colunaUsada) : [];

  const custoKey = pickOptionalColumn(colunas, [
    "custo",
    "cost",
    "preco_custo",
    "preço",
    "valor_custo"
  ]);
  const impostoKey = pickOptionalColumn(colunas, [
    "imposto",
    "tax",
    "iva",
    "percentual_imposto"
  ]);
  const taxaKey = pickOptionalColumn(colunas, ["taxa", "fee", "tarifa", "fixa"]);

  const preview = rows.length
    ? buildPreview(rows, colunaUsada, custoKey, impostoKey, taxaKey)
    : [];

  return {
    ok: true,
    total: ids.length,
    colunaUsada,
    ids,
    rows,
    colunas,
    preview
  };
}

module.exports = {
  parsePlanilha,
  readWorkbook,
  headersFromFirstSheetRow
};
