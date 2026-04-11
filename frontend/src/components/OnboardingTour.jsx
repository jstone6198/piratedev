import React, { useCallback, useEffect, useMemo, useState } from 'react';

export const ONBOARDING_STORAGE_KEY = 'onboarding-complete';
export const ONBOARDING_START_EVENT = 'josh:onboarding-start';

const steps = [
  {
    title: 'Welcome to Josh IDE!',
    body: 'Build, edit, run, preview, and deploy your project from one workspace.',
  },
  {
    title: 'File Explorer',
    body: 'Your project files live here',
    target: ['.file-explorer', '.sidebar-shell', '.sidebar', '.mobile-files-body'],
  },
  {
    title: 'Editor area',
    body: 'Write code here with IntelliSense',
    target: ['.editor-area', '.monaco-editor', '.mobile-editor-stage'],
  },
  {
    title: 'AI Chat',
    body: 'Ask the AI to build features for you',
    target: ['.ai-sidebar', '.ai-chat-container', '.toolbar-btn[title="Toggle AI Chat"]'],
  },
  {
    title: 'Terminal',
    body: 'Run commands and see output',
    target: ['.terminal-area', '.bottom-panel-content', '.terminal-container', '[data-testid="terminal"]'],
  },
  {
    title: 'Preview',
    body: 'See your app live as you code',
    target: ['.preview-sidebar', '.toolbar-btn[title="Toggle Live Preview"]'],
  },
  {
    title: 'Deploy button',
    body: 'Deploy to a live URL with one click',
    target: ['.deploy-btn', '.toolbar-mobile-menu-btn:not(:disabled)'],
  },
  {
    title: "You're ready! Create your first project.",
    body: 'Start with a blank project or open an existing workspace.',
    cta: 'Create your first project',
  },
];

export function startOnboardingTour() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ONBOARDING_START_EVENT));
}

function readCompleteFlag() {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeCompleteFlag() {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
  } catch {}
}

function getTargetElement(target) {
  const selectors = Array.isArray(target) ? target : [target];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) return element;
  }

  return null;
}

function getRect(target) {
  if (!target) return null;

  const element = getTargetElement(target);
  if (!element) return null;

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const padding = 8;
  return {
    top: Math.max(8, rect.top - padding),
    left: Math.max(8, rect.left - padding),
    width: Math.min(window.innerWidth - 16, rect.width + padding * 2),
    height: Math.min(window.innerHeight - 16, rect.height + padding * 2),
  };
}

function getTooltipStyle(rect) {
  const width = Math.min(360, window.innerWidth - 32);
  const gap = 14;
  const minHeight = 190;

  if (!rect) {
    return {
      width,
      left: Math.max(16, (window.innerWidth - width) / 2),
      top: Math.max(24, window.innerHeight / 2 - 120),
    };
  }

  const spaceBelow = window.innerHeight - (rect.top + rect.height);
  const spaceAbove = rect.top;
  const spaceRight = window.innerWidth - (rect.left + rect.width);
  const spaceLeft = rect.left;
  let top = rect.top + rect.height + gap;
  let left = rect.left + rect.width / 2 - width / 2;

  if (spaceRight >= width + gap && rect.height >= 120) {
    top = rect.top + rect.height / 2;
    left = rect.left + rect.width + gap;
    return {
      width,
      left: Math.min(left, window.innerWidth - width - 16),
      top: Math.min(Math.max(16, top), window.innerHeight - 180),
      transform: 'translateY(-50%)',
    };
  }

  if (spaceLeft >= width + gap && rect.height >= 120) {
    top = rect.top + rect.height / 2;
    left = rect.left - width - gap;
    return {
      width,
      left: Math.max(16, left),
      top: Math.min(Math.max(16, top), window.innerHeight - 180),
      transform: 'translateY(-50%)',
    };
  }

  if (spaceBelow < minHeight && spaceAbove > spaceBelow) {
    top = rect.top - gap;
    left = rect.left + rect.width / 2 - width / 2;
    return {
      width,
      left: Math.min(Math.max(16, left), window.innerWidth - width - 16),
      top: Math.max(16, top),
      transform: 'translateY(-100%)',
    };
  }

  return {
    width,
    left: Math.min(Math.max(16, left), window.innerWidth - width - 16),
    top: Math.min(Math.max(16, top), window.innerHeight - minHeight),
  };
}

export default function OnboardingTour({ onComplete }) {
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [spotlight, setSpotlight] = useState(null);
  const currentStep = steps[stepIndex];

  const updateSpotlight = useCallback(() => {
    setSpotlight(getRect(currentStep?.target));
  }, [currentStep]);

  const completeTour = useCallback(() => {
    writeCompleteFlag();
    setOpen(false);
    setStepIndex(0);
    onComplete?.();
  }, [onComplete]);

  const startTour = useCallback(() => {
    setStepIndex(0);
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!readCompleteFlag()) {
      const timer = window.setTimeout(startTour, 500);
      return () => window.clearTimeout(timer);
    }

    return undefined;
  }, [startTour]);

  useEffect(() => {
    window.addEventListener(ONBOARDING_START_EVENT, startTour);
    return () => window.removeEventListener(ONBOARDING_START_EVENT, startTour);
  }, [startTour]);

  useEffect(() => {
    if (!open) return undefined;

    updateSpotlight();
    const handleUpdate = () => updateSpotlight();
    window.addEventListener('resize', handleUpdate);
    window.addEventListener('scroll', handleUpdate, true);
    const timer = window.setInterval(handleUpdate, 300);

    return () => {
      window.removeEventListener('resize', handleUpdate);
      window.removeEventListener('scroll', handleUpdate, true);
      window.clearInterval(timer);
    };
  }, [open, stepIndex, updateSpotlight]);

  const tooltipStyle = useMemo(() => getTooltipStyle(spotlight), [spotlight]);

  if (!open || !currentStep) return <style>{globalCss}</style>;

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  return (
    <div style={styles.root} role="dialog" aria-modal="true" aria-label="Josh IDE onboarding">
      <style>{globalCss}</style>
      <svg style={styles.overlay} width="100%" height="100%" aria-hidden="true">
        <defs>
          <mask id="onboarding-spotlight-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {spotlight && (
              <rect
                x={spotlight.left}
                y={spotlight.top}
                width={spotlight.width}
                height={spotlight.height}
                rx="8"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(0, 0, 0, 0.72)" mask="url(#onboarding-spotlight-mask)" />
        {spotlight && (
          <rect
            x={spotlight.left}
            y={spotlight.top}
            width={spotlight.width}
            height={spotlight.height}
            rx="8"
            fill="transparent"
            stroke="#f0f0f0"
            strokeWidth="2"
          />
        )}
      </svg>

      <div style={{ ...styles.tooltip, ...tooltipStyle }}>
        <div style={styles.counter}>{stepIndex + 1} of {steps.length}</div>
        <h2 style={styles.title}>{currentStep.title}</h2>
        <p style={styles.body}>{currentStep.body}</p>

        <div style={styles.actions}>
          <button type="button" style={styles.secondaryButton} onClick={completeTour}>
            Skip
          </button>
          <div style={styles.navActions}>
            <button
              type="button"
              style={{ ...styles.secondaryButton, opacity: isFirst ? 0.45 : 1 }}
              onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
              disabled={isFirst}
            >
              Back
            </button>
            <button
              type="button"
              style={styles.primaryButton}
              onClick={() => {
                if (isLast) {
                  completeTour();
                  return;
                }
                setStepIndex((index) => Math.min(steps.length - 1, index + 1));
              }}
            >
              {isLast ? currentStep.cta : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  root: {
    position: 'fixed',
    inset: 0,
    zIndex: 10000,
    color: '#f0f0f0',
    fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  },
  tooltip: {
    position: 'fixed',
    background: '#1e1e1e',
    color: '#f0f0f0',
    border: '1px solid #333',
    borderRadius: 8,
    padding: 18,
    boxShadow: '0 18px 48px rgba(0, 0, 0, 0.45)',
    boxSizing: 'border-box',
  },
  counter: {
    color: '#b8b8b8',
    fontSize: 12,
    marginBottom: 10,
  },
  title: {
    margin: '0 0 8px',
    fontSize: 20,
    lineHeight: 1.25,
    color: '#f0f0f0',
  },
  body: {
    margin: '0 0 18px',
    color: '#d0d0d0',
    fontSize: 14,
    lineHeight: 1.5,
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  navActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  primaryButton: {
    minHeight: 44,
    border: '1px solid #f0f0f0',
    borderRadius: 6,
    background: '#f0f0f0',
    color: '#1e1e1e',
    padding: '0 14px',
    cursor: 'pointer',
    fontWeight: 700,
    maxWidth: '100%',
  },
  secondaryButton: {
    minHeight: 44,
    border: '1px solid #333',
    borderRadius: 6,
    background: '#252525',
    color: '#f0f0f0',
    padding: '0 12px',
    cursor: 'pointer',
    maxWidth: '100%',
  },
};

const globalCss = `
  .ai-chat-container,
  .ai-chat-input-row,
  .ai-chat-input {
    box-sizing: border-box;
    max-width: 100%;
  }

  .ai-chat-input-row {
    width: 100%;
  }

  .ai-chat-input {
    flex: 1 1 auto;
    min-width: 0;
  }

  .sidebar,
  .file-explorer,
  .editor-area,
  .terminal-area,
  .bottom-panel-content,
  .preview-sidebar,
  .ai-sidebar,
  .mobile-files-body,
  .mobile-panel-stage,
  .settings-panel-body {
    overflow-y: auto;
  }

  .context-menu-item,
  .toolbar-mobile-menu-btn,
  .mobile-nav-tab,
  .icon-btn,
  .ai-chat-send-btn {
    min-height: 44px;
    min-width: 44px;
  }

  @media (max-width: 767px) {
    .ai-chat-input-row {
      width: 100%;
      min-width: 0;
    }

    .ai-chat-send-btn {
      flex: 0 0 auto;
    }
  }
`;
