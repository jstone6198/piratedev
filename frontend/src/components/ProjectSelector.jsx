import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import { FaPlus, FaChevronDown, FaCopy } from 'react-icons/fa';

export default function ProjectSelector({ currentProject, onSelectProject, setFileTree }) {
  const [projects, setProjects] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState([]);

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/projects');
      const list = res.data || [];
      setProjects(list);
      if (!currentProject && list.length > 0) {
        const firstName = typeof list[0] === 'string' ? list[0] : list[0].name;
        onSelectProject(firstName);
      }
    } catch (err) {
      console.error('Failed to fetch projects:', err);
      // Fallback: seed with default project
      setProjects([{ name: 'hello-world' }]);
      if (!currentProject) onSelectProject('hello-world');
    } finally {
      setLoading(false);
    }
  }, [currentProject, onSelectProject]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Load file tree when project changes
  useEffect(() => {
    if (!currentProject) return;

    const loadTree = async () => {
      try {
        const res = await api.get(`/files/${encodeURIComponent(currentProject)}`);
        setFileTree(res.data || []);
      } catch (err) {
        console.error('Failed to load file tree:', err);
        setFileTree([]);
      }
    };
    loadTree();
  }, [currentProject, setFileTree]);

  const handleNewProject = async () => {
    const name = prompt('Project name:');
    if (!name || !name.trim()) return;

    const trimmed = name.trim().replace(/[^a-zA-Z0-9_\-. ]/g, '');
    if (!trimmed) return;

    try {
      await api.post('/projects', { name: trimmed });
      await fetchProjects();
      onSelectProject(trimmed);
    } catch (err) {
      console.error('Failed to create project:', err);
      alert('Failed to create project: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleNewFromTemplate = async (template) => {
    const name = prompt('Project name:');
    if (!name || !name.trim()) return;
    const trimmed = name.trim().replace(/[^a-zA-Z0-9_\-. ]/g, '');
    if (!trimmed) return;
    try {
      await api.post('/templates/create', { name: trimmed, template });
      await fetchProjects();
      onSelectProject(trimmed);
      setShowTemplates(false);
    } catch (err) {
      alert('Failed: ' + (err.response?.data?.error || err.message));
    }
  };

  const openTemplateMenu = async () => {
    setIsOpen(false);
    try {
      const res = await api.get('/templates');
      setTemplates(res.data.templates || []);
    } catch {
      setTemplates([]);
    }
    setShowTemplates(true);
  };

  const projectList = projects.map((p) => (typeof p === 'string' ? p : p.name));

  return (
    <div className="project-selector">
      <div
        className="project-dropdown"
        onClick={() => setIsOpen(!isOpen)}
        data-testid="project-dropdown"
      >
        <span className="project-name">
          {loading ? 'Loading...' : currentProject || 'Select Project'}
        </span>
        <FaChevronDown className={`dropdown-arrow ${isOpen ? 'open' : ''}`} />
      </div>
      {isOpen && (
        <div className="project-menu" data-testid="project-menu">
          {projectList.map((name) => (
            <div
              key={name}
              className={`project-menu-item ${name === currentProject ? 'active' : ''}`}
              onClick={() => {
                onSelectProject(name);
                setIsOpen(false);
              }}
            >
              {name}
            </div>
          ))}
          <div className="project-menu-divider" />
          <div
            className="project-menu-item new-project"
            onClick={() => {
              setIsOpen(false);
              handleNewProject();
            }}
          >
            <FaPlus style={{ marginRight: 6 }} /> New Project
          </div>
          <div
            className="project-menu-item new-project"
            onClick={openTemplateMenu}
          >
            <FaCopy style={{ marginRight: 6 }} /> New from Template
          </div>
        </div>
      )}
      {showTemplates && (
        <div className="modal-overlay" onClick={() => setShowTemplates(false)}>
          <div className="template-modal" onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px', color: '#e0e0e0' }}>Choose a Template</h3>
            {templates.length === 0 && <div style={{ color: '#888' }}>No templates available</div>}
            {templates.map(t => (
              <div key={t} className="template-item" onClick={() => handleNewFromTemplate(t)}>
                {t}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
