const COLLABORATOR_COLORS = [
  '#ff8f70',
  '#61dafb',
  '#ffd166',
  '#95e06c',
  '#f78fb3',
  '#c7a6ff',
  '#4dd4ac',
  '#ffb86c',
];

export function getCollaboratorName(user) {
  return user?.username || 'IDE';
}

export function getCollaboratorColor(seedValue) {
  const seed = String(seedValue || 'IDE');
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  return COLLABORATOR_COLORS[hash % COLLABORATOR_COLORS.length];
}

export function getCollaboratorInitials(user) {
  const parts = getCollaboratorName(user).split(/\s+/).filter(Boolean);
  if (!parts.length) return 'I';
  return parts.slice(0, 2).map((part) => part[0].toUpperCase()).join('');
}

export function getStoredCollaborationUsername() {
  if (window.IDE_KEY) {
    return 'IDE';
  }

  const token = localStorage.getItem('auth-token') || '';
  const payload = token.split('.')[1];
  if (!payload) return 'IDE';

  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(window.atob(normalized));
    return typeof decoded?.username === 'string' && decoded.username.trim()
      ? decoded.username.trim()
      : 'IDE';
  } catch {
    return 'IDE';
  }
}
