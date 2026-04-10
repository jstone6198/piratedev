import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VscAdd, VscArrowDown, VscArrowUp, VscCheck, VscClose, VscError, VscPlay, VscRocket, VscWarning } from 'react-icons/vsc';
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

const PLAN_GENERATION_PHASES = [
  'Analyzing requirements...',
  'Designing architecture...',
  'Planning steps...',
  'Structuring output...',
];

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
    steps: (plan.steps || []).map((step, index) => normalizeStep(step, index)),
    finalValidation: plan.finalValidation ? {
      ...plan.finalValidation,
      results: Array.isArray(plan.finalValidation.results)
        ? plan.finalValidation.results.map(normalizeTestResult)
        : [],
    } : null,
  };
}

function normalizeStep(step, index) {
  return {
    id: String(step.id ?? index + 1),
    description: step.description || '',
    type: step.type || 'command',
    file: step.file || '',
    code: step.code || '',
    status: step.status || 'pending',
    output: step.output || '',
    enabled: step.enabled !== false,
    tests: Array.isArray(step.tests) ? step.tests.map(normalizeTestResult) : [],
  };
}

function resequenceSteps(steps) {
  return steps.map((step, index) => normalizeStep({ ...step, id: String(index + 1) }, index));
}

export default function AgentPanel({ project, visible, onClose }) {
  const promptRef = useRef(null);
  const pollRef = useRef(null);
  const activeJobIdRef = useRef(null);
  const stepInputRefs = useRef({});

  const [prompt, setPrompt] = useState('');
  const [engine, setEngine] = useState('codex');
  const [plan, setPlan] = useState(null);
  const [job, setJob] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState('');
  const [editingStepId, setEditingStepId] = useState(null);
  const [planElapsedSeconds, setPlanElapsedSeconds] = useState(0);

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

  useEffect(() => {
    if (!loadingPlan) {
      setPlanElapsedSeconds(0);
      return undefined;
    }

    const startedAt = Date.now();
    setPlanElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setPlanElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadingPlan]);

  useEffect(() => {
    if (!editingStepId) {
      return undefined;
    }

    const input = stepInputRefs.current[editingStepId];
    if (input) {
      input.focus();
      input.select();
    }

    return undefined;
  }, [editingStepId]);

  const executionProgress = useMemo(() => {
    const steps = job?.steps || plan?.steps || [];
    const totalSteps = Number(job?.totalSteps || steps.length || 0);
    const completedFromSteps = steps.filter((step) => step.status === 'done').length;
    const completedSteps = Math.max(Number(job?.completedSteps || 0), completedFromSteps);
    const currentStepIndex = steps.findIndex((step) => step.status === 'running');
    const nextPendingIndex = steps.findIndex((step) => step.status === 'pending');
    const activeIndex = currentStepIndex >= 0 ? currentStepIndex : nextPendingIndex;
    const activeStep = activeIndex >= 0 ? steps[activeIndex] : null;

    return {
      totalSteps,
      completedSteps,
      percent: totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0,
      activeStepNumber: activeStep ? activeIndex + 1 : Math.min(completedSteps + 1, totalSteps),
      activeStepDescription: activeStep?.description || '',
    };
  }, [job, plan]);

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

    const enabledSteps = resequenceSteps((plan.steps || []).filter((step) => step.enabled !== false));
    if (enabledSteps.length === 0) {
      setError('Enable at least one step before executing the plan.');
      return;
    }

    const executionPlan = {
      ...plan,
      steps: enabledSteps,
      finalValidation: null,
    };

    setExecuting(true);
    setError('');
    setEditingStepId(null);

    try {
      const { data } = await api.post('/agent/execute', {
        planId: plan.id,
        plan: executionPlan,
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
        totalSteps: executionPlan.steps.length,
        steps: executionPlan.steps.map((step) => ({
          ...step,
          status: 'pending',
          output: '',
          tests: [],
        })),
        finalValidation: null,
      };
      setJob(nextJob);
      setPlan((currentPlan) => (currentPlan ? {
        ...normalizePlan(executionPlan),
        finalValidation: null,
        steps: executionPlan.steps.map((step) => ({
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
    let nextStepId = null;

    setPlan((currentPlan) => {
      nextStepId = String(currentPlan.steps.length + 1);

      return {
        ...currentPlan,
        steps: resequenceSteps([
          ...currentPlan.steps,
          {
            id: nextStepId,
            description: 'New step',
            type: 'command',
            file: '',
            code: '',
            status: 'pending',
            output: '',
            enabled: true,
            tests: [],
          },
        ]),
      };
    });

    window.setTimeout(() => {
      setEditingStepId(nextStepId);
    }, 0);
  };

  const removeStep = (stepId) => {
    setPlan((currentPlan) => ({
      ...currentPlan,
      steps: resequenceSteps(currentPlan.steps
        .filter((step) => step.id !== stepId)
      ),
    }));
    setEditingStepId((currentEditingStepId) => (currentEditingStepId === stepId ? null : currentEditingStepId));
  };

  const moveStep = (stepId, direction) => {
    setPlan((currentPlan) => {
      const currentIndex = currentPlan.steps.findIndex((step) => step.id === stepId);
      const nextIndex = currentIndex + direction;

      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= currentPlan.steps.length) {
        return currentPlan;
      }

      const nextSteps = [...currentPlan.steps];
      const [step] = nextSteps.splice(currentIndex, 1);
      nextSteps.splice(nextIndex, 0, step);

      return {
        ...currentPlan,
        steps: resequenceSteps(nextSteps),
      };
    });
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

  const enabledStepCount = plan?.steps?.filter((step) => step.enabled !== false).length ?? 0;
  const isEditingPlan = Boolean(plan) && !executing && !job;
  const currentPhase = PLAN_GENERATION_PHASES[Math.floor(planElapsedSeconds / 5) % PLAN_GENERATION_PHASES.length];
  const showExecutionProgress = Boolean(job || executing);
  const executionLabel = executionProgress.activeStepDescription
    ? `Executing step ${executionProgress.activeStepNumber} of ${executionProgress.totalSteps}: ${executionProgress.activeStepDescription}`
    : `${STATUS_LABELS[job?.status] || 'Executing'} ${executionProgress.completedSteps} of ${executionProgress.totalSteps} steps`;

  const renderStepStatusIcon = (status) => {
    if (status === 'done') {
      return (
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            background: 'rgba(78, 201, 176, 0.14)',
            border: '1px solid rgba(78, 201, 176, 0.65)',
            color: '#4ec9b0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
          title="Completed"
        >
          <VscCheck size={14} />
        </div>
      );
    }

    if (status === 'failed') {
      return (
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            background: 'rgba(244, 135, 113, 0.14)',
            border: '1px solid rgba(244, 135, 113, 0.7)',
            color: '#f48771',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
          title="Failed"
        >
          <VscClose size={14} />
        </div>
      );
    }

    return (
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: status === 'running' ? '#007acc' : '#666666',
          boxShadow: status === 'running' ? '0 0 0 6px rgba(0, 122, 204, 0.12)' : 'none',
          flexShrink: 0,
        }}
        title={STATUS_LABELS[status] || status}
      />
    );
  };

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
        <style>
          {`
            @keyframes agent-plan-shimmer {
              0% { background-position: -160px 0; }
              100% { background-position: 160px 0; }
            }
          `}
        </style>
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

            {loadingPlan ? (
              <div style={{ marginTop: 12 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    color: '#c8c8c8',
                    fontSize: 12,
                    marginBottom: 8,
                  }}
                >
                  <span>Generating plan... ({planElapsedSeconds}s)</span>
                  <span style={{ color: '#007acc', flexShrink: 0 }}>{currentPhase}</span>
                  {planElapsedSeconds > 60 ? (
                    <span style={{ color: '#9b9b9b', whiteSpace: 'nowrap' }}>Complex plans take longer. Still working...</span>
                  ) : null}
                </div>
                <div
                  style={{
                    width: '100%',
                    background: '#1e1e2e',
                    borderRadius: 4,
                    overflow: 'hidden',
                    height: 4,
                  }}
                >
                  <div
                    style={{
                      height: 4,
                      width: '100%',
                      background: 'linear-gradient(90deg, rgba(0, 122, 204, 0.18), #007acc, #0098ff, rgba(0, 122, 204, 0.18))',
                      backgroundSize: '160px 4px',
                      animation: 'agent-plan-shimmer 1.15s linear infinite',
                    }}
                  />
                </div>
              </div>
            ) : null}

            {!project && (
              <div className="agent-warning">Plan generation works best after selecting a project.</div>
            )}
          </div>

          {plan && (
            <div className="agent-plan-section">
              <div className="agent-plan-header">
                <div>
                  <div className="agent-plan-title">{plan.title}</div>
                  <div className="agent-plan-count">{enabledStepCount} of {plan.steps.length} steps enabled</div>
                </div>

                <div className="agent-plan-actions">
                  <button className="agent-btn agent-btn-primary" onClick={executeCurrentPlan} type="button" disabled={executing || enabledStepCount === 0}>
                    <VscPlay />
                    <span>{executing ? 'Running...' : 'Execute'}</span>
                  </button>
                </div>
              </div>

              {showExecutionProgress ? (
                <div
                  className="agent-progress-card"
                  style={{
                    background: '#252526',
                    border: '1px solid #333333',
                    borderRadius: 8,
                    padding: '12px 14px',
                    margin: '0 20px 16px',
                  }}
                >
                  <div
                    className="agent-progress-row"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      color: '#c8c8c8',
                      fontSize: 12,
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{executionLabel}</span>
                    <span style={{ color: '#9b9b9b', flexShrink: 0 }}>{executionProgress.percent}%</span>
                  </div>
                  <div
                    className="agent-progress-track"
                    style={{
                      width: '100%',
                      background: '#1e1e2e',
                      borderRadius: 4,
                      overflow: 'hidden',
                      height: 4,
                    }}
                  >
                    <div
                      className="agent-progress-fill"
                      style={{
                        width: `${executionProgress.percent}%`,
                        background: 'linear-gradient(90deg, #007acc, #0098ff)',
                        height: 4,
                        transition: 'width 220ms ease',
                      }}
                    />
                  </div>
                </div>
              ) : null}

              <div className="agent-steps-list">
                {plan.steps.map((step) => (
                  <div key={step.id} className={`agent-step agent-step-${step.status}`}>
                    {isEditingPlan ? (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '4px 0',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={step.enabled !== false}
                          onChange={(event) => updateStep(step.id, 'enabled', event.target.checked)}
                          style={{ accentColor: '#007acc', width: 16, height: 16, margin: 0 }}
                          aria-label={`Enable step ${step.id}`}
                        />
                        <div style={{ color: '#9b9b9b', fontSize: 12, minWidth: 48 }}>Step {step.id}</div>
                        {editingStepId === step.id ? (
                          <input
                            ref={(node) => {
                              if (node) {
                                stepInputRefs.current[step.id] = node;
                              } else {
                                delete stepInputRefs.current[step.id];
                              }
                            }}
                            className="agent-step-input"
                            value={step.description}
                            onChange={(event) => updateStep(step.id, 'description', event.target.value)}
                            onBlur={() => setEditingStepId(null)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                event.currentTarget.blur();
                              }
                              if (event.key === 'Escape') {
                                setEditingStepId(null);
                              }
                            }}
                            placeholder="Step title"
                            style={{ margin: 0, flex: 1, background: '#1e1e1e', borderColor: '#007acc' }}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditingStepId(step.id)}
                            style={{
                              flex: 1,
                              textAlign: 'left',
                              background: 'transparent',
                              border: '1px solid transparent',
                              color: step.enabled !== false ? '#cccccc' : '#7f7f7f',
                              fontSize: 14,
                              padding: '8px 10px',
                              borderRadius: 6,
                              cursor: 'text',
                            }}
                            title="Edit step title"
                          >
                            {step.description || 'Untitled step'}
                          </button>
                        )}
                        <div style={{ color: '#007acc', fontSize: 11, textTransform: 'uppercase' }}>
                          {STEP_TYPE_LABELS[step.type] || step.type}
                        </div>
                        <button
                          className="agent-step-remove"
                          onClick={() => moveStep(step.id, -1)}
                          type="button"
                          title="Move step up"
                          disabled={step.id === '1'}
                        >
                          <VscArrowUp />
                        </button>
                        <button
                          className="agent-step-remove"
                          onClick={() => moveStep(step.id, 1)}
                          type="button"
                          title="Move step down"
                          disabled={step.id === String(plan.steps.length)}
                        >
                          <VscArrowDown />
                        </button>
                        <button
                          className="agent-step-remove"
                          onClick={() => removeStep(step.id)}
                          type="button"
                          title="Delete step"
                        >
                          <VscClose />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="agent-step-top">
                          {renderStepStatusIcon(step.status)}
                          <div className="agent-step-meta">
                            <div className="agent-step-id">Step {step.id}</div>
                            <div className="agent-step-status-text">{STATUS_LABELS[step.status] || step.status}</div>
                          </div>
                        </div>

                        <div style={{ color: '#cccccc', fontSize: 14, marginBottom: 10 }}>{step.description || 'Untitled step'}</div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 180px) minmax(0, 1fr)', gap: 10, marginBottom: 10 }}>
                          <div
                            className="agent-step-input"
                            style={{
                              marginBottom: 0,
                              display: 'flex',
                              alignItems: 'center',
                              background: '#1e1e1e',
                              color: '#cccccc',
                            }}
                          >
                            {STEP_TYPE_LABELS[step.type] || step.type}
                          </div>
                          <div
                            className="agent-step-input"
                            style={{
                              marginBottom: 0,
                              display: 'flex',
                              alignItems: 'center',
                              background: '#1e1e1e',
                              color: step.file ? '#cccccc' : '#7f7f7f',
                            }}
                          >
                            {step.file || 'No file target'}
                          </div>
                        </div>

                        <textarea
                          className="agent-step-code"
                          value={step.code}
                          readOnly
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
                      </>
                    )}
                  </div>
                ))}
              </div>

              {isEditingPlan ? (
                <div style={{ padding: '0 20px 20px' }}>
                  <button className="agent-btn agent-btn-secondary" onClick={addStep} type="button">
                    <VscAdd />
                    <span>Add Step</span>
                  </button>
                </div>
              ) : null}

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
