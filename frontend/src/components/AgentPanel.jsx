import React, { useState, useEffect, useRef, useCallback } from 'react';
import api, { socket } from '../api';

const STEP_TYPES = ['create_file', 'edit_file', 'run_command', 'install_package', 'test'];
const TYPE_COLORS = {
  create_file: '#4ec9b0',
  edit_file: '#dcdcaa',
  run_command: '#569cd6',
  install_package: '#c586c0',
  test: '#ce9178',
};
const STATUS_ICONS = { pending: '○', running: '◉', done: '✓', error: '✗' };

export default function AgentPanel({ project, visible, onClose }) {
  const [prompt, setPrompt] = useState('');
  const [engine, setEngine] = useState('codex');
  const [plan, setPlan] = useState(null);
  const [phase, setPhase] = useState('input'); // input | planning | review | executing | done
  const [stepStatuses, setStepStatuses] = useState({});
  const [stepLogs, setStepLogs] = useState({});
  const [expandedStep, setExpandedStep] = useState(null);
  const [error, setError] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  const promptRef = useRef(null);

  // Focus textarea when panel opens
  useEffect(() => {
    if (visible && phase === 'input') {
      setTimeout(() => promptRef.current?.focus(), 100);
    }
  }, [visible, phase]);

  // Socket listeners for execution progress
  useEffect(() => {
    const onStepStart = ({ stepId }) => {
      setStepStatuses(prev => ({ ...prev, [stepId]: 'running' }));
    };
    const onStepComplete = ({ stepId, output }) => {
      setStepStatuses(prev => ({ ...prev, [stepId]: 'done' }));
      setStepLogs(prev => ({ ...prev, [stepId]: (prev[stepId] || '') + (output || '') }));
    };
    const onLog = ({ stepId, message }) => {
      setStepLogs(prev => ({ ...prev, [stepId]: (prev[stepId] || '') + message }));
    };
    const onError = ({ stepId, error }) => {
      setStepStatuses(prev => ({ ...prev, [stepId]: 'error' }));
      setStepLogs(prev => ({ ...prev, [stepId]: (prev[stepId] || '') + '\nERROR: ' + error }));
    };
    const onDone = ({ results }) => {
      setPhase('done');
    };

    socket.on('agent:step-start', onStepStart);
    socket.on('agent:step-complete', onStepComplete);
    socket.on('agent:log', onLog);
    socket.on('agent:error', onError);
    socket.on('agent:done', onDone);

    return () => {
      socket.off('agent:step-start', onStepStart);
      socket.off('agent:step-complete', onStepComplete);
      socket.off('agent:log', onLog);
      socket.off('agent:error', onError);
      socket.off('agent:done', onDone);
    };
  }, []);

  const handleGeneratePlan = useCallback(async () => {
    if (!prompt.trim()) return;
    setPhase('planning');
    setError(null);
    try {
      const { data } = await api.post('/agent/plan', { prompt: prompt.trim(), engine });
      setPlan(data.plan);
      setStepStatuses({});
      setStepLogs({});
      setPhase('review');
    } catch (err) {
      setError(err.response?.data?.message || err.message);
      setPhase('input');
    }
  }, [prompt, engine]);

  const handleExecute = useCallback(async (startFrom = 0) => {
    if (!plan || !project) return;
    setPhase('executing');
    setError(null);

    // Mark all pending
    const statuses = {};
    plan.forEach((s, i) => {
      statuses[s.id] = i < startFrom ? 'done' : 'pending';
    });
    setStepStatuses(statuses);

    try {
      await api.post('/agent/execute', { plan, project, startFrom });
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  }, [plan, project]);

  const handleReset = () => {
    setPlan(null);
    setPhase('input');
    setStepStatuses({});
    setStepLogs({});
    setError(null);
    setExpandedStep(null);
  };

  // Step editing
  const updateStep = (idx, field, value) => {
    setPlan(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const removeStep = (idx) => {
    setPlan(prev => {
      const updated = prev.filter((_, i) => i !== idx);
      return updated.map((s, i) => ({ ...s, id: i + 1 }));
    });
  };

  const addStep = () => {
    setPlan(prev => [...prev, {
      id: prev.length + 1,
      type: 'run_command',
      description: 'New step',
      command: '',
    }]);
  };

  // Drag-to-reorder
  const handleDragStart = (idx) => setDragIdx(idx);
  const handleDragOver = (e, idx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    setPlan(prev => {
      const updated = [...prev];
      const [moved] = updated.splice(dragIdx, 1);
      updated.splice(idx, 0, moved);
      return updated.map((s, i) => ({ ...s, id: i + 1 }));
    });
    setDragIdx(idx);
  };
  const handleDragEnd = () => setDragIdx(null);

  // Find first failed step index for resume
  const failedIdx = plan?.findIndex(s => stepStatuses[s.id] === 'error') ?? -1;

  if (!visible) return null;

  return (
    <div className="agent-overlay" onClick={onClose}>
      <div className="agent-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="agent-header">
          <div className="agent-title">
            <span style={{ fontSize: 20 }}>🚀</span>
            <span>Agent Mode</span>
          </div>
          <button className="agent-close" onClick={onClose}>✕</button>
        </div>

        {/* Input Phase */}
        {(phase === 'input' || phase === 'planning') && (
          <div className="agent-input-section">
            <textarea
              ref={promptRef}
              className="agent-textarea"
              placeholder="Describe what you want to build..."
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleGeneratePlan();
              }}
              disabled={phase === 'planning'}
            />
            <div className="agent-controls">
              <select
                className="agent-engine-select"
                value={engine}
                onChange={e => setEngine(e.target.value)}
                disabled={phase === 'planning'}
              >
                <option value="codex">Codex (GPT-5.4)</option>
                <option value="claude">Claude (Sonnet)</option>
              </select>
              <button
                className="agent-btn agent-btn-primary"
                onClick={handleGeneratePlan}
                disabled={!prompt.trim() || phase === 'planning'}
              >
                {phase === 'planning' ? (
                  <><span className="agent-spinner" /> Generating Plan...</>
                ) : (
                  'Generate Plan'
                )}
              </button>
            </div>
            {!project && <div className="agent-warning">Select a project first</div>}
          </div>
        )}

        {/* Review Phase — editable checklist */}
        {(phase === 'review' || phase === 'executing' || phase === 'done') && plan && (
          <div className="agent-plan-section">
            <div className="agent-plan-header">
              <span className="agent-plan-count">{plan.length} steps</span>
              {phase === 'review' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="agent-btn agent-btn-secondary" onClick={addStep}>+ Add Step</button>
                  <button className="agent-btn agent-btn-primary" onClick={() => handleExecute(0)} disabled={!project}>
                    Execute Plan
                  </button>
                </div>
              )}
              {phase === 'done' && failedIdx >= 0 && (
                <button className="agent-btn agent-btn-primary" onClick={() => handleExecute(failedIdx)}>
                  Resume from Step {failedIdx + 1}
                </button>
              )}
              {phase === 'done' && failedIdx < 0 && (
                <span className="agent-done-badge">All steps complete</span>
              )}
            </div>

            <div className="agent-steps-list">
              {plan.map((step, idx) => {
                const status = stepStatuses[step.id] || 'pending';
                const isExpanded = expandedStep === step.id;
                const log = stepLogs[step.id];

                return (
                  <div
                    key={step.id}
                    className={`agent-step ${status} ${dragIdx === idx ? 'dragging' : ''}`}
                    draggable={phase === 'review'}
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={e => handleDragOver(e, idx)}
                    onDragEnd={handleDragEnd}
                  >
                    <div className="agent-step-row" onClick={() => setExpandedStep(isExpanded ? null : step.id)}>
                      <span className={`agent-step-status ${status}`}>
                        {status === 'running' ? <span className="agent-spinner-sm" /> : STATUS_ICONS[status]}
                      </span>
                      <span className="agent-step-id">#{step.id}</span>
                      <span className="agent-step-badge" style={{ background: TYPE_COLORS[step.type] || '#888' }}>
                        {step.type.replace('_', ' ')}
                      </span>
                      <span className="agent-step-desc">{step.description}</span>
                      {step.file && <span className="agent-step-file">{step.file}</span>}
                      <span className="agent-step-expand">{isExpanded ? '▲' : '▼'}</span>
                      {phase === 'review' && (
                        <button className="agent-step-remove" onClick={e => { e.stopPropagation(); removeStep(idx); }}>×</button>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="agent-step-detail">
                        {phase === 'review' ? (
                          <>
                            <div className="agent-field">
                              <label>Type</label>
                              <select value={step.type} onChange={e => updateStep(idx, 'type', e.target.value)}>
                                {STEP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </div>
                            <div className="agent-field">
                              <label>Description</label>
                              <input value={step.description} onChange={e => updateStep(idx, 'description', e.target.value)} />
                            </div>
                            {(step.type === 'create_file' || step.type === 'edit_file') && (
                              <>
                                <div className="agent-field">
                                  <label>File</label>
                                  <input value={step.file || ''} onChange={e => updateStep(idx, 'file', e.target.value)} />
                                </div>
                                <div className="agent-field">
                                  <label>Content</label>
                                  <textarea className="agent-content-edit" value={step.content || ''} onChange={e => updateStep(idx, 'content', e.target.value)} />
                                </div>
                              </>
                            )}
                            {(step.type === 'run_command' || step.type === 'install_package' || step.type === 'test') && (
                              <div className="agent-field">
                                <label>Command</label>
                                <input value={step.command || ''} onChange={e => updateStep(idx, 'command', e.target.value)} />
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            {step.file && <div className="agent-detail-line"><strong>File:</strong> {step.file}</div>}
                            {step.command && <div className="agent-detail-line"><strong>Command:</strong> <code>{step.command}</code></div>}
                            {step.content && (
                              <pre className="agent-content-preview">{step.content.slice(0, 500)}{step.content.length > 500 ? '...' : ''}</pre>
                            )}
                          </>
                        )}
                        {log && <pre className="agent-step-log">{log}</pre>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="agent-footer">
              <button className="agent-btn agent-btn-secondary" onClick={handleReset}>New Plan</button>
              {phase === 'executing' && <span className="agent-executing-label"><span className="agent-spinner" /> Executing...</span>}
            </div>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="agent-error">
            <strong>Error:</strong> {error}
            <button onClick={() => setError(null)} style={{ marginLeft: 12, background: 'none', border: 'none', color: '#f48771', cursor: 'pointer' }}>dismiss</button>
          </div>
        )}
      </div>
    </div>
  );
}
