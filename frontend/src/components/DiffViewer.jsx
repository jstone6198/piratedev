import React, { useCallback, useMemo, useState } from 'react';
import './DiffViewer.css';

function DiffLine({ line }) {
  const oldNum = line.oldLineNum ?? '';
  const newNum = line.newLineNum ?? '';
  const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';

  return (
    <div className={`diff-line ${line.type}`}>
      <span className="diff-line-num">{oldNum}</span>
      <span className="diff-line-num">{newNum}</span>
      <span className="diff-line-content">{prefix}{line.content}</span>
    </div>
  );
}

function HunkSection({ hunk, hunkState, onAccept, onReject }) {
  const isAccepted = hunkState === 'accepted';
  const isRejected = hunkState === 'rejected';
  const stateClass = isAccepted ? 'diff-accepted' : isRejected ? 'diff-rejected' : '';

  return (
    <div className={`diff-hunk ${stateClass}`}>
      <div className="diff-hunk-header">
        <span className="diff-hunk-info">
          @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
          <span className="diff-hunk-stats">
            {hunk.removed.length > 0 && <span className="diff-stat-removed"> -{hunk.removed.length}</span>}
            {hunk.added.length > 0 && <span className="diff-stat-added"> +{hunk.added.length}</span>}
          </span>
        </span>
        <div className="diff-hunk-actions">
          <button
            className={`btn-accept ${isAccepted ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); onAccept(); }}
            type="button"
          >
            {isAccepted ? '\u2713 Accepted' : 'Accept'}
          </button>
          <button
            className={`btn-reject ${isRejected ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); onReject(); }}
            type="button"
          >
            {isRejected ? 'Rejected' : 'Reject'}
          </button>
        </div>
      </div>
      <div className="diff-hunk-body">
        {hunk.lines.map((line, i) => (
          <DiffLine key={i} line={line} />
        ))}
      </div>
    </div>
  );
}

function NewFilePlaceholder({ lines, label }) {
  return (
    <div className="diff-hunk">
      <div className="diff-hunk-header">
        <span className="diff-hunk-info">{label}</span>
      </div>
      <div className="diff-hunk-body">
        {lines.map((line, i) => (
          <div key={i} className={`diff-line ${label === 'New file' ? 'added' : 'removed'}`}>
            <span className="diff-line-num">{i + 1}</span>
            <span className="diff-line-num"></span>
            <span className="diff-line-content">{label === 'New file' ? '+' : '-'}{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DiffViewer({ diffs, onApply, onClose }) {
  const [currentIdx, setCurrentIdx] = useState(0);
  // hunkStates: Map<fileKey, Map<hunkIndex, 'accepted'|'rejected'>>
  const [hunkStates, setHunkStates] = useState(() => new Map());
  // fileStates: Map<fileKey, 'accepted'|'rejected'>  (for create/delete files with no hunks)
  const [fileStates, setFileStates] = useState(() => new Map());

  if (!diffs || diffs.length === 0) return null;

  const current = diffs[currentIdx] || diffs[0];

  const getFileKey = (d) => `${d.stepIndex}:${d.file}`;

  const setHunkState = useCallback((fileKey, hunkIdx, state) => {
    setHunkStates((prev) => {
      const next = new Map(prev);
      const fileMap = new Map(next.get(fileKey) || []);
      fileMap.set(hunkIdx, state);
      next.set(fileKey, fileMap);
      return next;
    });
  }, []);

  const acceptAllHunksForFile = useCallback((fileKey, hunkCount) => {
    setHunkStates((prev) => {
      const next = new Map(prev);
      const fileMap = new Map();
      for (let i = 0; i < hunkCount; i++) fileMap.set(i, 'accepted');
      next.set(fileKey, fileMap);
      return next;
    });
    setFileStates((prev) => {
      const next = new Map(prev);
      next.set(fileKey, 'accepted');
      return next;
    });
  }, []);

  const rejectAllHunksForFile = useCallback((fileKey, hunkCount) => {
    setHunkStates((prev) => {
      const next = new Map(prev);
      const fileMap = new Map();
      for (let i = 0; i < hunkCount; i++) fileMap.set(i, 'rejected');
      next.set(fileKey, fileMap);
      return next;
    });
    setFileStates((prev) => {
      const next = new Map(prev);
      next.set(fileKey, 'rejected');
      return next;
    });
  }, []);

  const acceptAll = useCallback(() => {
    const nextHunks = new Map();
    const nextFiles = new Map();
    for (const d of diffs) {
      const key = getFileKey(d);
      nextFiles.set(key, 'accepted');
      if (d.hunks && d.hunks.length > 0) {
        const fm = new Map();
        for (let i = 0; i < d.hunks.length; i++) fm.set(i, 'accepted');
        nextHunks.set(key, fm);
      }
    }
    setHunkStates(nextHunks);
    setFileStates(nextFiles);
  }, [diffs]);

  const rejectAll = useCallback(() => {
    const nextHunks = new Map();
    const nextFiles = new Map();
    for (const d of diffs) {
      const key = getFileKey(d);
      nextFiles.set(key, 'rejected');
      if (d.hunks && d.hunks.length > 0) {
        const fm = new Map();
        for (let i = 0; i < d.hunks.length; i++) fm.set(i, 'rejected');
        nextHunks.set(key, fm);
      }
    }
    setHunkStates(nextHunks);
    setFileStates(nextFiles);
  }, [diffs]);

  // Compute summary stats
  const summary = useMemo(() => {
    let filesAccepted = 0;
    let filesRejected = 0;
    let totalAdded = 0;
    let totalRemoved = 0;
    let hunksAccepted = 0;
    let hunksRejected = 0;

    for (const d of diffs) {
      const key = getFileKey(d);
      const fileHunks = hunkStates.get(key);
      const fState = fileStates.get(key);

      if (d.hunks && d.hunks.length > 0) {
        let allAccepted = true;
        let allRejected = true;
        for (let i = 0; i < d.hunks.length; i++) {
          const s = fileHunks?.get(i);
          if (s === 'accepted') hunksAccepted++;
          else if (s === 'rejected') hunksRejected++;
          if (s !== 'accepted') allAccepted = false;
          if (s !== 'rejected') allRejected = false;
        }
        if (allAccepted) filesAccepted++;
        else if (allRejected) filesRejected++;
      } else {
        if (fState === 'accepted') filesAccepted++;
        else if (fState === 'rejected') filesRejected++;
      }

      totalAdded += d.addedLines || 0;
      totalRemoved += d.removedLines || 0;
    }

    return { filesAccepted, filesRejected, totalAdded, totalRemoved, hunksAccepted, hunksRejected };
  }, [diffs, hunkStates, fileStates]);

  // Build accepted indices for onApply
  const handleApply = useCallback(() => {
    const result = [];
    for (const d of diffs) {
      const key = getFileKey(d);
      const fileHunks = hunkStates.get(key);
      const fState = fileStates.get(key);

      if (d.hunks && d.hunks.length > 0) {
        const acceptedHunkIndices = [];
        for (let i = 0; i < d.hunks.length; i++) {
          if (fileHunks?.get(i) === 'accepted') {
            acceptedHunkIndices.push(i);
          }
        }
        if (acceptedHunkIndices.length > 0) {
          const allAccepted = acceptedHunkIndices.length === d.hunks.length;
          result.push({
            stepIndex: d.stepIndex,
            hunks: allAccepted ? 'all' : acceptedHunkIndices,
          });
        }
      } else if (fState === 'accepted') {
        result.push({ stepIndex: d.stepIndex, hunks: 'all' });
      }
    }
    onApply(result);
  }, [diffs, hunkStates, fileStates, onApply]);

  const hasAnyAccepted = summary.filesAccepted > 0 || summary.hunksAccepted > 0;

  const currentKey = getFileKey(current);
  const currentFileHunks = hunkStates.get(currentKey);
  const currentFileState = fileStates.get(currentKey);

  // Determine per-file tab status
  const getFileTabStatus = (d) => {
    const key = getFileKey(d);
    const fh = hunkStates.get(key);
    const fs2 = fileStates.get(key);
    if (d.hunks && d.hunks.length > 0 && fh) {
      let acc = 0; let rej = 0;
      for (let i = 0; i < d.hunks.length; i++) {
        const s = fh.get(i);
        if (s === 'accepted') acc++;
        if (s === 'rejected') rej++;
      }
      if (acc === d.hunks.length) return 'accepted';
      if (rej === d.hunks.length) return 'rejected';
      if (acc > 0) return 'partial';
    }
    return fs2 || null;
  };

  return (
    <div className="diff-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="diff-modal">
        {/* Header */}
        <div className="diff-header">
          <div className="diff-header-left">
            <span className="diff-header-title">Review Changes</span>
            <span className="diff-file-badge">
              {diffs.length} file{diffs.length !== 1 ? 's' : ''}
            </span>
            <span className="diff-summary-line">
              +{summary.totalAdded} -{summary.totalRemoved} lines
            </span>
          </div>
          <div className="diff-header-actions">
            <button className="diff-btn diff-btn-accept-all" onClick={acceptAll} type="button">Accept All</button>
            <button className="diff-btn diff-btn-reject-all" onClick={rejectAll} type="button">Reject All</button>
            <button className="diff-btn-close" onClick={onClose} type="button">&times;</button>
          </div>
        </div>

        {/* File tabs */}
        <div className="diff-tabs">
          {diffs.map((d, i) => {
            const tabStatus = getFileTabStatus(d);
            return (
              <button
                key={getFileKey(d)}
                className={`diff-tab ${i === currentIdx ? 'active' : ''}`}
                onClick={() => setCurrentIdx(i)}
                type="button"
              >
                <span className={`diff-tab-type ${d.type}`}>{d.type}</span>
                <span>{d.file}</span>
                {d.hunks && <span className="diff-tab-hunk-count">{d.hunks.length}h</span>}
                {tabStatus === 'accepted' && <span className="diff-tab-accepted">&#10003;</span>}
                {tabStatus === 'rejected' && <span className="diff-tab-skipped">&#10007;</span>}
                {tabStatus === 'partial' && <span className="diff-tab-partial">&#9679;</span>}
              </button>
            );
          })}
        </div>

        {/* Per-file accept/reject bar */}
        <div className="diff-file-bar">
          <div className="diff-file-bar-info">
            <span className="diff-filename">{current.file}</span>
            <span className="diff-file-stats-inline">
              <span className="diff-stat-added">+{current.addedLines}</span>
              <span className="diff-stat-removed">-{current.removedLines}</span>
              {current.hunks && <span className="diff-hunk-count-label">{current.hunks.length} hunk{current.hunks.length !== 1 ? 's' : ''}</span>}
            </span>
          </div>
          <div className="diff-file-bar-actions">
            <button
              className="btn-accept"
              onClick={() => acceptAllHunksForFile(currentKey, current.hunks?.length || 0)}
              type="button"
            >
              Accept File
            </button>
            <button
              className="btn-reject"
              onClick={() => rejectAllHunksForFile(currentKey, current.hunks?.length || 0)}
              type="button"
            >
              Reject File
            </button>
          </div>
        </div>

        {/* Diff content with hunks */}
        <div className="diff-pane-unified">
          {current.type === 'create' && (!current.hunks || current.hunks.length === 0) ? (
            <NewFilePlaceholder lines={(current.after || '').split('\n')} label="New file" />
          ) : current.type === 'delete' && (!current.hunks || current.hunks.length === 0) ? (
            <NewFilePlaceholder lines={(current.before || '').split('\n')} label="Deleted file" />
          ) : current.hunks && current.hunks.length > 0 ? (
            current.hunks.map((hunk) => (
              <HunkSection
                key={hunk.index}
                hunk={hunk}
                hunkState={currentFileHunks?.get(hunk.index) || null}
                onAccept={() => setHunkState(currentKey, hunk.index, 'accepted')}
                onReject={() => setHunkState(currentKey, hunk.index, 'rejected')}
              />
            ))
          ) : (
            <div className="diff-no-changes">No changes detected</div>
          )}
        </div>

        {/* Bottom bar */}
        <div className="diff-bottom-bar">
          <div className="diff-summary">
            <span className="diff-summary-count">{summary.filesAccepted}</span> file{summary.filesAccepted !== 1 ? 's' : ''} accepted,{' '}
            <span className="diff-summary-count">{summary.hunksAccepted}</span> hunk{summary.hunksAccepted !== 1 ? 's' : ''} accepted,{' '}
            <span className="diff-summary-count">{summary.hunksRejected}</span> rejected
          </div>
          <button
            className="diff-btn diff-btn-apply"
            onClick={handleApply}
            disabled={!hasAnyAccepted}
            type="button"
          >
            Apply Changes
          </button>
        </div>
      </div>
    </div>
  );
}
