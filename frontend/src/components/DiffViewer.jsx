import React, { useCallback, useMemo, useState } from 'react';
import './DiffViewer.css';

function splitLines(text) {
  if (!text) return [];
  return text.split('\n');
}

function computeLineDiffs(beforeText, afterText) {
  const beforeLines = splitLines(beforeText);
  const afterLines = splitLines(afterText);
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);

  const before = beforeLines.map((line, i) => ({
    num: i + 1,
    text: line,
    type: afterSet.has(line) ? 'context' : 'removed',
  }));

  const after = afterLines.map((line, i) => ({
    num: i + 1,
    text: line,
    type: beforeSet.has(line) ? 'context' : 'added',
  }));

  return { before, after };
}

function DiffColumn({ header, headerClass, lines, placeholder }) {
  if (placeholder) {
    return (
      <div className="diff-column">
        <div className={`diff-column-header ${headerClass}`}>{header}</div>
        <div className="diff-new-file-placeholder">{placeholder}</div>
      </div>
    );
  }

  return (
    <div className="diff-column">
      <div className={`diff-column-header ${headerClass}`}>{header}</div>
      <div className="diff-content">
        {lines.map((line, i) => (
          <div key={i} className={`diff-line ${line.type}`}>
            <span className="diff-line-num">{line.num}</span>
            <span className="diff-line-text">
              {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
              {line.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DiffViewer({ diffs, onApply, onClose }) {
  const [accepted, setAccepted] = useState(() => new Set());
  const [skipped, setSkipped] = useState(() => new Set());
  const [currentIdx, setCurrentIdx] = useState(0);

  if (!diffs || diffs.length === 0) return null;

  const current = diffs[currentIdx] || diffs[0];
  const lineDiffs = useMemo(
    () => computeLineDiffs(current.before, current.after),
    [current.before, current.after]
  );

  const acceptFile = useCallback((file) => {
    setAccepted((prev) => {
      const next = new Set(prev);
      next.add(file);
      return next;
    });
    setSkipped((prev) => {
      const next = new Set(prev);
      next.delete(file);
      return next;
    });
  }, []);

  const skipFile = useCallback((file) => {
    setSkipped((prev) => {
      const next = new Set(prev);
      next.add(file);
      return next;
    });
    setAccepted((prev) => {
      const next = new Set(prev);
      next.delete(file);
      return next;
    });
  }, []);

  const acceptAll = useCallback(() => {
    setAccepted(new Set(diffs.map((d) => d.file)));
    setSkipped(new Set());
  }, [diffs]);

  const rejectAll = useCallback(() => {
    setSkipped(new Set(diffs.map((d) => d.file)));
    setAccepted(new Set());
  }, [diffs]);

  const handleApply = useCallback(() => {
    const acceptedIndices = diffs
      .filter((d) => accepted.has(d.file))
      .map((d) => d.stepIndex);
    onApply(acceptedIndices);
  }, [diffs, accepted, onApply]);

  const isAccepted = accepted.has(current.file);
  const isSkipped = skipped.has(current.file);

  return (
    <div className="diff-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="diff-modal">
        {/* Header */}
        <div className="diff-header">
          <div className="diff-header-left">
            <span className="diff-header-title">Review Changes</span>
            <span className="diff-file-badge">{diffs.length} file{diffs.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="diff-header-actions">
            <button className="diff-btn diff-btn-accept-all" onClick={acceptAll} type="button">Accept All</button>
            <button className="diff-btn diff-btn-reject-all" onClick={rejectAll} type="button">Reject All</button>
            <button className="diff-btn-close" onClick={onClose} type="button">&times;</button>
          </div>
        </div>

        {/* File tabs */}
        <div className="diff-tabs">
          {diffs.map((d, i) => (
            <button
              key={d.file}
              className={`diff-tab ${i === currentIdx ? 'active' : ''}`}
              onClick={() => setCurrentIdx(i)}
              type="button"
            >
              <span className={`diff-tab-type ${d.type}`}>{d.type}</span>
              <span>{d.file}</span>
              {accepted.has(d.file) && <span className="diff-tab-accepted">&#10003;</span>}
              {skipped.has(d.file) && <span className="diff-tab-skipped">&#8212;</span>}
            </button>
          ))}
        </div>

        {/* Diff pane */}
        <div className="diff-pane">
          {current.type === 'create' ? (
            <>
              <DiffColumn header="Before" headerClass="before" placeholder="New file" />
              <DiffColumn header="After" headerClass="after" lines={lineDiffs.after} />
            </>
          ) : current.type === 'delete' ? (
            <>
              <DiffColumn header="Before" headerClass="before" lines={lineDiffs.before} />
              <DiffColumn header="After" headerClass="after" placeholder="File deleted" />
            </>
          ) : (
            <>
              <DiffColumn header="Before" headerClass="before" lines={lineDiffs.before} />
              <DiffColumn header="After" headerClass="after" lines={lineDiffs.after} />
            </>
          )}
        </div>

        {/* Per-file footer */}
        <div className="diff-file-footer">
          <div className="diff-file-stats">
            <span className="diff-stat-added">+{current.addedLines} added</span>
            <span className="diff-stat-removed">-{current.removedLines} removed</span>
          </div>
          <div className="diff-file-actions">
            <button
              className={`diff-btn diff-btn-accept ${isAccepted ? 'accepted' : ''}`}
              onClick={() => acceptFile(current.file)}
              type="button"
            >
              {isAccepted ? '&#10003; Accepted' : 'Accept this file'}
            </button>
            <button
              className={`diff-btn diff-btn-skip ${isSkipped ? 'skipped' : ''}`}
              onClick={() => skipFile(current.file)}
              type="button"
            >
              {isSkipped ? 'Skipped' : 'Skip this file'}
            </button>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="diff-bottom-bar">
          <div className="diff-summary">
            <span className="diff-summary-count">{accepted.size}</span> file{accepted.size !== 1 ? 's' : ''} accepted,{' '}
            <span className="diff-summary-count">{skipped.size}</span> skipped
          </div>
          <button
            className="diff-btn diff-btn-apply"
            onClick={handleApply}
            disabled={accepted.size === 0}
            type="button"
          >
            Apply Changes
          </button>
        </div>
      </div>
    </div>
  );
}
