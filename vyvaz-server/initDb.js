const pool = require("./config/db");

/**
 * Cria as tabelas se não existirem.
 * Chamado uma vez na inicialização do servidor.
 */
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Tabela de bases
    await client.query(`
      CREATE TABLE IF NOT EXISTS bases (
        id          SERIAL PRIMARY KEY,
        nome        TEXT NOT NULL,
        slug        TEXT NOT NULL UNIQUE,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Tabela de itens importados
    await client.query(`
      CREATE TABLE IF NOT EXISTS base_itens (
        id                  SERIAL PRIMARY KEY,
        base_id             INTEGER NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
        produto_id          TEXT NOT NULL,
        custo_produto       NUMERIC,
        imposto_percentual  NUMERIC,
        taxa_fixa           NUMERIC,
        dados_extras        JSONB DEFAULT '{}',
        created_at          TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Índices para performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_base_itens_base_id
        ON base_itens(base_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_base_itens_produto_id
        ON base_itens(produto_id);
    `);

    await client.query("COMMIT");
    console.log("[DB] Tabelas verificadas/criadas com sucesso");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { initDatabase };
