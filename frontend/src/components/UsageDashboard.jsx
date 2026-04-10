import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { VscChromeClose, VscGraph, VscRefresh, VscTrash } from 'react-icons/vsc';
import api from '../api';

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Number(value) || 0);
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number(value) || 0);
}

function getScopeLabel(project, scope) {
  if (scope === 'current' && project) {
    return `Project: ${project}`;
  }

  return 'All projects';
}

export default function UsageDashboard({ isOpen, onClose, project }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState('');
  const [scope, setScope] = useState(project ? 'current' : 'all');

  useEffect(() => {
    setScope(project ? 'current' : 'all');
  }, [project]);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const params = scope === 'current' && project ? { project } : undefined;
      const { data } = await api.get('/ai/usage', { params });
      setStats(data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || 'Failed to load usage stats');
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [project, scope]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    loadStats();
  }, [isOpen, loadStats]);

  const handleReset = useCallback(async () => {
    if (!window.confirm('Reset all AI usage stats? This clears workspace/.usage-log.json.')) {
      return;
    }

    setResetting(true);
    setError('');

    try {
      await api.delete('/ai/usage');
      await loadStats();
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || 'Failed to reset usage stats');
    } finally {
      setResetting(false);
    }
  }, [loadStats]);

  const dailyBars = useMemo(() => {
    const rows = stats?.dailyTotals?.slice(-14) || [];
    const maxValue = rows.reduce((largest, row) => Math.max(largest, row.totalTokens || 0), 0);

    return rows.map((row) => ({
      ...row,
      height: maxValue > 0 ? Math.max(8, Math.round(((row.totalTokens || 0) / maxValue) * 100)) : 8,
    }));
  }, [stats]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay settings-overlay" onClick={onClose}>
      <div
        className="usage-dashboard"
        role="dialog"
        aria-modal="true"
        aria-label="AI usage dashboard"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="usage-dashboard-header">
          <div>
            <div className="usage-dashboard-kicker">
              <VscGraph />
              <span>AI Usage</span>
            </div>
            <h2>Usage Dashboard</h2>
            <p>{getScopeLabel(project, scope)}</p>
          </div>
          <button className="settings-close-btn" type="button" onClick={onClose} aria-label="Close usage dashboard">
            <VscChromeClose />
          </button>
        </div>

        <div className="usage-dashboard-toolbar">
          {project ? (
            <label className="usage-scope-picker">
              <span>Scope</span>
              <select value={scope} onChange={(event) => setScope(event.target.value)}>
                <option value="current">Current project</option>
                <option value="all">All projects</option>
              </select>
            </label>
          ) : (
            <div className="usage-scope-static">Scope: All projects</div>
          )}

          <div className="usage-toolbar-actions">
            <button className="toolbar-btn" type="button" onClick={loadStats} disabled={loading || resetting}>
              <VscRefresh />
              <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
            </button>
            <button className="toolbar-btn usage-reset-btn" type="button" onClick={handleReset} disabled={resetting}>
              <VscTrash />
              <span>{resetting ? 'Resetting...' : 'Reset Stats'}</span>
            </button>
          </div>
        </div>

        {error ? <div className="deploy-error usage-error">{error}</div> : null}

        <div className="usage-dashboard-body">
          <section className="usage-summary-grid">
            <div className="usage-summary-card">
              <span className="usage-summary-label">Today</span>
              <strong>{formatNumber(stats?.periods?.today?.totalTokens)} tokens</strong>
            </div>
            <div className="usage-summary-card">
              <span className="usage-summary-label">This week</span>
              <strong>{formatNumber(stats?.periods?.week?.totalTokens)} tokens</strong>
            </div>
            <div className="usage-summary-card">
              <span className="usage-summary-label">This month</span>
              <strong>{formatNumber(stats?.periods?.month?.totalTokens)} tokens</strong>
            </div>
          </section>

          <section className="usage-panel-grid">
            <div className="usage-panel-card">
              <div className="usage-panel-title">Cost by engine</div>
              <div className="usage-engine-list">
                {(stats?.perEngine?.length || 0) === 0 ? (
                  <div className="usage-empty-state">No engine usage recorded yet.</div>
                ) : (
                  stats.perEngine.map((entry) => (
                    <div className="usage-engine-row" key={entry.engine}>
                      <div>
                        <div className="usage-engine-name">{entry.engine === 'codex' ? 'Codex' : 'Claude'}</div>
                        <div className="usage-engine-meta">{formatNumber(entry.totalTokens)} tokens</div>
                      </div>
                      <div className="usage-engine-cost">{formatCurrency(entry.cost)}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="usage-panel-card">
              <div className="usage-panel-title">Daily usage, last 14 days</div>
              <div className="usage-chart" aria-label="Daily token usage chart">
                {dailyBars.map((entry) => (
                  <div className="usage-bar-group" key={entry.date} title={`${entry.date}: ${formatNumber(entry.totalTokens)} tokens`}>
                    <div className="usage-bar-track">
                      <div className="usage-bar-fill" style={{ height: `${entry.height}%` }} />
                    </div>
                    <span className="usage-bar-label">{entry.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="usage-table-card">
            <div className="usage-panel-title">Per-project token usage</div>
            {(stats?.perProject?.length || 0) === 0 ? (
              <div className="usage-empty-state">No usage logged yet.</div>
            ) : (
              <div className="usage-table-wrap">
                <table className="usage-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Input</th>
                      <th>Output</th>
                      <th>Total</th>
                      <th>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.perProject.map((entry) => (
                      <tr key={entry.project}>
                        <td>{entry.project}</td>
                        <td>{formatNumber(entry.tokensIn)}</td>
                        <td>{formatNumber(entry.tokensOut)}</td>
                        <td>{formatNumber(entry.totalTokens)}</td>
                        <td>{formatCurrency(entry.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
