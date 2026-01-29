import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider } from './context/AuthContext';
import { StorageProvider } from './context/StorageContext';
import { AppStore } from './store';
import { AppStoreProvider } from './hooks/useAppStore';
import { AppEffects } from './AppEffects';

const store = new AppStore();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <StorageProvider>
          <AppStoreProvider store={store}>
            <AppEffects />
            <App />
          </AppStoreProvider>
        </StorageProvider>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
