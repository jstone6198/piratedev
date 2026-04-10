import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const workspaceDir = path.join(repoRoot, 'workspace');
const usageLogPath = path.join(workspaceDir, '.usage-log.json');

const CLAUDE_INPUT_RATE_PER_1K = 0.003;
const CLAUDE_OUTPUT_RATE_PER_1K = 0.015;

let writeQueue = Promise.resolve();

function estimateTokens(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(text.length / 4));
}

function roundCurrency(value) {
  return Number(value.toFixed(6));
}

function calculateCost(engine, tokensIn, tokensOut) {
  if (engine !== 'claude') {
    return 0;
  }

  const inputCost = (tokensIn / 1000) * CLAUDE_INPUT_RATE_PER_1K;
  const outputCost = (tokensOut / 1000) * CLAUDE_OUTPUT_RATE_PER_1K;
  return roundCurrency(inputCost + outputCost);
}

async function ensureUsageFile() {
  await fs.promises.mkdir(workspaceDir, { recursive: true });

  try {
    await fs.promises.access(usageLogPath, fs.constants.F_OK);
  } catch {
    await fs.promises.writeFile(usageLogPath, '[]\n', 'utf8');
  }
}

async function readUsageEntries() {
  await ensureUsageFile();

  try {
    const raw = await fs.promises.readFile(usageLogPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('[usage] Failed to read usage log:', error);
    return [];
  }
}

function buildEmptyDailyTotals(days) {
  const today = new Date();
  const totals = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() - offset,
    ));

    totals.push({
      date: date.toISOString().slice(0, 10),
      tokensIn: 0,
      tokensOut: 0,
      totalTokens: 0,
      cost: 0,
      count: 0,
    });
  }

  return totals;
}

function summarizeEntries(entries, { project = null, days = 30 } = {}) {
  const filteredEntries = project
    ? entries.filter((entry) => entry.project === project)
    : entries;
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const monthKey = todayKey.slice(0, 7);

  const totals = {
    tokensIn: 0,
    tokensOut: 0,
    totalTokens: 0,
    cost: 0,
    count: filteredEntries.length,
  };
  const periods = {
    today: { tokensIn: 0, tokensOut: 0, totalTokens: 0, cost: 0, count: 0 },
    week: { tokensIn: 0, tokensOut: 0, totalTokens: 0, cost: 0, count: 0 },
    month: { tokensIn: 0, tokensOut: 0, totalTokens: 0, cost: 0, count: 0 },
  };

  const perProjectMap = new Map();
  const perEngineMap = new Map();
  const dailyTotals = buildEmptyDailyTotals(days);
  const dailyMap = new Map(dailyTotals.map((item) => [item.date, item]));

  for (const entry of filteredEntries) {
    const tokensIn = Number(entry.tokensIn) || 0;
    const tokensOut = Number(entry.tokensOut) || 0;
    const totalTokens = tokensIn + tokensOut;
    const cost = Number(entry.cost) || 0;
    const projectKey = entry.project || 'Unassigned';
    const engineKey = entry.engine || 'unknown';
    const dateKey = typeof entry.timestamp === 'string' ? entry.timestamp.slice(0, 10) : '';
    const entryDate = dateKey ? new Date(`${dateKey}T00:00:00.000Z`) : null;

    totals.tokensIn += tokensIn;
    totals.tokensOut += tokensOut;
    totals.totalTokens += totalTokens;
    totals.cost += cost;

    if (dateKey === todayKey) {
      periods.today.tokensIn += tokensIn;
      periods.today.tokensOut += tokensOut;
      periods.today.totalTokens += totalTokens;
      periods.today.cost += cost;
      periods.today.count += 1;
    }

    if (entryDate) {
      const diffDays = Math.floor((Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate(),
      ) - entryDate.getTime()) / 86400000);

      if (diffDays >= 0 && diffDays < 7) {
        periods.week.tokensIn += tokensIn;
        periods.week.tokensOut += tokensOut;
        periods.week.totalTokens += totalTokens;
        periods.week.cost += cost;
        periods.week.count += 1;
      }
    }

    if (dateKey.slice(0, 7) === monthKey) {
      periods.month.tokensIn += tokensIn;
      periods.month.tokensOut += tokensOut;
      periods.month.totalTokens += totalTokens;
      periods.month.cost += cost;
      periods.month.count += 1;
    }

    if (!perProjectMap.has(projectKey)) {
      perProjectMap.set(projectKey, {
        project: projectKey,
        tokensIn: 0,
        tokensOut: 0,
        totalTokens: 0,
        cost: 0,
        count: 0,
      });
    }

    if (!perEngineMap.has(engineKey)) {
      perEngineMap.set(engineKey, {
        engine: engineKey,
        tokensIn: 0,
        tokensOut: 0,
        totalTokens: 0,
        cost: 0,
        count: 0,
      });
    }

    const projectSummary = perProjectMap.get(projectKey);
    projectSummary.tokensIn += tokensIn;
    projectSummary.tokensOut += tokensOut;
    projectSummary.totalTokens += totalTokens;
    projectSummary.cost += cost;
    projectSummary.count += 1;

    const engineSummary = perEngineMap.get(engineKey);
    engineSummary.tokensIn += tokensIn;
    engineSummary.tokensOut += tokensOut;
    engineSummary.totalTokens += totalTokens;
    engineSummary.cost += cost;
    engineSummary.count += 1;

    const daySummary = dailyMap.get(dateKey);
    if (daySummary) {
      daySummary.tokensIn += tokensIn;
      daySummary.tokensOut += tokensOut;
      daySummary.totalTokens += totalTokens;
      daySummary.cost += cost;
      daySummary.count += 1;
    }
  }

  totals.cost = roundCurrency(totals.cost);
  periods.today.cost = roundCurrency(periods.today.cost);
  periods.week.cost = roundCurrency(periods.week.cost);
  periods.month.cost = roundCurrency(periods.month.cost);

  const perProject = [...perProjectMap.values()]
    .map((entry) => ({ ...entry, cost: roundCurrency(entry.cost) }))
    .sort((a, b) => b.totalTokens - a.totalTokens || a.project.localeCompare(b.project));

  const perEngine = [...perEngineMap.values()]
    .map((entry) => ({ ...entry, cost: roundCurrency(entry.cost) }))
    .sort((a, b) => b.totalTokens - a.totalTokens || a.engine.localeCompare(b.engine));

  const normalizedDailyTotals = dailyTotals.map((entry) => ({
    ...entry,
    cost: roundCurrency(entry.cost),
  }));

  return {
    generatedAt: new Date().toISOString(),
    filter: { project },
    totals,
    periods,
    perProject,
    perEngine,
    dailyTotals: normalizedDailyTotals,
  };
}

export function createUsageEntry({
  engine,
  endpoint,
  prompt = '',
  response = '',
  project = null,
  user = null,
  timestamp = new Date().toISOString(),
}) {
  const tokensIn = estimateTokens(prompt);
  const tokensOut = estimateTokens(response);

  return {
    timestamp,
    engine: engine || 'unknown',
    endpoint: endpoint || 'unknown',
    tokensIn,
    tokensOut,
    cost: calculateCost(engine, tokensIn, tokensOut),
    project: project || null,
    user: user || null,
  };
}

export async function appendUsageEntry(entry) {
  writeQueue = writeQueue.then(async () => {
    const entries = await readUsageEntries();
    entries.push(entry);
    await fs.promises.writeFile(usageLogPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  }).catch((error) => {
    console.error('[usage] Failed to append usage entry:', error);
  });

  return writeQueue;
}

export async function getUsageStats({ project = null, days = 30 } = {}) {
  const entries = await readUsageEntries();
  return summarizeEntries(entries, { project, days });
}

export async function resetUsageLog() {
  writeQueue = writeQueue.then(async () => {
    await ensureUsageFile();
    await fs.promises.writeFile(usageLogPath, '[]\n', 'utf8');
  }).catch((error) => {
    console.error('[usage] Failed to reset usage log:', error);
  });

  return writeQueue;
}

export { usageLogPath };
