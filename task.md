# Josh Replit - Personal Code Environment

## Overview
Build a web-based IDE similar to Replit with file management, code editor, and terminal execution.

## Tech Stack
- **Frontend:** React + Monaco Editor (VS Code's editor)
- **Backend:** Node.js + Express + Socket.io
- **Terminal:** xterm.js with PTY support
- **File System:** Local file operations with sandbox
- **Deployment:** /var/www/replit/ (Apache proxy)

## Core Features

### 1. File Explorer (Left Sidebar)
- Tree view of project files
- Create/delete/rename files and folders
- Upload files
- Download files
- Drag-and-drop support

### 2. Code Editor (Center)
- Monaco Editor (VS Code engine)
- Syntax highlighting for 50+ languages
- Auto-completion
- Multi-tab support
- Auto-save
- Themes: dark/light mode

### 3. Terminal (Bottom Panel)
- Real interactive terminal via xterm.js
- Execute shell commands
- Multiple terminal tabs
- Resizable panels

### 4. Project Management
- Create new projects
- List all projects
- Switch between projects
- Delete projects
- Import/export projects (zip)

### 5. Code Execution
- Run button for common languages
- Auto-detect language from file extension
- Real-time output streaming
- Stop running processes

## File Structure
```
/home/claude-runner/projects/josh-replit/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── FileExplorer.jsx
│   │   │   ├── CodeEditor.jsx
│   │   │   ├── Terminal.jsx
│   │   │   ├── Toolbar.jsx
│   │   │   └── ProjectSelector.jsx
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── styles/
│   ├── package.json
│   └── vite.config.js
├── backend/
│   ├── server.js
│   ├── routes/
│   │   ├── files.js
│   │   ├── projects.js
│   │   └── execute.js
│   ├── services/
│   │   ├── fileSystem.js
│   │   ├── terminal.js
│   │   └── executor.js
│   └── package.json
└── workspace/ (user projects stored here)
```

## API Endpoints

### Files
- GET /api/files/:project - List files in project
- GET /api/files/:project/:path - Read file content
- POST /api/files/:project - Create file/folder
- PUT /api/files/:project/:path - Update file content
- DELETE /api/files/:project/:path - Delete file/folder

### Projects
- GET /api/projects - List all projects
- POST /api/projects - Create new project
- DELETE /api/projects/:name - Delete project
- POST /api/projects/:name/export - Export as zip
- POST /api/projects/import - Import from zip

### Execution
- POST /api/execute - Run code (language auto-detect)
- POST /api/execute/stop - Kill running process

### WebSocket Events
- terminal:input - Send input to terminal
- terminal:output - Receive terminal output
- terminal:resize - Resize terminal
- file:change - Real-time file change notifications

## Security Sandbox
- Projects run in isolated directories under /workspace/
- No access to system files outside workspace
- Process limits (CPU, memory, time)
- Command blacklist (rm -rf /, dd, fork bombs)
- User permissions (run as non-root)

## Apache Configuration
```apache
<VirtualHost *:80>
    ServerName replit.allservicespecialists.com
    
    ProxyPass /api http://localhost:3500/api
    ProxyPassReverse /api http://localhost:3500/api
    
    ProxyPass /socket.io http://localhost:3500/socket.io
    ProxyPassReverse /socket.io http://localhost:3500/socket.io
    
    DocumentRoot /var/www/replit
    <Directory /var/www/replit>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>
</VirtualHost>
```

## Build & Deploy Commands
```bash
# Backend
cd backend
npm install
pm2 start server.js --name replit-backend

# Frontend
cd frontend
npm install
npm run build
sudo rsync -av dist/ /var/www/replit/
sudo systemctl restart apache2
```

## Success Criteria
1. Can create a new project
2. Can create/edit/save files
3. Monaco editor works with syntax highlighting
4. Terminal executes commands and shows output
5. Can run code with one click
6. File explorer shows project structure
7. Responsive UI
8. Auto-save every 2 seconds
9. Can switch between multiple projects
10. Accessible at replit.allservicespecialists.com
