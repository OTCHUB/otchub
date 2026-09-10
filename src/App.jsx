import React from 'react';
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import Home from './pages/Home';
import About from './pages/About';
import Connect from './pages/Connect';
import { HUB_ENABLED } from './lib/hubFlag';
// Add page imports here

// $HUB dashboard stays dark until the token launches on mainnet. Lazy import so
// the module (and @anchor-lang/core) is not bundled into the main chunk while off.
// Mounted at both /hub (live config) and /devnet (forced devnet sandbox — see
// HUB_DEVNET_CONFIG in pages/Hub.jsx); otchub.dev/fomo is a separate app
// entirely (Cloudflare Workers Route on the shared zone, see rufomo/wrangler.toml)
// and never reaches this router.
const Hub = HUB_ENABLED ? React.lazy(() => import('./pages/Hub')) : null;

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app. Home is always the root — otchub.dev/hub and
  // otchub.dev/devnet are the $HUB protocol dashboard (live config vs. a
  // forced-devnet sandbox); /otc is kept as a legacy alias since it was
  // Home's path during the (never-shipped) period when Hub sat at "/".
  if (!HUB_ENABLED) {
    return (
      <Routes>
        {/* Add your page Route elements here */}
        <Route path="/" element={<Home />} />
        <Route path="/otc" element={<Navigate to="/" replace />} />
        <Route path="/about" element={<About />} />
        <Route path="/connect" element={<Connect />} />
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    );
  }

  return (
    <React.Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/otc" element={<Navigate to="/" replace />} />
        <Route path="/about" element={<About />} />
        <Route path="/connect" element={<Connect />} />
        {/* $HUB protocol metrics: "", /treasury, /tokenomics, /mechanics,
            /deployments, /desk/:asset — relative, so they resolve under
            either mount. HubRoutes redirects any other unknown sub-path
            back to its own root. */}
        <Route path="/hub/*" element={<Hub />} />
        <Route path="/devnet/*" element={<Hub devnet />} />
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </React.Suspense>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App