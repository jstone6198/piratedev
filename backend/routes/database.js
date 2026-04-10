import { Router } from 'express';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const router = Router();

function getProjectDir(req) {
  const workspaceDir = req.app.locals.workspaceDir;
  const project = req.params.project;

  if (!project || project.includes('..') || project.startsWith('/')) {
    return null;
  }

  const projectDir = path.resolve(workspaceDir, project);
  if (!projectDir.startsWith(workspaceDir) || !existsSync(projectDir)) {
    return null;
  }

  return projectDir;
}

function getDbPath(projectDir) {
  return path.join(projectDir, 'data.db');
}

function getConnectionString(dbPath) {
  return `sqlite://${dbPath}`;
}

function listTables(db) {
  return db
    .prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name ASC
    `)
    .all()
    .map((row) => row.name);
}

function getDatabaseInfo(dbPath, db) {
  return {
    type: 'sqlite',
    connectionString: getConnectionString(dbPath),
    dbName: path.basename(dbPath),
    tables: listTables(db),
  };
}

function openDatabase(dbPath, options = {}) {
  return new Database(dbPath, options);
}

router.post('/:project/create', async (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const { type } = req.body || {};
    if (type !== 'sqlite') {
      return res.status(400).json({ error: 'Only sqlite is supported' });
    }

    const dbPath = getDbPath(projectDir);
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    const db = openDatabase(dbPath);
    try {
      db.pragma('journal_mode = WAL');
    } finally {
      db.close();
    }

    const statusDb = openDatabase(dbPath, { readonly: true });
    try {
      res.json(getDatabaseInfo(dbPath, statusDb));
    } finally {
      statusDb.close();
    }
  } catch (error) {
    console.error('[database] create error:', error);
    res.status(500).json({ error: 'Failed to create database', message: error.message });
  }
});

router.get('/:project/status', (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const dbPath = getDbPath(projectDir);
    if (!existsSync(dbPath)) {
      return res.json(null);
    }

    const db = openDatabase(dbPath, { readonly: true });
    try {
      res.json(getDatabaseInfo(dbPath, db));
    } finally {
      db.close();
    }
  } catch (error) {
    console.error('[database] status error:', error);
    res.status(500).json({ error: 'Failed to load database status', message: error.message });
  }
});

router.post('/:project/query', (req, res) => {
  try {
    const projectDir = getProjectDir(req);
    if (!projectDir) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const dbPath = getDbPath(projectDir);
    if (!existsSync(dbPath)) {
      return res.status(404).json({ error: 'Database not found' });
    }

    const sql = String(req.body?.sql || '').trim();
    if (!sql) {
      return res.status(400).json({ error: 'sql is required' });
    }

    const normalized = sql.replace(/^\s+/, '').toUpperCase();
    const returnsRows = /^(SELECT|PRAGMA|WITH|EXPLAIN)/.test(normalized);
    const db = openDatabase(dbPath);

    try {
      if (returnsRows) {
        const stmt = db.prepare(sql);
        const rows = stmt.all();
        const columns = stmt.columns().map((column) => column.name);
        return res.json({ columns, rows });
      }

      const result = db.prepare(sql).run();
      return res.json({
        columns: ['changes', 'lastInsertRowid'],
        rows: [
          {
            changes: result.changes,
            lastInsertRowid: Number(result.lastInsertRowid || 0),
          },
        ],
      });
    } finally {
      db.close();
    }
  } catch (error) {
    console.error('[database] query error:', error);
    res.status(400).json({ error: 'Query failed', message: error.message });
  }
});

export default router;
