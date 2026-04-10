import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VscAdd, VscClose, VscPlay, VscRocket, VscTrash } from 'react-icons/vsc';
import api, { socket } from '../api';

const STATUS_LABELS = {
  pending: 'Pending',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
};

function normalizePlan(plan) {
  if (!plan) {
    return null;
  }

  return {
    ...plan,
    steps: (plan.steps || []).map((step, index) => ({
      id: String(step.id ?? index + 1),
      description: step.description || '',
      code: step.code || '',
      status: step.status || 'pending',
      output: step.output || '',
    })),
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
      setPlan((currentPlan) => (currentPlan ? { ...currentPlan, steps: nextJob.steps } : currentPlan));
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
        })),
      };
      setJob(nextJob);
      setPlan((currentPlan) => normalizePlan(currentPlan));

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
    setPlan((currentPlan) => (currentPlan ? { ...currentPlan, steps: nextJob.steps } : currentPlan));
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
          code: '',
          status: 'pending',
          output: '',
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
                  </div>
                ))}
              </div>
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
