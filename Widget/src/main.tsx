import React from 'react'
import ReactDOM from 'react-dom/client'
import NayaxaAssistant from './NayaxaAssistant'
import './index.css'

// Export as a mountable function for non-React apps
export const mountNayaxa = (el: HTMLElement, config: { 
  baseUrl: string, 
  apiKey: string, 
  user: any,
  title?: string,
  subtitle?: string 
}) => {
  const root = ReactDOM.createRoot(el);
  root.render(
    <React.StrictMode>
      <NayaxaAssistant {...config} />
    </React.StrictMode>
  );
  return root;
}

// Also export as React component
export { NayaxaAssistant };
