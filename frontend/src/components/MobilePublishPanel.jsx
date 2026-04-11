import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FaAndroid, FaApple, FaCheckCircle, FaChevronDown, FaChevronRight, FaDownload, FaMobileAlt, FaQrcode, FaSyncAlt } from 'react-icons/fa';
import api from '../api';

const PLATFORM_OPTIONS = [
  { value: 'ios', label: 'iOS' },
  { value: 'android', label: 'Android' },
  { value: 'all', label: 'Both' },
];

const APP_STORE_ITEMS = [
  'Apple Developer account is active',
  'Bundle identifier is configured',
  'Screenshots are ready',
  'Description and keywords are written',
  'Privacy policy URL is live',
  'Review notes and test credentials are ready',
];

const PLAY_STORE_ITEMS = [
  'Google Play Developer account is active',
  'Package name is configured',
  'Screenshots and feature graphic are ready',
  'Store listing copy is written',
  'Data Safety form is complete',
  'Internal test build has passed review',
];

function authHeaders() {
  const headers = {};
  const ideKey = window.IDE_KEY || '';
  const authToken = localStorage.getItem('auth-token') || '';
  if (ideKey) headers['x-ide-key'] = ideKey;
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  return headers;
}

async function toObjectUrl(url) {
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) throw new Error(`Asset preview failed with status ${response.status}`);
  return URL.createObjectURL(await response.blob());
}

function statusTone(status) {
  const normalized = String(status || '').toLowerCase();
  if (['complete', 'finished', 'success'].includes(normalized)) return styles.badgeOk;
  if (['failed', 'errored', 'canceled'].includes(normalized)) return styles.badgeBad;
  if (['building', 'in_queue', 'pending', 'in-progress'].includes(normalized)) return styles.badgeWarn;
  return styles.badgeMuted;
}

function Checklist({ title, storageKey, items }) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState({});

  useEffect(() => {
    try {
      setChecked(JSON.parse(localStorage.getItem(storageKey) || '{}'));
    } catch {
      setChecked({});
    }
  }, [storageKey]);

  const toggleItem = (item) => {
    setChecked((current) => {
      const next = { ...current, [item]: !current[item] };
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  };

  const doneCount = items.filter((item) => checked[item]).length;

  return (
    <div style={styles.guideBlock}>
      <button type="button" style={styles.guideHeader} onClick={() => setOpen((value) => !value)}>
        <span style={styles.rowCenter}>
          {open ? <FaChevronDown size={12} /> : <FaChevronRight size={12} />}
          <span>{title}</span>
        </span>
        <span style={styles.guideCount}>{doneCount}/{items.length}</span>
      </button>
      {open && (
        <div style={styles.checklist}>
          {items.map((item) => (
            <label key={item} style={styles.checkRow}>
              <input
                type="checkbox"
                checked={Boolean(checked[item])}
                onChange={() => toggleItem(item)}
              />
              <span>{item}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MobilePublishPanel({ project }) {
  const [configured, setConfigured] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [qrCode, setQrCode] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const [device, setDevice] = useState('iphone');
  const [platform, setPlatform] = useState('ios');
  const [buildStatus, setBuildStatus] = useState(null);
  const [buildLog, setBuildLog] = useState('');
  const [building, setBuilding] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [assetPrompt, setAssetPrompt] = useState('');
  const [assetLoading, setAssetLoading] = useState(false);
  const [iconPreview, setIconPreview] = useState('');
  const [splashPreview, setSplashPreview] = useState('');
  const [guide, setGuide] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const [message, setMessage] = useState('');

  const encodedProject = useMemo(() => encodeURIComponent(project || ''), [project]);

  const refreshQr = useCallback(async () => {
    if (!project) return;
    setConfigLoading(true);
    setMessage('');
    try {
      const response = await api.get(`/mobile/${encodedProject}/qr`);
      setConfigured(Boolean(response.data.configured ?? true));
      setQrCode(response.data.qrCode || '');
      setQrUrl(response.data.url || '');
    } catch (error) {
      if (error.response?.status === 404) {
        setConfigured(false);
        setQrCode('');
        setQrUrl('');
      } else {
        setMessage(error.response?.data?.message || error.response?.data?.error || error.message);
      }
    } finally {
      setConfigLoading(false);
    }
  }, [encodedProject, project]);

  const loadBuildStatus = useCallback(async () => {
    if (!project || !configured) return;
    try {
      const response = await api.get(`/mobile/${encodedProject}/build-status`);
      setBuildStatus(response.data);
      setBuildLog(response.data.log || '');
      setBuilding(['building', 'pending', 'in_queue'].includes(String(response.data.status || '').toLowerCase()));
    } catch (error) {
      if (error.response?.status !== 404) {
        setMessage(error.response?.data?.message || error.response?.data?.error || error.message);
      }
    }
  }, [configured, encodedProject, project]);

  const loadGuide = useCallback(async () => {
    if (!project) return;
    try {
      const response = await api.get(`/mobile/${encodedProject}/store-guide`);
      setGuide(response.data.guide || '');
    } catch {
      setGuide('');
    }
  }, [encodedProject, project]);

  useEffect(() => {
    setConfigured(false);
    setQrCode('');
    setQrUrl('');
    setBuildStatus(null);
    setBuildLog('');
    setIconPreview('');
    setSplashPreview('');
    setGuide('');
    setMessage('');
    refreshQr();
  }, [refreshQr]);

  useEffect(() => {
    loadGuide();
  }, [loadGuide]);

  useEffect(() => {
    if (!building) return undefined;
    const timer = setInterval(loadBuildStatus, 8000);
    return () => clearInterval(timer);
  }, [building, loadBuildStatus]);

  useEffect(() => () => {
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    if (splashPreview) URL.revokeObjectURL(splashPreview);
  }, [iconPreview, splashPreview]);

  const initializeExpo = async () => {
    if (!project) return;
    setConfigLoading(true);
    setMessage('');
    try {
      const response = await api.post(`/mobile/${encodedProject}/init`);
      setMessage(`Initialized Expo: ${response.data.files?.join(', ') || 'no new files'}`);
      await refreshQr();
      await loadGuide();
    } catch (error) {
      setMessage(error.response?.data?.message || error.response?.data?.error || error.message);
    } finally {
      setConfigLoading(false);
    }
  };

  const startBuild = async () => {
    if (!project || !configured) return;
    setBuilding(true);
    setBuildLog('');
    setMessage('');
    try {
      const response = await api.post(`/mobile/${encodedProject}/build`, { platform });
      setBuildStatus(response.data);
      setBuildLog(response.data.log || '');
      setLogOpen(true);
    } catch (error) {
      setBuilding(false);
      setMessage(error.response?.data?.message || error.response?.data?.error || error.message);
    }
  };

  const generateAssets = async () => {
    if (!project || !assetPrompt.trim()) return;
    setAssetLoading(true);
    setMessage('');
    try {
      const response = await api.post(`/mobile/${encodedProject}/generate-assets`, {
        prompt: assetPrompt.trim(),
      });
      const [iconUrl, splashUrl] = await Promise.all([
        toObjectUrl(response.data.iconUrl),
        toObjectUrl(response.data.splashUrl),
      ]);
      if (iconPreview) URL.revokeObjectURL(iconPreview);
      if (splashPreview) URL.revokeObjectURL(splashPreview);
      setIconPreview(iconUrl);
      setSplashPreview(splashUrl);
      setMessage('Generated icon and splash assets');
    } catch (error) {
      setMessage(error.response?.data?.message || error.response?.data?.error || error.message);
    } finally {
      setAssetLoading(false);
    }
  };

  if (!project) {
    return (
      <div style={styles.container}>
        <div style={styles.empty}>Select a project to publish a mobile app.</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.title}>
          <FaMobileAlt />
          <span>Mobile App Publishing</span>
        </div>
        <span style={{ ...styles.badge, ...(configured ? styles.badgeOk : styles.badgeMuted) }}>
          {configLoading ? 'Checking' : configured ? 'Expo ready' : 'No mobile config'}
        </span>
      </div>

      {message && <div style={styles.message}>{message}</div>}

      <section style={styles.section}>
        <div style={styles.sectionTitle}>Initialize</div>
        <div style={styles.sectionText}>Prepare Expo config, package dependencies, and starter mobile files.</div>
        {!configured ? (
          <button type="button" style={styles.primaryButton} onClick={initializeExpo} disabled={configLoading}>
            {configLoading ? 'Initializing...' : 'Initialize Expo'}
          </button>
        ) : (
          <div style={styles.readyLine}>
            <FaCheckCircle />
            <span>Mobile config detected</span>
          </div>
        )}
      </section>

      <section style={styles.section}>
        <div style={styles.sectionTitle}>Preview</div>
        <div style={styles.deviceToggle}>
          <button type="button" style={device === 'iphone' ? styles.toggleActive : styles.toggleButton} onClick={() => setDevice('iphone')}>
            <FaApple /> iPhone
          </button>
          <button type="button" style={device === 'android' ? styles.toggleActive : styles.toggleButton} onClick={() => setDevice('android')}>
            <FaAndroid /> Android
          </button>
        </div>
        <div style={device === 'iphone' ? styles.iphoneFrame : styles.androidFrame}>
          {qrCode ? (
            <>
              <img src={qrCode} alt="Expo Go QR code" style={styles.qrImage} />
              <div style={styles.qrLabel}>Scan with Expo Go</div>
              <div style={styles.qrUrl}>{qrUrl}</div>
            </>
          ) : (
            <div style={styles.emptyQr}>
              <FaQrcode size={42} />
              <span>Initialize Expo to create a preview QR code.</span>
            </div>
          )}
        </div>
        <button type="button" style={styles.secondaryButton} onClick={refreshQr} disabled={configLoading}>
          <FaSyncAlt /> Refresh QR
        </button>
      </section>

      <section style={styles.section}>
        <div style={styles.sectionTitle}>Build</div>
        <div style={styles.platformRow}>
          {PLATFORM_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              style={platform === option.value ? styles.toggleActive : styles.toggleButton}
              onClick={() => setPlatform(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button type="button" style={styles.primaryButton} onClick={startBuild} disabled={!configured || building}>
          {building ? 'Build in progress...' : 'Start Build'}
        </button>
        <button type="button" style={styles.secondaryButton} onClick={loadBuildStatus} disabled={!configured}>
          Check Status
        </button>
        <div style={styles.statusCard}>
          <div style={styles.statusRow}>
            <span>Platform</span>
            <strong>{buildStatus?.platform || platform}</strong>
          </div>
          <div style={styles.statusRow}>
            <span>Status</span>
            <span style={{ ...styles.badge, ...statusTone(buildStatus?.status) }}>
              {buildStatus?.status || 'not started'}
            </span>
          </div>
          <div style={styles.statusRow}>
            <span>Time</span>
            <strong>{buildStatus?.completedAt || buildStatus?.startedAt || 'Waiting'}</strong>
          </div>
          {buildStatus?.artifactUrl && (
            <a href={buildStatus.artifactUrl} style={styles.downloadLink} target="_blank" rel="noreferrer">
              <FaDownload /> Download build artifact
            </a>
          )}
          {buildStatus?.buildUrl && (
            <a href={buildStatus.buildUrl} style={styles.downloadLink} target="_blank" rel="noreferrer">
              Open EAS build
            </a>
          )}
        </div>
        <button type="button" style={styles.logToggle} onClick={() => setLogOpen((value) => !value)}>
          {logOpen ? <FaChevronDown /> : <FaChevronRight />} Build log
        </button>
        {logOpen && <pre style={styles.logBox}>{buildLog || 'Build output will appear after a build starts.'}</pre>}
      </section>

      <section style={styles.section}>
        <div style={styles.sectionTitle}>Assets</div>
        <textarea
          value={assetPrompt}
          onChange={(event) => setAssetPrompt(event.target.value)}
          placeholder="Describe the app icon and splash screen"
          rows={4}
          style={styles.textarea}
        />
        <button type="button" style={styles.primaryButton} onClick={generateAssets} disabled={assetLoading || !assetPrompt.trim()}>
          {assetLoading ? 'Generating...' : 'Generate Icon'}
        </button>
        <div style={styles.assetGrid}>
          <div style={styles.assetPreview}>
            <div style={styles.assetLabel}>Icon</div>
            {iconPreview ? <img src={iconPreview} alt="Generated app icon" style={styles.iconImage} /> : <div style={styles.assetEmpty}>No icon</div>}
          </div>
          <div style={styles.assetPreview}>
            <div style={styles.assetLabel}>Splash</div>
            {splashPreview ? <img src={splashPreview} alt="Generated splash screen" style={styles.splashImage} /> : <div style={styles.assetEmpty}>No splash</div>}
          </div>
        </div>
      </section>

      <section style={styles.section}>
        <button type="button" style={styles.guideHeader} onClick={() => setGuideOpen((value) => !value)}>
          <span style={styles.rowCenter}>
            {guideOpen ? <FaChevronDown size={12} /> : <FaChevronRight size={12} />}
            <span>Store Guide</span>
          </span>
        </button>
        {guideOpen && (
          <>
            <Checklist title="App Store Submission" storageKey={`mobile-guide:${project}:app-store`} items={APP_STORE_ITEMS} />
            <Checklist title="Play Store Submission" storageKey={`mobile-guide:${project}:play-store`} items={PLAY_STORE_ITEMS} />
            <pre style={styles.guideText}>{guide || 'Submission guide is unavailable.'}</pre>
          </>
        )}
      </section>
    </div>
  );
}

const baseButton = {
  border: '1px solid #333',
  borderRadius: 8,
  color: '#f0f0f0',
  cursor: 'pointer',
  fontSize: 13,
  padding: '9px 12px',
};

const styles = {
  container: {
    background: '#1e1e1e',
    color: '#f0f0f0',
    height: '100%',
    overflow: 'auto',
    padding: 16,
    boxSizing: 'border-box',
    borderLeft: '1px solid #333',
  },
  header: {
    alignItems: 'center',
    borderBottom: '1px solid #333',
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 14,
  },
  title: {
    alignItems: 'center',
    display: 'flex',
    gap: 10,
    fontSize: 18,
    fontWeight: 700,
  },
  badge: {
    border: '1px solid #333',
    borderRadius: 8,
    fontSize: 12,
    padding: '4px 8px',
    whiteSpace: 'nowrap',
  },
  badgeOk: {
    background: '#173d25',
    color: '#8ce99a',
  },
  badgeBad: {
    background: '#4a1f1f',
    color: '#ff9b9b',
  },
  badgeWarn: {
    background: '#423917',
    color: '#ffe08a',
  },
  badgeMuted: {
    background: '#252525',
    color: '#c9c9c9',
  },
  message: {
    background: '#252525',
    border: '1px solid #333',
    borderRadius: 8,
    color: '#d7d7d7',
    marginTop: 12,
    padding: 10,
  },
  section: {
    borderBottom: '1px solid #333',
    padding: '16px 0',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 700,
    marginBottom: 8,
  },
  sectionText: {
    color: '#c9c9c9',
    fontSize: 13,
    marginBottom: 12,
  },
  primaryButton: {
    ...baseButton,
    background: '#2f6feb',
    borderColor: '#2f6feb',
    marginRight: 8,
  },
  secondaryButton: {
    ...baseButton,
    alignItems: 'center',
    background: '#252525',
    display: 'inline-flex',
    gap: 8,
    marginTop: 10,
  },
  readyLine: {
    alignItems: 'center',
    color: '#8ce99a',
    display: 'flex',
    gap: 8,
    fontSize: 13,
  },
  deviceToggle: {
    display: 'flex',
    gap: 8,
    marginBottom: 12,
  },
  toggleButton: {
    ...baseButton,
    alignItems: 'center',
    background: '#252525',
    display: 'inline-flex',
    gap: 6,
  },
  toggleActive: {
    ...baseButton,
    alignItems: 'center',
    background: '#38445a',
    borderColor: '#5d6f8f',
    display: 'inline-flex',
    gap: 6,
  },
  iphoneFrame: {
    alignItems: 'center',
    background: '#111',
    border: '10px solid #333',
    borderRadius: 32,
    display: 'flex',
    flexDirection: 'column',
    margin: '0 auto',
    maxWidth: 310,
    minHeight: 440,
    padding: 18,
  },
  androidFrame: {
    alignItems: 'center',
    background: '#111',
    border: '8px solid #333',
    borderRadius: 14,
    display: 'flex',
    flexDirection: 'column',
    margin: '0 auto',
    maxWidth: 310,
    minHeight: 440,
    padding: 18,
  },
  qrImage: {
    background: '#f0f0f0',
    borderRadius: 8,
    height: 260,
    marginTop: 32,
    width: 260,
  },
  qrLabel: {
    fontSize: 16,
    fontWeight: 700,
    marginTop: 18,
  },
  qrUrl: {
    color: '#b8b8b8',
    fontSize: 11,
    marginTop: 8,
    overflowWrap: 'anywhere',
    textAlign: 'center',
  },
  emptyQr: {
    alignItems: 'center',
    color: '#b8b8b8',
    display: 'flex',
    flex: 1,
    flexDirection: 'column',
    gap: 16,
    justifyContent: 'center',
    textAlign: 'center',
  },
  platformRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  statusCard: {
    background: '#252525',
    border: '1px solid #333',
    borderRadius: 8,
    marginTop: 12,
    padding: 12,
  },
  statusRow: {
    alignItems: 'center',
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  downloadLink: {
    alignItems: 'center',
    color: '#58a6ff',
    display: 'inline-flex',
    gap: 8,
    marginRight: 12,
    marginTop: 8,
    textDecoration: 'none',
  },
  logToggle: {
    ...baseButton,
    alignItems: 'center',
    background: 'transparent',
    display: 'inline-flex',
    gap: 8,
    marginTop: 12,
  },
  logBox: {
    background: '#111',
    border: '1px solid #333',
    borderRadius: 8,
    color: '#dcdcdc',
    fontSize: 12,
    maxHeight: 260,
    overflow: 'auto',
    padding: 12,
    whiteSpace: 'pre-wrap',
  },
  textarea: {
    background: '#252525',
    border: '1px solid #333',
    borderRadius: 8,
    boxSizing: 'border-box',
    color: '#f0f0f0',
    fontFamily: 'inherit',
    marginBottom: 10,
    padding: 10,
    resize: 'vertical',
    width: '100%',
  },
  assetGrid: {
    display: 'grid',
    gap: 12,
    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
    marginTop: 12,
  },
  assetPreview: {
    background: '#252525',
    border: '1px solid #333',
    borderRadius: 8,
    padding: 10,
  },
  assetLabel: {
    color: '#c9c9c9',
    fontSize: 12,
    marginBottom: 8,
  },
  iconImage: {
    aspectRatio: '1 / 1',
    borderRadius: 8,
    objectFit: 'cover',
    width: '100%',
  },
  splashImage: {
    aspectRatio: '1 / 1',
    borderRadius: 8,
    objectFit: 'cover',
    width: '100%',
  },
  assetEmpty: {
    alignItems: 'center',
    aspectRatio: '1 / 1',
    border: '1px dashed #444',
    borderRadius: 8,
    color: '#999',
    display: 'flex',
    justifyContent: 'center',
  },
  guideBlock: {
    background: '#252525',
    border: '1px solid #333',
    borderRadius: 8,
    marginTop: 10,
  },
  guideHeader: {
    ...baseButton,
    alignItems: 'center',
    background: '#252525',
    display: 'flex',
    justifyContent: 'space-between',
    width: '100%',
  },
  rowCenter: {
    alignItems: 'center',
    display: 'inline-flex',
    gap: 8,
  },
  guideCount: {
    color: '#b8b8b8',
    fontSize: 12,
  },
  checklist: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 12,
  },
  checkRow: {
    alignItems: 'center',
    color: '#d7d7d7',
    display: 'flex',
    gap: 8,
    fontSize: 13,
  },
  guideText: {
    background: '#111',
    border: '1px solid #333',
    borderRadius: 8,
    color: '#dcdcdc',
    fontSize: 12,
    maxHeight: 320,
    overflow: 'auto',
    padding: 12,
    whiteSpace: 'pre-wrap',
  },
  empty: {
    color: '#b8b8b8',
    padding: 16,
  },
};
