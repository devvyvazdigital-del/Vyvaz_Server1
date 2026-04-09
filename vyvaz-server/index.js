const express = require("express");
const cors = require("cors");
const multer = require("multer");
const XLSX = require("xlsx");
const path = require("path");
const pool = require("./config/db");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARES ────────────────────────────────────────────
app.use(cors({ origin: true, credentials: false, methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"], allowedHeaders: ["Content-Type","Authorization"] }));
app.options(/.*/, cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ─── AUXILIARES ─────────────────────────────────────────────
function normalizarSlug(nome) {
  return String(nome || "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}

function numeroSeguro(valor) {
  if (valor === null || valor === undefined || valor === "") return 0;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
  let texto = String(valor).trim().replace(/\s/g, "").replace("%", "");
  if (!texto) return 0;
  if (texto.includes(",") && texto.includes(".")) { texto = texto.replace(/\./g, "").replace(",", "."); }
  else if (texto.includes(",")) { texto = texto.replace(",", "."); }
  const n = Number(texto);
  return Number.isFinite(n) ? n : 0;
}

function obterValorColuna(row, nomes) {
  for (const nome of nomes) {
    if (row[nome] !== undefined && row[nome] !== null && row[nome] !== "") return row[nome];
  }
  return "";
}

function parsePlanilha(buffer, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  if (![".xlsx", ".xls", ".csv"].includes(ext)) throw new Error("Formato inválido. Envie .xlsx, .xls ou .csv");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const primeiraAba = workbook.SheetNames[0];
  if (!primeiraAba) throw new Error("A planilha não possui abas válidas");
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[primeiraAba], { defval: "" });
  if (!rows.length) throw new Error("A planilha está vazia");

  const resultado = [];
  for (const row of rows) {
    // Normaliza chaves: remove espaços e BOM invisíveis
    const r = {};
    for (const [k, v] of Object.entries(row)) {
      r[k.trim().replace(/^\uFEFF/, "")] = v;
    }

    const id = String(obterValorColuna(r, ["id", "ID", "Id", "sku", "SKU", "Sku", "mlb", "MLB"])).trim();
    if (!id) continue;

    // Normaliza: remove prefixo MLB/mlb e espaços, mantém só dígitos longos
    let produtoId = id;
    const mlbMatch = id.match(/^MLB\s*(\d{8,})$/i);
    if (mlbMatch) {
      produtoId = mlbMatch[1];
    } else {
      const digitsMatch = id.match(/(\d{8,})/);
      if (digitsMatch) produtoId = digitsMatch[1];
    }

    resultado.push({
      produto_id: produtoId,
      custo_produto: numeroSeguro(obterValorColuna(r, ["Custo", "custo_produto", "CUSTO_PRODUTO", "custo", "CUSTO", "Custo Produto"])),
      imposto_percentual: numeroSeguro(obterValorColuna(r, ["Imposto", "imposto_percentual", "IMPOSTO_PERCENTUAL", "imposto", "IMPOSTO", "Imposto Percentual"])),
      taxa_fixa: numeroSeguro(obterValorColuna(r, ["Taxa", "taxa_fixa", "TAXA_FIXA", "taxa", "TAXA", "Taxa Fixa"]))
    });
  }
  if (!resultado.length) throw new Error("Nenhum ID válido encontrado na planilha");
  return resultado;
}

// ─── SETUP TABELAS ──────────────────────────────────────────
async function setupTabelas() {
  // Cria tabelas se não existirem
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bases (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      nome TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS custos (
      id SERIAL PRIMARY KEY,
      base_id INTEGER NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
      produto_id TEXT NOT NULL,
      custo_produto NUMERIC NOT NULL DEFAULT 0,
      imposto_percentual NUMERIC NOT NULL DEFAULT 0,
      taxa_fixa NUMERIC NOT NULL DEFAULT 0,
      UNIQUE (base_id, produto_id)
    );
  `);

  // Adiciona colunas novas em tabelas que já existiam (migração segura)
  await pool.query(`
    ALTER TABLE bases ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE bases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    DROP TABLE IF EXISTS base_itens;
  `);

  console.log("✅ Tabelas verificadas/criadas");
}

// ─── ROTAS ──────────────────────────────────────────────────

app.get("/", (req, res) => res.send("Vyvaz server rodando 🚀"));
app.get("/health", (req, res) => res.json({ ok: true, mensagem: `Vyvaz OK porta ${PORT}` }));

// ── Setup manual (acessar uma vez) ──
app.get("/setup", async (req, res) => {
  try {
    await setupTabelas();
    res.json({ ok: true, mensagem: "Tabelas criadas com sucesso" });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// ── Login (fake por enquanto) ──
app.post("/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ erro: "Email e senha obrigatórios" });
  res.json({
    ok: true,
    token: "fake-token",
    usuario: { nome: "Usuário Teste", email }
  });
});

// ── Listar bases ──
app.get("/bases", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, slug, nome, ativo, created_at, updated_at FROM bases WHERE ativo = true ORDER BY created_at DESC"
    );
    res.json({ ok: true, bases: result.rows });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// ── Buscar custos de uma base (usado pelo content.js) ──
app.get("/bases/:baseId", async (req, res) => {
  try {
    const slug = normalizarSlug(req.params.baseId);
    const baseResult = await pool.query(
      "SELECT id, nome, slug FROM bases WHERE slug = $1 AND ativo = true",
      [slug]
    );
    if (!baseResult.rows.length) {
      return res.status(404).json({ ok: false, erro: "Base não encontrada" });
    }
    const base = baseResult.rows[0];
    const custos = await pool.query(
      "SELECT produto_id, custo_produto, imposto_percentual, taxa_fixa FROM custos WHERE base_id = $1",
      [base.id]
    );
    const dados = {};
    for (const row of custos.rows) {
      dados[row.produto_id] = {
        custo_produto: parseFloat(row.custo_produto),
        imposto_percentual: parseFloat(row.imposto_percentual),
        taxa_fixa: parseFloat(row.taxa_fixa)
      };
    }
    res.json({ ok: true, baseId: base.slug, nome: base.nome, total: custos.rows.length, dados });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// ── Importar planilha ──
app.post("/importar-base", upload.single("arquivo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, erro: "Nenhum arquivo enviado" });
    const nomeBaseOriginal = String(req.body.nomeBase || "").trim();
    if (!nomeBaseOriginal) return res.status(400).json({ ok: false, erro: "Nome da base é obrigatório" });
    const slug = normalizarSlug(nomeBaseOriginal);
    const linhas = parsePlanilha(req.file.buffer, req.file.originalname);

    const confirmar = req.body.confirmar === "true";
    if (!confirmar) {
      return res.json({
        ok: true,
        preview: linhas.slice(0, 10).map(l => ({
          id: l.produto_id,
          custo_produto: l.custo_produto,
          imposto_percentual: l.imposto_percentual,
          taxa_fixa: l.taxa_fixa
        })),
        total: linhas.length,
        linhasPlanilha: linhas.length,
        idsDetectados: linhas.length,
        colunaId: "id / sku",
        colunaUsada: "id / sku",
        nomeBase: nomeBaseOriginal
      });
    }

    // ── Salvar no banco ──
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const baseResult = await client.query(
        `INSERT INTO bases (slug, nome)
         VALUES ($1, $2)
         ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome, ativo = true, updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [slug, nomeBaseOriginal]
      );
      const baseId = baseResult.rows[0].id;

      // Limpa custos antigos
      await client.query("DELETE FROM custos WHERE base_id = $1", [baseId]);

      // Insere novos
      for (const linha of linhas) {
        await client.query(
          `INSERT INTO custos (base_id, produto_id, custo_produto, imposto_percentual, taxa_fixa)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (base_id, produto_id) DO UPDATE SET
           custo_produto = EXCLUDED.custo_produto,
           imposto_percentual = EXCLUDED.imposto_percentual,
           taxa_fixa = EXCLUDED.taxa_fixa`,
          [baseId, linha.produto_id, linha.custo_produto, linha.imposto_percentual, linha.taxa_fixa]
        );
      }

      await client.query("COMMIT");

      res.json({
        ok: true,
        mensagem: `Base "${nomeBaseOriginal}" — ${linhas.length} ID(s) importado(s) e salvos no banco.`,
        base: slug,
        nomeBase: nomeBaseOriginal,
        total: linhas.length
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[importar-base]", err);
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// ── Desabilitar base ──
app.post("/bases/:baseId/desabilitar", async (req, res) => {
  try {
    const slug = normalizarSlug(req.params.baseId);
    const result = await pool.query(
      "UPDATE bases SET ativo = false WHERE slug = $1 RETURNING id",
      [slug]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, erro: "Base não encontrada" });
    res.json({ ok: true, mensagem: "Base desabilitada com sucesso" });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// ── Excluir base ──
app.delete("/bases/:baseId", async (req, res) => {
  try {
    const param = req.params.baseId;
    const result = await pool.query(
      "DELETE FROM bases WHERE id = $1 OR slug = $2 RETURNING id",
      [parseInt(param) || 0, normalizarSlug(param)]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, erro: "Base não encontrada" });
    res.json({ ok: true, mensagem: "Base excluída com sucesso" });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// ─── ERRO GLOBAL ────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ ok: false, erro: `Erro no upload: ${err.message}` });
  res.status(500).json({ ok: false, erro: "Erro interno do servidor" });
});

// ─── START ──────────────────────────────────────────────────
async function start() {
  if (process.env.DATABASE_URL) {
    try {
      await pool.query("SELECT 1");
      console.log("✅ Banco conectado com sucesso");
      await setupTabelas();
    } catch (err) {
      console.error("❌ Falha ao conectar ao PostgreSQL:", err.message);
      process.exit(1);
    }
  } else {
    console.warn("⚠️  DATABASE_URL não definida");
  }

  app.listen(PORT, () => {
    console.log(`🚀 Vyvaz rodando na porta ${PORT}`);
  });
}

start();