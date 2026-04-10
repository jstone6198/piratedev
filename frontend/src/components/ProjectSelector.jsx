import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import {
  FaBolt,
  FaChevronDown,
  FaCube,
  FaFlask,
  FaGlobe,
  FaPlus,
  FaReact,
  FaServer,
  FaTimes,
} from 'react-icons/fa';

const TEMPLATE_ICONS = {
  react: FaReact,
  server: FaServer,
  globe: FaGlobe,
  flask: FaFlask,
  folder: FaCube,
};

const EMPTY_PROJECT_OPTION = {
  name: '__empty__',
  title: 'Empty Project',
  description: 'Start with a blank workspace and a single seed file.',
  icon: FaBolt,
};

const PROJECT_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export default function ProjectSelector({ currentProject, onSelectProject, setFileTree }) {
  const [projects, setProjects] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [createError, setCreateError] = useState('');
  const [submittingTemplate, setSubmittingTemplate] = useState('');

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
      setProjects([{ name: 'hello-world' }]);
      if (!currentProject) onSelectProject('hello-world');
    } finally {
      setLoading(false);
    }
  }, [currentProject, onSelectProject]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

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

  const openCreateModal = async () => {
    setIsOpen(false);
    setShowTemplates(true);
    setProjectName('');
    setCreateError('');
    setSubmittingTemplate('');

    try {
      setTemplateLoading(true);
      const res = await api.get('/templates');
      setTemplates(res.data.templates || []);
    } catch (err) {
      console.error('Failed to load templates:', err);
      setTemplates([]);
      setCreateError('Failed to load templates.');
    } finally {
      setTemplateLoading(false);
    }
  };

  const closeCreateModal = () => {
    if (submittingTemplate) return;
    setShowTemplates(false);
    setCreateError('');
    setProjectName('');
  };

  const handleCreateProject = async (templateName) => {
    const trimmedName = projectName.trim();

    if (!PROJECT_NAME_PATTERN.test(trimmedName)) {
      setCreateError('Use letters, numbers, dashes, or underscores.');
      return;
    }

    try {
      setCreateError('');
      setSubmittingTemplate(templateName || EMPTY_PROJECT_OPTION.name);

      if (templateName) {
        await api.post(`/templates/${encodeURIComponent(templateName)}/create`, {
          projectName: trimmedName,
        });
      } else {
        await api.post('/projects', { name: trimmedName });
      }

      await fetchProjects();
      onSelectProject(trimmedName);
      setShowTemplates(false);
      setProjectName('');
    } catch (err) {
      console.error('Failed to create project:', err);
      setCreateError(err.response?.data?.error || err.message);
    } finally {
      setSubmittingTemplate('');
    }
  };

  const projectList = projects.map((project) => (typeof project === 'string' ? project : project.name));
  const creationOptions = [EMPTY_PROJECT_OPTION, ...templates];

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
            onClick={openCreateModal}
          >
            <FaPlus style={{ marginRight: 6 }} /> New Project
          </div>
        </div>
      )}
      {showTemplates && (
        <div className="modal-overlay" onClick={closeCreateModal}>
          <div className="template-modal template-modal-large" onClick={(event) => event.stopPropagation()}>
            <div className="template-modal-header">
              <div>
                <h3 className="template-modal-title">Create Project</h3>
                <p className="template-modal-subtitle">Pick a starter or begin with an empty workspace.</p>
              </div>
              <button
                type="button"
                className="template-modal-close"
                onClick={closeCreateModal}
                aria-label="Close project creation dialog"
              >
                <FaTimes />
              </button>
            </div>

            <label className="template-name-field">
              <span className="template-name-label">Project Name</span>
              <input
                type="text"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                className="template-name-input"
                placeholder="my-app"
                autoFocus
              />
            </label>

            {createError && <div className="template-create-error">{createError}</div>}
            {templateLoading ? (
              <div className="template-empty-state">Loading templates...</div>
            ) : (
              <div className="template-grid">
                {creationOptions.map((template) => {
                  const Icon = template.icon ? (TEMPLATE_ICONS[template.icon] || FaCube) : FaCube;
                  const isSubmitting = submittingTemplate === template.name;
                  const disabled = Boolean(submittingTemplate);

                  return (
                    <button
                      key={template.name}
                      type="button"
                      className="template-card"
                      onClick={() => handleCreateProject(template.name === EMPTY_PROJECT_OPTION.name ? '' : template.name)}
                      disabled={disabled}
                    >
                      <div className="template-card-icon">
                        <Icon />
                      </div>
                      <div className="template-card-body">
                        <div className="template-card-title">{template.title}</div>
                        <div className="template-card-description">{template.description}</div>
                      </div>
                      <div className="template-card-action">
                        {isSubmitting
                          ? 'Creating...'
                          : template.name === EMPTY_PROJECT_OPTION.name
                            ? 'Create Empty'
                            : 'Use Template'}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
