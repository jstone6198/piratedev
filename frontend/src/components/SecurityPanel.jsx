import React, { useMemo, useState } from 'react';
import { VscLoading, VscShield } from 'react-icons/vsc';
import api from '../api';

const severityOrder = ['critical', 'high', 'medium', 'low'];
const severityLabels = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  moderate: 'Medium',
};
const severityColors = {
  critical: '#ff4444',
  high: '#ff8800',
  medium: '#ffcc00',
  moderate: '#ffcc00',
  low: '#888888',
};

function emptyCounts() {
  return { critical: 0, high: 0, medium: 0, low: 0 };
}

function getCounts(findings) {
  return findings.reduce((counts, finding) => {
    const severity = finding.severity === 'moderate' ? 'medium' : finding.severity;
    if (counts[severity] !== undefined) counts[severity] += 1;
    return counts;
  }, emptyCounts());
}

function SeverityBadge({ severity }) {
  const normalized = severity === 'moderate' ? 'medium' : severity;
  return (
    <span style={{ ...styles.badge, borderColor: severityColors[normalized], color: severityColors[normalized] }}>
      {severityLabels[severity] || severity}
    </span>
  );
}

export default function SecurityPanel({ project, onFileOpen }) {
  const [tab, setTab] = useState('scan');
  const [findings, setFindings] = useState([]);
  const [hasScanned, setHasScanned] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [audit, setAudit] = useState(null);
  const [auditRun, setAuditRun] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  const counts = useMemo(() => getCounts(findings), [findings]);
  const groupedFindings = useMemo(() => {
    return severityOrder.reduce((groups, severity) => {
      groups[severity] = findings.filter((finding) => {
        const normalized = finding.severity === 'moderate' ? 'medium' : finding.severity;
        return normalized === severity;
      });
      return groups;
    }, {});
  }, [findings]);

  const scanProject = async () => {
    if (!project) return;
    setScanning(true);
    setError('');
    setToast('');
    try {
      const res = await api.post(`/security/${encodeURIComponent(project)}/scan`);
      setFindings(Array.isArray(res.data) ? res.data : []);
      setHasScanned(true);
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || err.message);
      setFindings([]);
      setHasScanned(true);
    } finally {
      setScanning(false);
    }
  };

  const auditDependencies = async () => {
    if (!project) return;
    setAuditing(true);
    setError('');
    setToast('');
    try {
      const res = await api.post(`/security/${encodeURIComponent(project)}/npm-audit`);
      setAudit(res.data);
      setAuditRun(true);
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || err.message);
      setAudit({ vulnerabilities: [], summary: { critical: 0, high: 0, moderate: 0, low: 0, total: 0 } });
      setAuditRun(true);
    } finally {
      setAuditing(false);
    }
  };

  const autoFix = async () => {
    if (!project) return;
    setFixing(true);
    setError('');
    setToast('');
    try {
      const res = await api.post(`/security/${encodeURIComponent(project)}/npm-audit-fix`);
      setToast(`Audit fix completed. Fixed ${res.data.fixed || 0} issue${res.data.fixed === 1 ? '' : 's'}.`);
      await auditDependencies();
    } catch (err) {
      setToast(`Audit fix failed: ${err.response?.data?.error || err.response?.data?.message || err.message}`);
    } finally {
      setFixing(false);
    }
  };

  const openFinding = (finding) => {
    if (typeof onFileOpen === 'function') {
      onFileOpen(finding.file, finding.line);
    }
  };

  if (!project) {
    return <div style={styles.panel}><div style={styles.empty}>Select a project</div></div>;
  }

  return (
    <div style={styles.panel}>
      <style>{'@keyframes security-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }'}</style>
      <div style={styles.header}>
        <div style={styles.title}>
          <VscShield size={16} />
          <span>Security Scanner</span>
        </div>
      </div>

      <div style={styles.tabs}>
        <button type="button" onClick={() => setTab('scan')} style={tab === 'scan' ? styles.activeTab : styles.tab}>
          Code Scan
        </button>
        <button type="button" onClick={() => setTab('dependencies')} style={tab === 'dependencies' ? styles.activeTab : styles.tab}>
          Dependencies
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}
      {toast && <div style={styles.toast}>{toast}</div>}

      {tab === 'scan' ? (
        <div style={styles.content}>
          <div style={styles.actionBar}>
            <button type="button" onClick={scanProject} style={styles.primaryButton} disabled={scanning}>
              {scanning ? <VscLoading size={15} style={styles.spin} /> : <VscShield size={15} />}
              {scanning ? 'Scanning...' : 'Scan Project'}
            </button>
          </div>

          {hasScanned && (
            <div style={styles.summary}>
              <span style={{ color: severityColors.critical }}>{counts.critical} critical</span>
              <span style={{ color: severityColors.high }}>{counts.high} high</span>
              <span style={{ color: severityColors.medium }}>{counts.medium} medium</span>
              <span style={{ color: severityColors.low }}>{counts.low} low</span>
            </div>
          )}

          {!hasScanned ? (
            <div style={styles.empty}>Run a scan to check this project for common security issues.</div>
          ) : scanning && findings.length === 0 ? (
            <div style={styles.empty}>Scanning project files...</div>
          ) : findings.length === 0 ? (
            <div style={styles.empty}>No findings detected.</div>
          ) : (
            <div style={styles.results}>
              {severityOrder.map((severity) => (
                groupedFindings[severity].length > 0 && (
                  <section key={severity} style={styles.group}>
                    <div style={{ ...styles.groupTitle, color: severityColors[severity] }}>
                      {severityLabels[severity]} ({groupedFindings[severity].length})
                    </div>
                    {groupedFindings[severity].map((finding, index) => (
                      <button
                        type="button"
                        key={`${finding.file}:${finding.line}:${finding.category}:${index}`}
                        style={styles.finding}
                        onClick={() => openFinding(finding)}
                      >
                        <div style={styles.findingTop}>
                          <span style={styles.location}>{finding.file}:{finding.line}</span>
                          <span style={styles.category}>{finding.category}</span>
                        </div>
                        <div style={styles.message}>{finding.message}</div>
                        <div style={styles.suggestion}>{finding.suggestion}</div>
                      </button>
                    ))}
                  </section>
                )
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={styles.content}>
          <div style={styles.actionBar}>
            <button type="button" onClick={auditDependencies} style={styles.primaryButton} disabled={auditing}>
              {auditing ? <VscLoading size={15} style={styles.spin} /> : <VscShield size={15} />}
              {auditing ? 'Auditing...' : 'Audit Dependencies'}
            </button>
            <button type="button" onClick={autoFix} style={styles.secondaryButton} disabled={fixing || auditing}>
              {fixing ? 'Fixing...' : 'Auto Fix'}
            </button>
          </div>

          {auditRun && audit?.summary && (
            <div style={styles.summary}>
              <span style={{ color: severityColors.critical }}>{audit.summary.critical || 0} critical</span>
              <span style={{ color: severityColors.high }}>{audit.summary.high || 0} high</span>
              <span style={{ color: severityColors.medium }}>{audit.summary.moderate || 0} moderate</span>
              <span style={{ color: severityColors.low }}>{audit.summary.low || 0} low</span>
              <span>{audit.summary.total || 0} total</span>
            </div>
          )}

          {!auditRun ? (
            <div style={styles.empty}>Run an audit to check installed npm packages.</div>
          ) : auditing && !audit ? (
            <div style={styles.empty}>Auditing dependencies...</div>
          ) : !audit?.vulnerabilities?.length ? (
            <div style={styles.empty}>No vulnerable packages reported.</div>
          ) : (
            <div style={styles.results}>
              {audit.vulnerabilities.map((vuln) => (
                <div key={vuln.name} style={styles.packageRow}>
                  <div style={styles.packageMain}>
                    <div style={styles.packageTop}>
                      <span style={styles.packageName}>{vuln.name}</span>
                      <SeverityBadge severity={vuln.severity} />
                    </div>
                    <div style={styles.packageMeta}>Installed: {vuln.installedVersion || vuln.range || 'unknown'}</div>
                    <div style={styles.packageMeta}>Range: {vuln.range || 'not specified'}</div>
                    <div style={styles.packageMeta}>Via: {vuln.via?.length ? vuln.via.join(', ') : 'direct advisory'}</div>
                  </div>
                  <span style={vuln.fixAvailable ? styles.fixYes : styles.fixNo}>
                    {vuln.fixAvailable ? 'Fix available' : 'No fix'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    background: '#1e1e1e',
    color: '#f0f0f0',
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 10px',
    borderBottom: '1px solid #333',
    background: '#1e1e1e',
    flexShrink: 0,
  },
  title: { display: 'flex', alignItems: 'center', gap: 7, color: '#f0f0f0', fontWeight: 600 },
  tabs: { display: 'flex', borderBottom: '1px solid #333', flexShrink: 0 },
  tab: {
    flex: 1,
    background: '#1e1e1e',
    color: '#888888',
    border: 0,
    borderRight: '1px solid #333',
    padding: '8px 10px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  activeTab: {
    flex: 1,
    background: '#2a2a2a',
    color: '#f0f0f0',
    border: 0,
    borderRight: '1px solid #333',
    padding: '8px 10px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  content: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 },
  actionBar: { display: 'flex', gap: 8, padding: 10, borderBottom: '1px solid #333', flexShrink: 0 },
  primaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    background: '#333',
    color: '#f0f0f0',
    border: '1px solid #555',
    borderRadius: 6,
    padding: '8px 12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: 600,
  },
  secondaryButton: {
    background: 'transparent',
    color: '#f0f0f0',
    border: '1px solid #333',
    borderRadius: 6,
    padding: '8px 12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  summary: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    padding: '8px 10px',
    borderBottom: '1px solid #333',
    background: '#242424',
    flexShrink: 0,
  },
  results: { overflowY: 'auto', minHeight: 0, flex: 1 },
  group: { borderBottom: '1px solid #333' },
  groupTitle: { padding: '8px 10px', background: '#242424', borderBottom: '1px solid #333', fontWeight: 700 },
  finding: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: '#1e1e1e',
    color: '#f0f0f0',
    border: 0,
    borderBottom: '1px solid #333',
    padding: '9px 10px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  findingTop: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, marginBottom: 5 },
  location: { color: '#f0f0f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 },
  category: {
    color: '#f0f0f0',
    border: '1px solid #333',
    background: '#2a2a2a',
    borderRadius: 6,
    padding: '2px 6px',
    fontSize: 10,
    flexShrink: 0,
  },
  message: { color: '#f0f0f0', lineHeight: 1.4 },
  suggestion: { color: '#888888', marginTop: 4, lineHeight: 1.4 },
  packageRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '10px',
    borderBottom: '1px solid #333',
  },
  packageMain: { minWidth: 0, flex: 1 },
  packageTop: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 },
  packageName: { color: '#f0f0f0', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  packageMeta: { color: '#888888', marginTop: 3, overflowWrap: 'anywhere' },
  badge: { border: '1px solid', borderRadius: 6, padding: '2px 6px', fontSize: 10, flexShrink: 0 },
  fixYes: { color: '#ffcc00', border: '1px solid #333', borderRadius: 6, padding: '3px 6px', whiteSpace: 'nowrap' },
  fixNo: { color: '#888888', border: '1px solid #333', borderRadius: 6, padding: '3px 6px', whiteSpace: 'nowrap' },
  empty: { padding: 14, color: '#888888', fontStyle: 'italic' },
  error: { padding: '7px 10px', color: '#ff4444', borderBottom: '1px solid #333', flexShrink: 0 },
  toast: { padding: '7px 10px', color: '#ffcc00', borderBottom: '1px solid #333', flexShrink: 0 },
  spin: { animation: 'security-spin 1s linear infinite' },
};
