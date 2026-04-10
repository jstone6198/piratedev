const DEFAULT_PROJECT_KEY = '__workspace__';
const ROOM_PREFIX = 'collab:project:';

const activeUsersByProject = new Map();

function getProjectKey(project) {
  return typeof project === 'string' && project.trim() ? project.trim() : DEFAULT_PROJECT_KEY;
}

function getRoomName(project) {
  return `${ROOM_PREFIX}${getProjectKey(project)}`;
}

function getProjectUsers(project) {
  const projectKey = getProjectKey(project);
  if (!activeUsersByProject.has(projectKey)) {
    activeUsersByProject.set(projectKey, new Set());
  }
  return activeUsersByProject.get(projectKey);
}

function findUserEntry(project, socketId) {
  const users = activeUsersByProject.get(getProjectKey(project));
  if (!users) return null;

  for (const entry of users) {
    if (entry.socketId === socketId) return entry;
  }

  return null;
}

function removeUserEntry(project, socketId) {
  const projectKey = getProjectKey(project);
  const users = activeUsersByProject.get(projectKey);
  if (!users) return false;

  for (const entry of users) {
    if (entry.socketId === socketId) {
      users.delete(entry);
      if (users.size === 0) {
        activeUsersByProject.delete(projectKey);
      }
      return true;
    }
  }

  return false;
}

function upsertUserEntry(project, payload) {
  const users = getProjectUsers(project);
  const existing = findUserEntry(project, payload.socketId);

  if (existing) {
    existing.username = payload.username;
    existing.activeFile = payload.activeFile ?? existing.activeFile ?? null;
    existing.cursor = payload.cursor ?? existing.cursor ?? null;
    return existing;
  }

  const nextEntry = {
    socketId: payload.socketId,
    username: payload.username,
    activeFile: payload.activeFile ?? null,
    cursor: payload.cursor ?? null,
  };
  users.add(nextEntry);
  return nextEntry;
}

function serializeUsers(project) {
  const users = activeUsersByProject.get(getProjectKey(project));
  if (!users) return [];

  return [...users]
    .map((entry) => ({
      socketId: entry.socketId,
      username: entry.username,
      activeFile: entry.activeFile ?? null,
      cursor: entry.cursor ?? null,
    }))
    .sort((a, b) => a.username.localeCompare(b.username) || a.socketId.localeCompare(b.socketId));
}

function emitPresence(io, project) {
  io.to(getRoomName(project)).emit('collab:active-users', {
    project: getProjectKey(project),
    users: serializeUsers(project),
  });
}

function getUsername(socket, providedUsername) {
  if (typeof providedUsername === 'string' && providedUsername.trim()) {
    return providedUsername.trim();
  }

  const authUsername = socket.data?.auth?.user?.username;
  if (typeof authUsername === 'string' && authUsername.trim()) {
    return authUsername.trim();
  }

  return 'IDE';
}

function leaveProject(io, socket, project) {
  if (!project) return;

  const projectKey = getProjectKey(project);
  const roomName = getRoomName(projectKey);
  const removed = removeUserEntry(projectKey, socket.id);

  socket.leave(roomName);

  if (socket.data.collabProject === projectKey) {
    delete socket.data.collabProject;
  }

  if (removed) {
    emitPresence(io, projectKey);
  }
}

export function setupCollaboration(io) {
  io.on('connection', (socket) => {
    socket.on('collab:join', (payload = {}, ack) => {
      const project = getProjectKey(payload.project);
      const username = getUsername(socket, payload.username);
      const activeFile = typeof payload.file === 'string' && payload.file.trim() ? payload.file.trim() : null;
      const previousProject = socket.data.collabProject;

      if (previousProject && previousProject !== project) {
        leaveProject(io, socket, previousProject);
      }

      socket.join(getRoomName(project));
      socket.data.collabProject = project;

      upsertUserEntry(project, {
        socketId: socket.id,
        username,
        activeFile,
        cursor: activeFile
          ? { file: activeFile, line: 1, column: 1 }
          : null,
      });

      if (activeFile) {
        socket.to(getRoomName(project)).emit('collab:event', {
          project,
          user: { socketId: socket.id, username },
          file: activeFile,
          action: 'opened',
        });
      }

      emitPresence(io, project);

      if (typeof ack === 'function') {
        ack({ ok: true, users: serializeUsers(project) });
      }
    });

    socket.on('collab:leave', (payload = {}) => {
      const project = payload.project || socket.data.collabProject;
      leaveProject(io, socket, project);
    });

    socket.on('collab:cursor', (payload = {}) => {
      const project = payload.project || socket.data.collabProject;
      const file = typeof payload.file === 'string' && payload.file.trim() ? payload.file.trim() : null;
      const line = Number(payload.line);
      const column = Number(payload.column);

      if (!project || !file || !Number.isFinite(line) || !Number.isFinite(column)) return;

      const entry = upsertUserEntry(project, {
        socketId: socket.id,
        username: getUsername(socket, payload.username),
        activeFile: file,
        cursor: { file, line, column },
      });

      if (!entry) return;

      socket.to(getRoomName(project)).emit('collab:cursor', {
        project: getProjectKey(project),
        user: { socketId: socket.id, username: entry.username },
        file,
        line,
        column,
      });
    });

    socket.on('collab:save', (payload = {}) => {
      const project = payload.project || socket.data.collabProject;
      const file = typeof payload.file === 'string' && payload.file.trim() ? payload.file.trim() : null;
      const content = typeof payload.content === 'string' ? payload.content : '';

      if (!project || !file) return;

      const entry = upsertUserEntry(project, {
        socketId: socket.id,
        username: getUsername(socket, payload.username),
        activeFile: file,
      });

      socket.to(getRoomName(project)).emit('collab:event', {
        project: getProjectKey(project),
        user: { socketId: socket.id, username: entry.username },
        file,
        action: 'saved',
        content,
      });

      emitPresence(io, project);
    });

    socket.on('disconnect', () => {
      leaveProject(io, socket, socket.data.collabProject);
    });
  });
}
