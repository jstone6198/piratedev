import React from 'react';

const styles = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    padding: '16px',
    color: '#f5f5f5',
    background: '#121212',
    border: '1px solid rgba(255, 95, 95, 0.45)',
    borderLeft: '4px solid #ff5f5f',
    borderRadius: '8px',
    overflow: 'auto',
  },
  title: {
    margin: 0,
    fontSize: '14px',
    fontWeight: 700,
    color: '#ff9b9b',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  message: {
    margin: 0,
    fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
    fontSize: '13px',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    color: '#ffd7d7',
  },
  details: {
    border: '1px solid rgba(255, 95, 95, 0.22)',
    borderRadius: '6px',
    background: '#0b0b0b',
  },
  summary: {
    cursor: 'pointer',
    padding: '10px 12px',
    fontSize: '12px',
    fontWeight: 700,
    color: '#ffb3b3',
    userSelect: 'none',
  },
  stack: {
    margin: 0,
    padding: '0 12px 12px',
    fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
    fontSize: '12px',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    color: '#d7d7d7',
  },
  button: {
    alignSelf: 'flex-start',
    padding: '9px 14px',
    border: '1px solid #ff5f5f',
    borderRadius: '6px',
    background: '#241212',
    color: '#ffe3e3',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
};

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      error: null,
      componentStack: '',
      resetKey: 0,
    };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({
      error,
      componentStack: info?.componentStack || '',
    });
  }

  handleReload = () => {
    this.setState((prevState) => ({
      error: null,
      componentStack: '',
      resetKey: prevState.resetKey + 1,
    }));
  };

  render() {
    const { children, name = 'Panel' } = this.props;
    const { error, componentStack, resetKey } = this.state;

    if (error) {
      const stackTrace = [error.stack, componentStack].filter(Boolean).join('\n\n');

      return (
        <div style={styles.panel} role="alert" aria-live="assertive">
          <h2 style={styles.title}>{name} Crashed</h2>
          <p style={styles.message}>{error.message || 'An unexpected error occurred.'}</p>
          <details style={styles.details}>
            <summary style={styles.summary}>Stack Trace</summary>
            <pre style={styles.stack}>{stackTrace || 'No stack trace available.'}</pre>
          </details>
          <button type="button" style={styles.button} onClick={this.handleReload}>
            Reload Panel
          </button>
        </div>
      );
    }

    return <React.Fragment key={resetKey}>{children}</React.Fragment>;
  }
}

export default ErrorBoundary;
