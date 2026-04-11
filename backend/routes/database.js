import { Router } from 'express';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import multer from 'multer';
import Database from 'better-sqlite3';
import pg from 'pg';

const { Client } = pg;
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const SQLITE_FILE = 'database.sqlite';
const LEGACY_SQLITE_FILE = 'data.db';

function getProjectDir(req) {
  const workspaceDir = path.resolve(req.app.locals.workspaceDir);
  const project = req.params.project;

  if (!project || project.includes('..') || project.startsWith('/')) {
    return null;
  }

  const projectDir = path.resolve(workspaceDir, project);
  if (!projectDir.startsWith(`${workspaceDir}${path.sep}`) || !existsSync(projectDir)) {
    return null;
  }

  return projectDir;
}

function getSqlitePath(projectDir) {
  const nextPath = path.join(projectDir, SQLITE_FILE);
  if (existsSync(nextPath)) return nextPath;

  const legacyPath = path.join(projectDir, LEGACY_SQLITE_FILE);
  if (existsSync(legacyPath)) return legacyPath;

  return nextPath;
}

function sqliteUrl(dbPath) {
  return `sqlite://${dbPath}`;
}

function safePgDatabaseName(project) {
  const cleaned = String(project)
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `ide_proj_${cleaned || 'project'}`.slice(0, 63);
}

function quoteIdent(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function pgLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (Buffer.isBuffer(value)) return `'\\x${value.toString('hex')}'`;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseEnv(content) {
  const vars = new Map();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars.set(key, value);
  }
  return vars;
}

async function readEnv(projectDir) {
  const envPath = path.join(projectDir, '.env');
  if (!existsSync(envPath)) return new Map();
  return parseEnv(await fs.readFile(envPath, 'utf-8'));
}

async function upsertDatabaseUrl(projectDir, databaseUrl) {
  const envPath = path.join(projectDir, '.env');
  const lines = existsSync(envPath) ? (await fs.readFile(envPath, 'utf-8')).split('\n') : [];
  let wrote = false;

  const nextLines = lines
    .filter((line, index) => line.length > 0 || index < lines.length - 1)
    .map((line) => {
      if (/^\s*DATABASE_URL\s*=/.test(line)) {
        wrote = true;
        return `DATABASE_URL=${databaseUrl}`;
      }
      return line;
    });

  if (!wrote) nextLines.push(`DATABASE_URL=${databaseUrl}`);
  await fs.writeFile(envPath, `${nextLines.join('\n')}\n`, 'utf-8');
}

async function getDatabaseConfig(projectDir) {
  const env = await readEnv(projectDir);
  const databaseUrl = env.get('DATABASE_URL') || '';

  if (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://')) {
    return { type: 'postgres', url: databaseUrl };
  }

  if (databaseUrl.startsWith('sqlite://')) {
    return { type: 'sqlite', path: databaseUrl.slice('sqlite://'.length), url: databaseUrl };
  }

  const sqlitePath = getSqlitePath(projectDir);
  if (existsSync(sqlitePath)) {
    return { type: 'sqlite', path: sqlitePath, url: sqliteUrl(sqlitePath) };
  }

  return null;
}

function openSqlite(dbPath, options = {}) {
  return new Database(dbPath, options);
}

async function withPg(databaseUrl, callback) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function createPgDatabase(project) {
  const dbName = safePgDatabaseName(project);
  const adminUrl = process.env.PG_ADMIN_URL || process.env.POSTGRES_URL || process.env.POSTGRES_ADMIN_URL;
  const client = adminUrl ? new Client({ connectionString: adminUrl }) : new Client({ database: 'postgres' });

  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${quoteIdent(dbName)}`);
  } catch (error) {
    if (error.code !== '42P04') throw error;
  } finally {
    await client.end();
  }

  return {
    dbName,
    url: buildPgDatabaseUrl(adminUrl, dbName),
  };
}

function buildPgDatabaseUrl(adminUrl, dbName) {
  if (process.env.PG_DATABASE_URL_PREFIX) {
    return `${process.env.PG_DATABASE_URL_PREFIX.replace(/\/$/, '')}/${encodeURIComponent(dbName)}`;
  }

  if (adminUrl) {
    try {
      const url = new URL(adminUrl);
      url.pathname = `/${encodeURIComponent(dbName)}`;
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch {
      return `postgresql://localhost/${encodeURIComponent(dbName)}`;
    }
  }

  return `postgresql://localhost/${encodeURIComponent(dbName)}`;
}

function sqliteColumns(db, tableName) {
  return db.prepare(`PRAGMA table_info(${quoteIdent(tableName)})`).all().map((column) => ({
    name: column.name,
    type: column.type || '',
    nullable: !column.notnull,
    default: column.dflt_value,
    primaryKey: column.pk > 0,
    position: column.cid + 1,
  }));
}

function sqlitePrimaryKey(columns) {
  return columns.find((column) => column.primaryKey)?.name || '__rowid__';
}

function sqliteTables(db) {
  const tables = db
    .prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name ASC
    `)
    .all();

  return tables.map((table) => {
    const columns = sqliteColumns(db, table.name);
    return { name: table.name, columns, primaryKey: sqlitePrimaryKey(columns) };
  });
}

async function pgTables(databaseUrl) {
  return withPg(databaseUrl, async (client) => {
    const tableRows = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name ASC
    `);

    const tables = [];
    for (const row of tableRows.rows) {
      const [columnsResult, pkResult] = await Promise.all([
        client.query(
          `
            SELECT column_name, data_type, is_nullable, column_default, ordinal_position
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position ASC
          `,
          [row.table_name],
        ),
        client.query(
          `
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
             AND tc.table_name = kcu.table_name
            WHERE tc.table_schema = 'public'
              AND tc.table_name = $1
              AND tc.constraint_type = 'PRIMARY KEY'
            ORDER BY kcu.ordinal_position ASC
          `,
          [row.table_name],
        ),
      ]);

      const primaryKeys = pkResult.rows.map((pk) => pk.column_name);
      const columns = columnsResult.rows.map((column) => ({
        name: column.column_name,
        type: column.data_type || '',
        nullable: column.is_nullable === 'YES',
        default: column.column_default,
        primaryKey: primaryKeys.includes(column.column_name),
        position: column.ordinal_position,
      }));

      tables.push({ name: row.table_name, columns, primaryKey: primaryKeys[0] || columns[0]?.name || null });
    }

    return tables;
  });
}

async function getTables(config) {
  if (config.type === 'sqlite') {
    const db = openSqlite(config.path, { readonly: true });
    try {
      return sqliteTables(db);
    } finally {
      db.close();
    }
  }

  return pgTables(config.url);
}

function rowsAsArrays(columns, rows) {
  return rows.map((row) => columns.map((column) => row[column]));
}

function commandResult(changes, lastInsertRowid = null) {
  return {
    columns: ['changes', 'lastInsertRowid'],
    rows: [[changes, lastInsertRowid]],
  };
}

function isReturningSql(sql) {
  return /^(SELECT|PRAGMA|WITH|EXPLAIN|SHOW|DESCRIBE)\b/i.test(sql.trim());
}

async function ensureTable(config, tableName) {
  const tables = await getTables(config);
  const table = tables.find((entry) => entry.name === tableName);
  if (!table) {
    const error = new Error('Table not found');
    error.status = 404;
    throw error;
  }
  return table;
}

function resolvePrimaryKey(table, body = {}) {
  if (body.primaryKey && typeof body.primaryKey === 'object') {
    return {
      column: body.primaryKey.column || body.primaryKey.name || table.primaryKey,
      value: body.primaryKey.value,
    };
  }

  return {
    column: body.primaryKey || table.primaryKey,
    value: body.primaryValue ?? body.primaryKeyValue ?? body.pkValue ?? body.keyValue ?? body.id,
  };
}

async function provisionDatabase(projectDir, project, type) {
  if (type === 'sqlite') {
    const dbPath = path.join(projectDir, SQLITE_FILE);
    await fs.mkdir(projectDir, { recursive: true });
    const db = openSqlite(dbPath);
    try {
      db.pragma('journal_mode = WAL');
    } finally {
      db.close();
    }
    await upsertDatabaseUrl(projectDir, sqliteUrl(dbPath));
  } else {
    const { url } = await createPgDatabase(project);
    await upsertDatabaseUrl(projectDir, url);
  }

  const config = await getDatabaseConfig(projectDir);
  const tables = await getTables(config);
  return {
    type: config.type,
    connectionString: config.url,
    tables: tables.map((table) => table.name),
    schema: tables,
  };
}

router.get('/:project/status', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const config = await getDatabaseConfig(projectDir);
    if (!config) return res.json(null);

    const tables = await getTables(config);
    res.json({
      type: config.type,
      connectionString: config.url,
      tables: tables.map((table) => table.name),
      schema: tables,
    });
  } catch (error) {
    console.error('[database] status error:', error);
    res.status(500).json({ error: 'Failed to load database status', message: error.message });
  }
});

router.post('/:project/provision', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const { type } = req.body || {};
    if (!['sqlite', 'postgres'].includes(type)) {
      return res.status(400).json({ error: "type must be 'sqlite' or 'postgres'" });
    }

    res.json(await provisionDatabase(projectDir, req.params.project, type));
  } catch (error) {
    console.error('[database] provision error:', error);
    res.status(500).json({ error: 'Failed to provision database', message: error.message });
  }
});

router.post('/:project/create', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const type = req.body?.type || 'sqlite';
    if (!['sqlite', 'postgres'].includes(type)) {
      return res.status(400).json({ error: "type must be 'sqlite' or 'postgres'" });
    }

    res.json(await provisionDatabase(projectDir, req.params.project, type));
  } catch (error) {
    console.error('[database] create error:', error);
    res.status(500).json({ error: 'Failed to create database', message: error.message });
  }
});

router.post('/:project/query', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const config = await getDatabaseConfig(projectDir);
    if (!config) return res.status(404).json({ error: 'Database not found' });

    const sql = String(req.body?.sql || '').trim();
    if (!sql) return res.status(400).json({ error: 'sql is required' });

    if (config.type === 'sqlite') {
      const db = openSqlite(config.path);
      try {
        if (isReturningSql(sql)) {
          const stmt = db.prepare(sql);
          const rows = stmt.all();
          const columns = stmt.columns().map((column) => column.name);
          return res.json({ columns, rows: rowsAsArrays(columns, rows) });
        }

        const result = db.prepare(sql).run();
        return res.json(commandResult(result.changes, Number(result.lastInsertRowid || 0)));
      } finally {
        db.close();
      }
    }

    return withPg(config.url, async (client) => {
      const result = await client.query(sql);
      const fieldColumns = result.fields?.map((field) => field.name) || [];
      const columns = fieldColumns.length ? fieldColumns : ['rowCount'];
      const rows = fieldColumns.length && result.rows?.length
        ? rowsAsArrays(columns, result.rows)
        : [[result.rowCount ?? 0]];
      return res.json({ columns, rows });
    });
  } catch (error) {
    console.error('[database] query error:', error);
    res.status(400).json({ error: 'Query failed', message: error.message });
  }
});

router.get('/:project/tables', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const config = await getDatabaseConfig(projectDir);
    if (!config) return res.status(404).json({ error: 'Database not found' });

    const tables = await getTables(config);
    res.json({ type: config.type, tables });
  } catch (error) {
    console.error('[database] tables error:', error);
    res.status(500).json({ error: 'Failed to list tables', message: error.message });
  }
});

router.get('/:project/table/:name', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const config = await getDatabaseConfig(projectDir);
    if (!config) return res.status(404).json({ error: 'Database not found' });

    const tableName = req.params.name;
    const table = await ensureTable(config, tableName);
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    if (config.type === 'sqlite') {
      const db = openSqlite(config.path, { readonly: true });
      try {
        const actualColumns = table.columns.map((column) => column.name);
        const useRowid = table.primaryKey === '__rowid__';
        const selectColumns = useRowid ? ['__rowid__', ...actualColumns] : actualColumns;
        const rowidSql = useRowid ? 'rowid AS "__rowid__", ' : '';
        const rows = db.prepare(`SELECT ${rowidSql}* FROM ${quoteIdent(tableName)} LIMIT ? OFFSET ?`).all(limit, offset);
        const total = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdent(tableName)}`).get().count;
        return res.json({
          columns: selectColumns,
          rows: rowsAsArrays(selectColumns, rows),
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
          primaryKey: table.primaryKey,
        });
      } finally {
        db.close();
      }
    }

    return withPg(config.url, async (client) => {
      const columns = table.columns.map((column) => column.name);
      const [countResult, rowsResult] = await Promise.all([
        client.query(`SELECT COUNT(*)::int AS count FROM ${quoteIdent(tableName)}`),
        client.query(`SELECT * FROM ${quoteIdent(tableName)} LIMIT $1 OFFSET $2`, [limit, offset]),
      ]);
      const total = countResult.rows[0]?.count || 0;
      res.json({
        columns,
        rows: rowsAsArrays(columns, rowsResult.rows),
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        primaryKey: table.primaryKey,
      });
    });
  } catch (error) {
    console.error('[database] table rows error:', error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Failed to load table rows', message: error.message });
  }
});

router.put('/:project/table/:name/row', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const config = await getDatabaseConfig(projectDir);
    if (!config) return res.status(404).json({ error: 'Database not found' });

    const tableName = req.params.name;
    const table = await ensureTable(config, tableName);
    const { column, value } = req.body || {};
    const { column: primaryColumn, value: primaryValue } = resolvePrimaryKey(table, req.body || {});

    if (!column || !table.columns.some((entry) => entry.name === column)) {
      return res.status(400).json({ error: 'Valid column is required' });
    }

    if (!primaryColumn || primaryValue === undefined) {
      return res.status(400).json({ error: 'Primary key column and value are required' });
    }

    if (config.type === 'sqlite') {
      const db = openSqlite(config.path);
      try {
        const whereColumn = primaryColumn === '__rowid__' ? 'rowid' : quoteIdent(primaryColumn);
        const result = db
          .prepare(`UPDATE ${quoteIdent(tableName)} SET ${quoteIdent(column)} = ? WHERE ${whereColumn} = ?`)
          .run(value, primaryValue);

        return res.json({ ok: true, changes: result.changes });
      } finally {
        db.close();
      }
    }

    return withPg(config.url, async (client) => {
      const result = await client.query(
        `UPDATE ${quoteIdent(tableName)} SET ${quoteIdent(column)} = $1 WHERE ${quoteIdent(primaryColumn)} = $2`,
        [value, primaryValue],
      );
      res.json({ ok: true, changes: result.rowCount });
    });
  } catch (error) {
    console.error('[database] row update error:', error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Failed to update row', message: error.message });
  }
});

router.post('/:project/table/:name/row', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const config = await getDatabaseConfig(projectDir);
    if (!config) return res.status(404).json({ error: 'Database not found' });

    const tableName = req.params.name;
    const table = await ensureTable(config, tableName);
    const values = req.body?.values && typeof req.body.values === 'object' ? req.body.values : req.body || {};
    const entries = Object.entries(values).filter(([key, value]) => (
      table.columns.some((column) => column.name === key) && value !== undefined && value !== ''
    ));

    if (config.type === 'sqlite') {
      const db = openSqlite(config.path);
      try {
        if (!entries.length) {
          const result = db.prepare(`INSERT INTO ${quoteIdent(tableName)} DEFAULT VALUES`).run();
          return res.json({ ok: true, changes: result.changes, id: Number(result.lastInsertRowid || 0) });
        }

        const columns = entries.map(([key]) => quoteIdent(key)).join(', ');
        const placeholders = entries.map(() => '?').join(', ');
        const result = db
          .prepare(`INSERT INTO ${quoteIdent(tableName)} (${columns}) VALUES (${placeholders})`)
          .run(...entries.map(([, value]) => value));
        return res.json({ ok: true, changes: result.changes, id: Number(result.lastInsertRowid || 0) });
      } finally {
        db.close();
      }
    }

    return withPg(config.url, async (client) => {
      if (!entries.length) {
        const result = await client.query(`INSERT INTO ${quoteIdent(tableName)} DEFAULT VALUES`);
        return res.json({ ok: true, changes: result.rowCount });
      }

      const columns = entries.map(([key]) => quoteIdent(key)).join(', ');
      const placeholders = entries.map((_, index) => `$${index + 1}`).join(', ');
      const result = await client.query(
        `INSERT INTO ${quoteIdent(tableName)} (${columns}) VALUES (${placeholders})`,
        entries.map(([, value]) => value),
      );
      res.json({ ok: true, changes: result.rowCount });
    });
  } catch (error) {
    console.error('[database] row insert error:', error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Failed to add row', message: error.message });
  }
});

router.delete('/:project/table/:name/row', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const config = await getDatabaseConfig(projectDir);
    if (!config) return res.status(404).json({ error: 'Database not found' });

    const tableName = req.params.name;
    const table = await ensureTable(config, tableName);
    const primaryKey = req.body?.primaryKey || table.primaryKey;
    const value = req.body?.value;

    if (!primaryKey || value === undefined) {
      return res.status(400).json({ error: 'primaryKey and value are required' });
    }

    if (config.type === 'sqlite') {
      const db = openSqlite(config.path);
      try {
        const whereColumn = primaryKey === '__rowid__' ? 'rowid' : quoteIdent(primaryKey);
        const result = db.prepare(`DELETE FROM ${quoteIdent(tableName)} WHERE ${whereColumn} = ?`).run(value);
        return res.json({ ok: true, changes: result.changes });
      } finally {
        db.close();
      }
    }

    return withPg(config.url, async (client) => {
      const result = await client.query(
        `DELETE FROM ${quoteIdent(tableName)} WHERE ${quoteIdent(primaryKey)} = $1`,
        [value],
      );
      res.json({ ok: true, changes: result.rowCount });
    });
  } catch (error) {
    console.error('[database] row delete error:', error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Failed to delete row', message: error.message });
  }
});

async function sqliteDump(config) {
  const db = openSqlite(config.path, { readonly: true });
  try {
    const output = ['BEGIN TRANSACTION;'];
    const schemas = db
      .prepare(`
        SELECT type, name, tbl_name, sql
        FROM sqlite_master
        WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
        ORDER BY type = 'table' DESC, name ASC
      `)
      .all();

    for (const schema of schemas) {
      output.push(`${schema.sql};`);
      if (schema.type === 'table') {
        const columns = sqliteColumns(db, schema.name).map((column) => column.name);
        const rows = db.prepare(`SELECT * FROM ${quoteIdent(schema.name)}`).all();
        for (const row of rows) {
          output.push(
            `INSERT INTO ${quoteIdent(schema.name)} (${columns.map(quoteIdent).join(', ')}) VALUES (${columns.map((column) => sqlLiteral(row[column])).join(', ')});`,
          );
        }
      }
    }

    output.push('COMMIT;');
    return output.join('\n');
  } finally {
    db.close();
  }
}

async function postgresDump(config) {
  return withPg(config.url, async (client) => {
    const tables = await pgTables(config.url);
    const output = ['BEGIN;'];

    for (const table of tables) {
      const columnDefs = table.columns.map((column) => {
        const parts = [quoteIdent(column.name), column.type || 'text'];
        if (!column.nullable) parts.push('NOT NULL');
        if (column.default) parts.push(`DEFAULT ${column.default}`);
        return parts.join(' ');
      });
      const primaryKeys = table.columns.filter((column) => column.primaryKey).map((column) => quoteIdent(column.name));
      if (primaryKeys.length) columnDefs.push(`PRIMARY KEY (${primaryKeys.join(', ')})`);

      output.push(`CREATE TABLE IF NOT EXISTS ${quoteIdent(table.name)} (${columnDefs.join(', ')});`);
      const result = await client.query(`SELECT * FROM ${quoteIdent(table.name)}`);
      const columns = table.columns.map((column) => column.name);
      for (const row of result.rows) {
        output.push(
          `INSERT INTO ${quoteIdent(table.name)} (${columns.map(quoteIdent).join(', ')}) VALUES (${columns.map((column) => pgLiteral(row[column])).join(', ')});`,
        );
      }
    }

    output.push('COMMIT;');
    return output.join('\n');
  });
}

router.get('/:project/backup', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const config = await getDatabaseConfig(projectDir);
    if (!config) return res.status(404).json({ error: 'Database not found' });

    const dump = config.type === 'sqlite' ? await sqliteDump(config) : await postgresDump(config);
    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.project}-${config.type}-backup.sql"`);
    res.send(dump);
  } catch (error) {
    console.error('[database] backup error:', error);
    res.status(500).json({ error: 'Failed to create backup', message: error.message });
  }
});

router.post('/:project/restore', upload.single('file'), async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) return res.status(404).json({ error: 'Project not found' });

    const config = await getDatabaseConfig(projectDir);
    if (!config) return res.status(404).json({ error: 'Database not found' });

    const sql = req.file?.buffer?.toString('utf-8') || String(req.body?.sql || '');
    if (!sql.trim()) return res.status(400).json({ error: 'SQL dump is required' });

    if (config.type === 'sqlite') {
      const db = openSqlite(config.path);
      try {
        db.exec(sql);
      } finally {
        db.close();
      }
    } else {
      await withPg(config.url, async (client) => {
        await client.query(sql);
      });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('[database] restore error:', error);
    res.status(400).json({ error: 'Failed to restore backup', message: error.message });
  }
});

export default router;
