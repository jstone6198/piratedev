import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VscAdd, VscArrowDown, VscArrowUp, VscCheck, VscClose, VscError, VscFile, VscFileCode, VscPlay, VscRocket, VscTerminal, VscWarning } from 'react-icons/vsc';
import api, { socket } from '../api';
import DiffViewer from './DiffViewer';

const STATUS_LABELS = {
  draft: 'Draft',
  pending: 'Draft',
  active: 'Active',
  running: 'Active',
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
  const normalizedStatus = step.status === 'pending' ? 'draft' : step.status === 'running' ? 'active' : step.status || 'draft';
  return {
    id: String(step.id ?? index + 1),
    description: step.description || '',
    type: step.type || 'command',
    file: step.file || '',
    code: step.code || '',
    status: normalizedStatus,
    output: step.output || '',
    error: step.error || '',
    elapsed: Number(step.elapsed || 0),
    activeStartedAt: step.activeStartedAt || null,
    enabled: step.enabled !== false,
    tests: Array.isArray(step.tests) ? step.tests.map(normalizeTestResult) : [],
  };
}

function resequenceSteps(steps) {
  return steps.map((step, index) => normalizeStep({ ...step, id: String(index + 1) }, index));
}

function normalizeIncomingSteps(steps, previousSteps = []) {
  return (steps || []).map((step, index) => {
    const previous = previousSteps.find((candidate) => candidate.id === String(step.id ?? index + 1));
    const normalized = normalizeStep(step, index);
    return {
      ...normalized,
      activeStartedAt: normalized.status === 'active'
        ? previous?.activeStartedAt || Date.now()
        : normalized.activeStartedAt,
    };
  });
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
  const [activeElapsedTick, setActiveElapsedTick] = useState(0);
  const [draggedStepId, setDraggedStepId] = useState(null);
  const [expandedStep, setExpandedStep] = useState(null);
  const [currentBatch, setCurrentBatch] = useState(null);
  const [diffPreview, setDiffPreview] = useState(null);
  const [autoApply, setAutoApply] = useState(() => localStorage.getItem('piratedev-auto-apply') === 'true');

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
      setPlan((currentPlan) => (currentPlan ? {
        ...currentPlan,
        steps: normalizeIncomingSteps(nextJob.steps, currentPlan.steps),
        finalValidation: nextJob.finalValidation || null,
      } : currentPlan));
      setJob((currentJob) => ({
        ...nextJob,
        steps: normalizeIncomingSteps(nextJob.steps, currentJob?.steps || []),
      }));
      if (nextJob.status === 'done' || nextJob.status === 'failed') {
        setExecuting(false);
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    const handleStepUpdate = (update) => {
      if (!activeJobIdRef.current || update.jobId !== activeJobIdRef.current) {
        return;
      }

      const applyUpdate = (steps = []) => steps.map((step, index) => {
        if (index !== update.stepIndex) {
          return step;
        }

        const status = update.status === 'running' ? 'active' : update.status;
        return normalizeStep({
          ...step,
          status,
          output: update.output ?? step.output,
          error: update.error || step.error || '',
          elapsed: update.elapsed ?? step.elapsed,
          activeStartedAt: status === 'active' ? Date.now() : step.activeStartedAt,
        }, index);
      });

      setPlan((currentPlan) => (currentPlan ? {
        ...currentPlan,
        steps: applyUpdate(currentPlan.steps),
      } : currentPlan));
      setJob((currentJob) => (currentJob ? {
        ...currentJob,
        steps: applyUpdate(currentJob.steps),
      } : currentJob));
    };

    const handleBatchStart = (batch) => {
      if (!activeJobIdRef.current || batch.jobId !== activeJobIdRef.current) {
        return;
      }
      setCurrentBatch(batch);
    };

    socket.on('agent:job:update', handleUpdate);
    socket.on('agent:job:done', handleUpdate);
    socket.on('agent:step-update', handleStepUpdate);
    socket.on('agent:batch-start', handleBatchStart);
    return () => {
      socket.off('agent:job:update', handleUpdate);
      socket.off('agent:job:done', handleUpdate);
      socket.off('agent:step-update', handleStepUpdate);
      socket.off('agent:batch-start', handleBatchStart);
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
    const hasActiveStep = (plan?.steps || []).some((step) => step.status === 'active');
    if (!hasActiveStep) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setActiveElapsedTick((value) => value + 1);
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [plan]);

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
    const activeSteps = steps.filter((step) => step.status === 'active');
    const currentStepIndex = steps.findIndex((step) => step.status === 'active');
    const nextPendingIndex = steps.findIndex((step) => step.status === 'draft');
    const activeIndex = currentStepIndex >= 0 ? currentStepIndex : nextPendingIndex;
    const activeStep = activeIndex >= 0 ? steps[activeIndex] : null;

    return {
      totalSteps,
      completedSteps,
      percent: totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0,
      activeStepNumber: activeStep ? activeIndex + 1 : Math.min(completedSteps + 1, totalSteps),
      activeStepDescription: activeStep?.description || '',
      activeCount: activeSteps.length,
    };
  }, [job, plan, activeElapsedTick]);

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

  const toggleAutoApply = useCallback(() => {
    setAutoApply((prev) => {
      const next = !prev;
      localStorage.setItem('piratedev-auto-apply', String(next));
      return next;
    });
  }, []);

  const hasFileSteps = useCallback((steps) => {
    return steps.some((s) => s.type === 'edit_file' || s.type === 'create_file' || s.type === 'delete_file');
  }, []);

  const runExecution = async (executionPlan) => {
    setExecuting(true);
    setError('');
    setEditingStepId(null);

    try {
      const { data } = await api.post('/agent/execute', {
        planId: plan.id,
        plan: executionPlan,
        project,
      });

      return data;
    } catch (requestError) {
      setExecuting(false);
      setError(requestError.response?.data?.message || requestError.message);
      return null;
    }
  };

  const handleDiffApply = useCallback(async (acceptedIndices) => {
    setDiffPreview(null);
    if (acceptedIndices.length === 0) return;

    try {
      const enabledSteps = resequenceSteps((plan.steps || []).filter((step) => step.enabled !== false));
      await api.post('/diff/apply', {
        project,
        steps: enabledSteps,
        accepted: acceptedIndices,
      });
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      return;
    }

    // Now run the full plan via agent executor (commands, tests, etc.)
    const enabledSteps = resequenceSteps((plan.steps || []).filter((step) => step.enabled !== false));
    const executionPlan = { ...plan, steps: enabledSteps, finalValidation: null };
    const data = await runExecution(executionPlan);
    if (data) finishExecutionSetup(data, executionPlan);
  }, [plan, project]);

  const finishExecutionSetup = (data, executionPlan) => {
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
        status: 'draft',
        output: '',
        error: '',
        elapsed: 0,
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
        status: 'draft',
        output: '',
        error: '',
        elapsed: 0,
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

    // If file-editing steps exist and auto-apply is off, show diff preview
    if (!autoApply && hasFileSteps(enabledSteps) && project) {
      try {
        const { data: previewData } = await api.post('/diff/preview', {
          project,
          steps: enabledSteps,
        });
        if (previewData.diffs && previewData.diffs.length > 0) {
          setDiffPreview(previewData.diffs);
          return;
        }
      } catch {
        // If preview fails, fall through to direct execution
      }
    }

    const data = await runExecution(executionPlan);
    if (data) finishExecutionSetup(data, executionPlan);
  };

  const handleJobPoll = (nextJob, expectedJobId = activeJobIdRef.current) => {
    if (!nextJob || nextJob.jobId !== expectedJobId) {
      return;
    }
    setPlan((currentPlan) => (currentPlan ? {
      ...currentPlan,
      steps: normalizeIncomingSteps(nextJob.steps, currentPlan.steps),
      finalValidation: nextJob.finalValidation || null,
    } : currentPlan));
    setJob((currentJob) => ({
      ...nextJob,
      steps: normalizeIncomingSteps(nextJob.steps, currentJob?.steps || []),
    }));
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

  const reorderDraftStep = (sourceStepId, targetStepId) => {
    if (!sourceStepId || sourceStepId === targetStepId || !isEditingPlan) {
      return;
    }

    setPlan((currentPlan) => {
      const steps = [...currentPlan.steps];
      const sourceIndex = steps.findIndex((step) => step.id === sourceStepId);
      const targetIndex = steps.findIndex((step) => step.id === targetStepId);

      if (sourceIndex < 0 || targetIndex < 0) {
        return currentPlan;
      }

      const [sourceStep] = steps.splice(sourceIndex, 1);
      steps.splice(targetIndex, 0, sourceStep);

      return {
        ...currentPlan,
        steps: resequenceSteps(steps),
      };
    });
  };

  const toggleSkipStep = (stepId) => {
    updateStep(stepId, 'enabled', !(plan.steps.find((step) => step.id === stepId)?.enabled !== false));
  };

  const retryStep = (stepIndex) => {
    if (!jobId && !activeJobIdRef.current) {
      return;
    }

    socket.emit('agent:retry-step', {
      jobId: jobId || activeJobIdRef.current,
      stepIndex,
    });
  };

  const getStepElapsedSeconds = (step) => {
    if (step.status === 'active' && step.activeStartedAt) {
      return Math.max(0, Math.floor((Date.now() - step.activeStartedAt) / 1000));
    }
    return Math.max(0, Math.round(Number(step.elapsed || 0) / 1000));
  };

  const formatElapsed = (seconds) => `${seconds}s`;

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
    setCurrentBatch(null);
    setExpandedStep(null);
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
  const boardSteps = plan?.steps || [];
  const progressSummary = `${executionProgress.completedSteps} of ${executionProgress.totalSteps || boardSteps.length} steps complete (${executionProgress.activeCount} active)`;
  const typeIconMeta = {
    command: { Icon: VscTerminal, label: 'command' },
    test: { Icon: VscTerminal, label: 'command' },
    create_file: { Icon: VscFile, label: 'file' },
    edit_file: { Icon: VscFileCode, label: 'code' },
  };
  const kanbanColumns = [
    { key: 'draft', title: 'Draft' },
    { key: 'active', title: 'Active' },
    { key: 'done', title: 'Done' },
    { key: 'failed', title: 'Failed' },
  ];

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

  const renderTypeIcon = (step) => {
    const meta = typeIconMeta[step.type] || typeIconMeta.command;
    const Icon = meta.Icon;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#c8c8c8', fontSize: 11 }}>
        <Icon size={14} />
        {meta.label}
      </span>
    );
  };

  const renderStepCard = (step, index) => {
    const isDraft = step.status === 'draft';
    const isActive = step.status === 'active';
    const isDone = step.status === 'done';
    const isFailed = step.status === 'failed';
    const elapsed = formatElapsed(getStepElapsedSeconds(step));
    const errorPreview = step.error || (isFailed ? step.output : '');

    return (
      <div
        key={step.id}
        draggable={isEditingPlan && isDraft}
        onDragStart={() => setDraggedStepId(step.id)}
        onDragOver={(event) => {
          if (isEditingPlan && isDraft) {
            event.preventDefault();
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          reorderDraftStep(draggedStepId, step.id);
          setDraggedStepId(null);
        }}
        onClick={() => setExpandedStep({ step, index })}
        style={{
          border: `1px solid ${isFailed ? '#5c2b2b' : '#333333'}`,
          borderRadius: 8,
          background: step.enabled === false ? '#202020' : '#252526',
          padding: 12,
          cursor: 'pointer',
          opacity: step.enabled === false ? 0.55 : 1,
          transition: 'transform 180ms ease, border-color 180ms ease, background 180ms ease, opacity 180ms ease',
          transform: draggedStepId === step.id ? 'scale(0.98)' : 'scale(1)',
          minHeight: 128,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: '#9b9b9b', fontSize: 11, marginBottom: 6 }}>Step {index + 1}</div>
            <div style={{ color: '#f0f0f0', fontSize: 13, lineHeight: 1.35, wordBreak: 'break-word' }}>
              {step.description || 'Untitled step'}
            </div>
          </div>
          {isActive ? (
            <span style={{ width: 16, height: 16, border: '2px solid #333333', borderTopColor: '#007acc', borderRadius: '50%', animation: 'agent-spin 900ms linear infinite', flexShrink: 0 }} />
          ) : null}
          {isDone ? <VscCheck color="#4caf50" size={18} style={{ flexShrink: 0 }} /> : null}
          {isFailed ? <VscClose color="#f14c4c" size={18} style={{ flexShrink: 0 }} /> : null}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginTop: 12 }}>
          {renderTypeIcon(step)}
          {isActive || isDone ? <span style={{ color: '#9b9b9b', fontSize: 11 }}>{elapsed}</span> : null}
        </div>

        {step.file ? (
          <div style={{ marginTop: 8, color: '#9b9b9b', fontSize: 11, wordBreak: 'break-all' }}>
            {step.file}
          </div>
        ) : null}

        {isFailed && errorPreview ? (
          <div style={{ marginTop: 10, color: '#f48771', fontSize: 11, lineHeight: 1.35, maxHeight: 44, overflow: 'hidden' }}>
            {errorPreview}
          </div>
        ) : null}

        {isDraft && isEditingPlan ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                toggleSkipStep(step.id);
              }}
              style={{
                background: step.enabled === false ? '#3a2d1b' : '#1e1e1e',
                color: step.enabled === false ? '#ffcc66' : '#c8c8c8',
                border: '1px solid #333333',
                borderRadius: 6,
                padding: '6px 8px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              {step.enabled === false ? 'Skipped' : 'Skip'}
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setEditingStepId(step.id);
              }}
              style={{
                background: '#1e1e1e',
                color: '#c8c8c8',
                border: '1px solid #333333',
                borderRadius: 6,
                padding: '6px 8px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Edit
            </button>
          </div>
        ) : null}

        {isFailed ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              retryStep(index);
            }}
            style={{
              marginTop: 12,
              background: '#1e1e1e',
              color: '#f0f0f0',
              border: '1px solid #5c2b2b',
              borderRadius: 6,
              padding: '7px 10px',
              fontSize: 12,
              cursor: 'pointer',
              width: '100%',
            }}
          >
            Retry
          </button>
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
            @keyframes agent-spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
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
                  {currentBatch ? (
                    <div style={{ color: '#9b9b9b', fontSize: 11, marginTop: 4 }}>
                      Batch {currentBatch.batchIndex + 1}: steps {currentBatch.stepIndexes.map((stepIndex) => stepIndex + 1).join(', ')}
                    </div>
                  ) : null}
                </div>

                <div className="agent-plan-actions" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#888', cursor: 'pointer', userSelect: 'none' }}>
                    <input type="checkbox" checked={autoApply} onChange={toggleAutoApply} style={{ accentColor: '#5ba3f5' }} />
                    Auto-apply
                  </label>
                  <button className="agent-btn agent-btn-primary" onClick={executeCurrentPlan} type="button" disabled={executing || enabledStepCount === 0}>
                    <VscPlay />
                    <span>{executing ? 'Running...' : 'Execute All'}</span>
                  </button>
                </div>
              </div>

              {showExecutionProgress ? (
                <div
                  style={{
                    background: '#252526',
                    border: '1px solid #333333',
                    borderRadius: 8,
                    padding: '12px 14px',
                    margin: '0 20px 16px',
                    color: '#f0f0f0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    alignItems: 'center',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{progressSummary}</div>
                    <div style={{ color: '#9b9b9b', fontSize: 11, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {executionLabel}
                    </div>
                  </div>
                  <div style={{ color: '#9b9b9b', fontSize: 12, flexShrink: 0 }}>{executionProgress.percent}%</div>
                </div>
              ) : null}

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, minmax(190px, 1fr))',
                  gap: 12,
                  padding: '0 20px 20px',
                  overflowX: 'auto',
                }}
              >
                {kanbanColumns.map((column) => {
                  const columnSteps = boardSteps
                    .map((step, index) => ({ step, index }))
                    .filter(({ step }) => step.status === column.key);

                  return (
                    <div
                      key={column.key}
                      style={{
                        minWidth: 190,
                        background: '#1e1e1e',
                        border: '1px solid #333333',
                        borderRadius: 8,
                        padding: 10,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#f0f0f0', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
                        <span>{column.title}</span>
                        <span style={{ color: '#9b9b9b', fontSize: 11 }}>{columnSteps.length}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 160 }}>
                        {columnSteps.length > 0 ? (
                          columnSteps.map(({ step, index }) => renderStepCard(step, index))
                        ) : (
                          <div style={{ color: '#6f6f6f', fontSize: 12, border: '1px dashed #333333', borderRadius: 8, padding: 12 }}>
                            No steps
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {isEditingPlan ? (
                <div style={{ padding: '0 20px 20px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="agent-btn agent-btn-secondary" onClick={addStep} type="button">
                    <VscAdd />
                    <span>Add Step</span>
                  </button>
                  {editingStepId ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 240 }}>
                      <input
                        ref={(node) => {
                          if (node) {
                            stepInputRefs.current[editingStepId] = node;
                          } else {
                            delete stepInputRefs.current[editingStepId];
                          }
                        }}
                        className="agent-step-input"
                        value={plan.steps.find((step) => step.id === editingStepId)?.description || ''}
                        onChange={(event) => updateStep(editingStepId, 'description', event.target.value)}
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
                        style={{ margin: 0, flex: 1, background: '#1e1e1e', borderColor: '#333333', color: '#f0f0f0' }}
                      />
                      <button className="agent-btn agent-btn-secondary" onClick={() => removeStep(editingStepId)} type="button">
                        Delete
                      </button>
                    </div>
                  ) : null}
                  <button className="agent-btn agent-btn-secondary" onClick={() => moveStep(editingStepId, -1)} type="button" disabled={!editingStepId || editingStepId === '1'}>
                    <VscArrowUp />
                  </button>
                  <button className="agent-btn agent-btn-secondary" onClick={() => moveStep(editingStepId, 1)} type="button" disabled={!editingStepId || editingStepId === String(plan.steps.length)}>
                    <VscArrowDown />
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

        {expandedStep ? (() => {
          const currentStep = plan?.steps?.[expandedStep.index] || expandedStep.step;
          return (
            <div
              onClick={() => setExpandedStep(null)}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.55)',
                display: 'flex',
                justifyContent: 'flex-end',
                zIndex: 10000,
              }}
            >
              <div
                onClick={(event) => event.stopPropagation()}
                style={{
                  width: 'min(620px, 92vw)',
                  height: '100%',
                  background: '#1e1e1e',
                  color: '#f0f0f0',
                  borderLeft: '1px solid #333333',
                  padding: 20,
                  overflow: 'auto',
                  boxShadow: '-16px 0 32px rgba(0,0,0,0.35)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
                  <div>
                    <div style={{ color: '#9b9b9b', fontSize: 12, marginBottom: 6 }}>Step {expandedStep.index + 1} · {STATUS_LABELS[currentStep.status] || currentStep.status}</div>
                    <div style={{ fontSize: 18, lineHeight: 1.35 }}>{currentStep.description || 'Untitled step'}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedStep(null)}
                    style={{ background: '#252526', color: '#f0f0f0', border: '1px solid #333333', borderRadius: 6, padding: 8, cursor: 'pointer' }}
                  >
                    <VscClose />
                  </button>
                </div>

                <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
                  <div style={{ color: '#c8c8c8', fontSize: 12 }}>{renderTypeIcon(currentStep)} · {STEP_TYPE_LABELS[currentStep.type] || currentStep.type}</div>
                  <div style={{ color: currentStep.file ? '#c8c8c8' : '#7f7f7f', fontSize: 12, wordBreak: 'break-all' }}>
                    {currentStep.file || 'No file target'}
                  </div>
                  <pre style={{ background: '#252526', border: '1px solid #333333', borderRadius: 8, padding: 12, color: '#f0f0f0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                    {currentStep.code || 'No command'}
                  </pre>
                </div>

                {currentStep.error ? (
                  <div style={{ color: '#f48771', border: '1px solid #5c2b2b', background: '#2a1e1e', borderRadius: 8, padding: 12, marginBottom: 16, whiteSpace: 'pre-wrap' }}>
                    {currentStep.error}
                  </div>
                ) : null}

                <div style={{ color: '#c8c8c8', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Output</div>
                <pre style={{ background: '#252526', border: '1px solid #333333', borderRadius: 8, padding: 12, color: '#f0f0f0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: 180, margin: 0 }}>
                  {currentStep.output || 'No output yet.'}
                </pre>

                {Array.isArray(currentStep.tests) && currentStep.tests.length > 0 ? (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ color: '#c8c8c8', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Test Results</div>
                    {currentStep.tests.map(renderTestResult)}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })() : null}

        <div className="agent-footer">
          <button className="agent-btn agent-btn-secondary" onClick={resetPanel} type="button">
            Reset
          </button>
          {error ? <div className="agent-error">{error}</div> : <div className="agent-footer-note">Plans are persisted in `.piratedev/plans`.</div>}
        </div>
      </div>

      {diffPreview && (
        <DiffViewer
          diffs={diffPreview}
          onApply={handleDiffApply}
          onClose={() => setDiffPreview(null)}
        />
      )}
    </div>
  );
}
