import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VscAdd, VscCheck, VscClose, VscError, VscPlay, VscRocket, VscTrash, VscWarning } from 'react-icons/vsc';
import api, { socket } from '../api';

const STATUS_LABELS = {
  pending: 'Pending',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
};

const STEP_TYPE_LABELS = {
  command: 'Command',
  create_file: 'Create File',
  edit_file: 'Edit File',
  test: 'Test',
};

const TEST_STATUS_META = {
  passed: { icon: VscCheck, color: '#4caf50', label: 'Passed' },
  failed: { icon: VscError, color: '#f14c4c', label: 'Failed' },
  skipped: { icon: VscWarning, color: '#ffcc00', label: 'Skipped' },
  pending: { icon: VscWarning, color: '#808080', label: 'Pending' },
  running: { icon: VscWarning, color: '#007acc', label: 'Running' },
};

function normalizeTestResult(test, index) {
  return {
    id: String(test?.id ?? index + 1),
    name: test?.name || `Test ${index + 1}`,
    status: test?.status || 'pending',
    command: test?.command || '',
    file: test?.file || '',
    output: test?.output || '',
    attempts: Number(test?.attempts ?? 0),
    httpStatus: test?.httpStatus || '',
    responseSnippet: test?.responseSnippet || '',
  };
}

function normalizePlan(plan) {
  if (!plan) {
    return null;
  }

  return {
    ...plan,
    steps: (plan.steps || []).map((step, index) => ({
      id: String(step.id ?? index + 1),
      description: step.description || '',
      type: step.type || 'command',
      file: step.file || '',
      code: step.code || '',
      status: step.status || 'pending',
      output: step.output || '',
      tests: Array.isArray(step.tests) ? step.tests.map(normalizeTestResult) : [],
    })),
    finalValidation: plan.finalValidation ? {
      ...plan.finalValidation,
      results: Array.isArray(plan.finalValidation.results)
        ? plan.finalValidation.results.map(normalizeTestResult)
        : [],
    } : null,
  };
}

export default function AgentPanel({ project, visible, onClose }) {
  const promptRef = useRef(null);
  const pollRef = useRef(null);
  const activeJobIdRef = useRef(null);

  const [prompt, setPrompt] = useState('');
  const [engine, setEngine] = useState('codex');
  const [plan, setPlan] = useState(null);
  const [job, setJob] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      window.setTimeout(() => promptRef.current?.focus(), 40);
      return undefined;
    }

    window.clearInterval(pollRef.current);
    pollRef.current = null;
    activeJobIdRef.current = null;
    return undefined;
  }, [visible]);

  useEffect(() => {
    const handleUpdate = (nextJob) => {
      if (!activeJobIdRef.current || nextJob.jobId !== activeJobIdRef.current) {
        return;
      }
      setJob(nextJob);
      setPlan((currentPlan) => (currentPlan ? {
        ...currentPlan,
        steps: nextJob.steps,
        finalValidation: nextJob.finalValidation || null,
      } : currentPlan));
      if (nextJob.status === 'done' || nextJob.status === 'failed') {
        setExecuting(false);
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    socket.on('agent:job:update', handleUpdate);
    socket.on('agent:job:done', handleUpdate);
    return () => {
      socket.off('agent:job:update', handleUpdate);
      socket.off('agent:job:done', handleUpdate);
    };
  }, []);

  useEffect(() => () => {
    window.clearInterval(pollRef.current);
  }, []);

  const progress = useMemo(() => {
    if (job) {
      return job.progress ?? 0;
    }
    return 0;
  }, [job]);

  const generatePlan = async () => {
    if (!prompt.trim()) {
      return;
    }

    setLoadingPlan(true);
    setError('');
    setJob(null);
    setJobId(null);
    activeJobIdRef.current = null;

    try {
      const { data } = await api.post('/agent/plan', {
        prompt: prompt.trim(),
        engine,
        project,
      });
      setPlan(normalizePlan(data));
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message);
    } finally {
      setLoadingPlan(false);
    }
  };

  const executeCurrentPlan = async () => {
    if (!plan?.id) {
      return;
    }

    setExecuting(true);
    setError('');

    try {
      const { data } = await api.post('/agent/execute', {
        planId: plan.id,
        plan,
        project,
      });

      setJobId(data.jobId);
      activeJobIdRef.current = data.jobId;
      const nextJob = {
        jobId: data.jobId,
        planId: plan.id,
        status: data.status,
        progress: 0,
        completedSteps: 0,
        totalSteps: plan.steps.length,
        steps: plan.steps.map((step) => ({
          ...step,
          status: 'pending',
          output: '',
          tests: [],
        })),
        finalValidation: null,
      };
      setJob(nextJob);
      setPlan((currentPlan) => (currentPlan ? {
        ...normalizePlan(currentPlan),
        finalValidation: null,
        steps: currentPlan.steps.map((step) => ({
          ...step,
          status: 'pending',
          output: '',
          tests: [],
        })),
      } : currentPlan));

      window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(async () => {
        try {
          const statusResponse = await api.get(`/agent/status/${data.jobId}`);
          handleJobPoll(statusResponse.data, data.jobId);
        } catch {
          // Socket updates are the primary path.
        }
      }, 1200);
    } catch (requestError) {
      setExecuting(false);
      setError(requestError.response?.data?.message || requestError.message);
    }
  };

  const handleJobPoll = (nextJob, expectedJobId = activeJobIdRef.current) => {
    if (!nextJob || nextJob.jobId !== expectedJobId) {
      return;
    }
    setJob(nextJob);
    setPlan((currentPlan) => (currentPlan ? {
      ...currentPlan,
      steps: nextJob.steps,
      finalValidation: nextJob.finalValidation || null,
    } : currentPlan));
    if (nextJob.status === 'done' || nextJob.status === 'failed') {
      setExecuting(false);
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const updateStep = (stepId, field, value) => {
    setPlan((currentPlan) => ({
      ...currentPlan,
      steps: currentPlan.steps.map((step) => (
        step.id === stepId ? { ...step, [field]: value } : step
      )),
    }));
  };

  const addStep = () => {
    setPlan((currentPlan) => ({
      ...currentPlan,
      steps: [
        ...currentPlan.steps,
        {
          id: String(currentPlan.steps.length + 1),
          description: 'New step',
          type: 'command',
          file: '',
          code: '',
          status: 'pending',
          output: '',
          tests: [],
        },
      ],
    }));
  };

  const removeStep = (stepId) => {
    setPlan((currentPlan) => ({
      ...currentPlan,
      steps: currentPlan.steps
        .filter((step) => step.id !== stepId)
        .map((step, index) => ({ ...step, id: String(index + 1) })),
    }));
  };

  const resetPanel = () => {
    window.clearInterval(pollRef.current);
    pollRef.current = null;
    setPrompt('');
    setPlan(null);
    setJob(null);
    setJobId(null);
    activeJobIdRef.current = null;
    setExecuting(false);
    setError('');
  };

  if (!visible) {
    return null;
  }

  const renderTestResult = (test, options = {}) => {
    const meta = TEST_STATUS_META[test.status] || TEST_STATUS_META.pending;
    const Icon = meta.icon;
    const failed = test.status === 'failed';
    const hasOutput = Boolean(test.output);
    const isFinalValidation = options.variant === 'final-validation';
    const hasResponseDetails = Boolean(test.httpStatus || test.responseSnippet);

    return (
      <div
        key={test.id || `${test.name}-${test.command}`}
        style={{
          border: `1px solid ${failed ? '#5c2b2b' : '#333333'}`,
          borderRadius: 8,
          background: '#252526',
          padding: '10px 12px',
          marginTop: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: meta.color, fontSize: 12, fontWeight: 600 }}>
          <Icon />
          <span>{meta.label}</span>
          <span style={{ color: '#cccccc' }}>{test.name}</span>
        </div>
        {test.command ? (
          <div style={{ marginTop: 6, color: '#9b9b9b', fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {test.command}
          </div>
        ) : null}
        {test.file ? (
          <div style={{ marginTop: 4, color: '#9b9b9b', fontSize: 11 }}>
            File: {test.file}
          </div>
        ) : null}
        {isFinalValidation && hasResponseDetails ? (
          <div style={{ marginTop: 8, padding: 10, borderRadius: 6, background: '#1e1e1e', border: '1px solid #333333' }}>
            <div style={{ color: '#cccccc', fontSize: 12, fontWeight: 600 }}>
              HTTP Status: <span style={{ color: meta.color }}>{test.httpStatus || 'n/a'}</span>
            </div>
            <div style={{ marginTop: 8, color: '#007acc', fontSize: 11, fontWeight: 600 }}>
              Response preview (first 500 chars)
            </div>
            <pre className="agent-step-output" style={{ marginTop: 8, maxHeight: 220, color: '#cccccc', background: '#1e1e1e' }}>
              {test.responseSnippet || 'No response body captured.'}
            </pre>
          </div>
        ) : null}
        {failed && hasOutput ? (
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', color: '#f14c4c', fontSize: 12 }}>Show error output</summary>
            <pre
              className="agent-step-output"
              style={{ color: '#f14c4c', marginTop: 8, maxHeight: 220, background: '#1e1e1e' }}
            >
              {test.output}
            </pre>
          </details>
        ) : null}
        {!failed && hasOutput && !isFinalValidation ? (
          <pre className="agent-step-output" style={{ marginTop: 8, color: '#cccccc', background: '#1e1e1e' }}>
            {test.output}
          </pre>
        ) : null}
      </div>
    );
  };

  return (
    <div className="agent-overlay" onClick={onClose}>
      <div className="agent-modal" onClick={(event) => event.stopPropagation()}>
        <div className="agent-header">
          <div className="agent-title">
            <VscRocket />
            <span>Agent Mode</span>
          </div>
          <button className="agent-close" onClick={onClose} type="button">
            <VscClose />
          </button>
        </div>

        <div className="agent-body">
          <div className="agent-input-section">
            <textarea
              ref={promptRef}
              className="agent-textarea"
              placeholder="Describe what you want the agent to build..."
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />

            <div className="agent-controls">
              <select
                className="agent-engine-select"
                value={engine}
                onChange={(event) => setEngine(event.target.value)}
                disabled={loadingPlan || executing}
              >
                <option value="codex">Codex</option>
                <option value="claude">Claude</option>
              </select>

              <button
                className="agent-btn agent-btn-primary"
                onClick={generatePlan}
                type="button"
                disabled={loadingPlan || executing || !prompt.trim()}
              >
                {loadingPlan ? 'Generating...' : 'Generate Plan'}
              </button>
            </div>

            {!project && (
              <div className="agent-warning">Plan generation works best after selecting a project.</div>
            )}
          </div>

          {plan && (
            <div className="agent-plan-section">
              <div className="agent-plan-header">
                <div>
                  <div className="agent-plan-title">{plan.title}</div>
                  <div className="agent-plan-count">{plan.steps.length} steps</div>
                </div>

                <div className="agent-plan-actions">
                  <button className="agent-btn agent-btn-secondary" onClick={addStep} type="button" disabled={executing}>
                    <VscAdd />
                    <span>Add Step</span>
                  </button>
                  <button className="agent-btn agent-btn-primary" onClick={executeCurrentPlan} type="button" disabled={executing}>
                    <VscPlay />
                    <span>{executing ? 'Running...' : 'Execute'}</span>
                  </button>
                </div>
              </div>

              <div className="agent-progress-card">
                <div className="agent-progress-row">
                  <span>{job ? STATUS_LABELS[job.status] || job.status : 'Ready'}</span>
                  <span>{progress}%</span>
                </div>
                <div className="agent-progress-track">
                  <div className="agent-progress-fill" style={{ width: `${progress}%` }} />
                </div>
              </div>

              <div className="agent-steps-list">
                {plan.steps.map((step) => (
                  <div key={step.id} className={`agent-step agent-step-${step.status}`}>
                    <div className="agent-step-top">
                      <div className={`agent-step-indicator agent-step-indicator-${step.status}`} />
                      <div className="agent-step-meta">
                        <div className="agent-step-id">Step {step.id}</div>
                        <div className="agent-step-status-text">{STATUS_LABELS[step.status] || step.status}</div>
                      </div>
                      <button
                        className="agent-step-remove"
                        onClick={() => removeStep(step.id)}
                        type="button"
                        disabled={executing}
                        title="Remove step"
                      >
                        <VscTrash />
                      </button>
                    </div>

                    <input
                      className="agent-step-input"
                      value={step.description}
                      onChange={(event) => updateStep(step.id, 'description', event.target.value)}
                      disabled={executing}
                      placeholder="Step description"
                    />

                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 180px) minmax(0, 1fr)', gap: 10, marginBottom: 10 }}>
                      <select
                        className="agent-step-input"
                        value={step.type || 'command'}
                        onChange={(event) => updateStep(step.id, 'type', event.target.value)}
                        disabled={executing}
                        style={{ marginBottom: 0 }}
                      >
                        {Object.entries(STEP_TYPE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                      <input
                        className="agent-step-input"
                        value={step.file || ''}
                        onChange={(event) => updateStep(step.id, 'file', event.target.value)}
                        disabled={executing}
                        placeholder="Relative file path (optional)"
                        style={{ marginBottom: 0 }}
                      />
                    </div>

                    <textarea
                      className="agent-step-code"
                      value={step.code}
                      onChange={(event) => updateStep(step.id, 'code', event.target.value)}
                      disabled={executing}
                      placeholder="bash command or script"
                    />

                    {step.output ? (
                      <pre className="agent-step-output">{step.output}</pre>
                    ) : null}

                    {Array.isArray(step.tests) && step.tests.length > 0 ? (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ color: '#c8c8c8', fontSize: 12, fontWeight: 600 }}>Test Results</div>
                        {step.tests.map(renderTestResult)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              {plan.finalValidation?.results?.length ? (
                <div style={{ padding: '0 20px 20px' }}>
                  <div style={{ color: '#c8c8c8', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                    Final Validation
                  </div>
                  {plan.finalValidation.results.map((test) => renderTestResult(test, { variant: 'final-validation' }))}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="agent-footer">
          <button className="agent-btn agent-btn-secondary" onClick={resetPanel} type="button">
            Reset
          </button>
          {error ? <div className="agent-error">{error}</div> : <div className="agent-footer-note">Plans are persisted in `.josh-ide/plans`.</div>}
        </div>
      </div>
    </div>
  );
}
