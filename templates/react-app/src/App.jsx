import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [count, setCount] = useState(0);
  return (
    <div style={{ fontFamily: 'sans-serif', padding: 40, textAlign: 'center' }}>
      <h1>React App</h1>
      <p>Count: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>Increment</button>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
