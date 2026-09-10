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

// Lazy import so the module (and @anchor-lang/core) is not bundled into the
// main chunk unless a $HUB route is actually visited. Mounted at both /hub
// (live mainnet config, gated behind HUB_ENABLED below) and /devnet (forced
// devnet sandbox — see HUB_DEVNET_CONFIG in pages/Hub.jsx). /devnet is a
// risk-free QA environment and stays reachable even while /hub is dark, since
// it never depends on the mainnet program or token mint being live.
// otchub.dev/fomo is a separate app entirely (Cloudflare Workers Route on the
// shared zone, see rufomo/wrangler.toml) and never reaches this router.
const Hub = React.lazy(() => import('./pages/Hub'));

// The $HUB chunk carries @anchor-lang/core — heavy. While it loads, a blank
// fallback reads as a dead/gated page, so show a terminal-style loading screen
// instead (this Suspense only ever covers the lazy Hub mounts: /hub, /devnet).
const HubFallback = () => (
  <div className="flex min-h-screen max-w-[100vw] items-center justify-center bg-black font-mono">
    <span className="animate-pulse text-sm uppercase tracking-widest text-green-400">
      &gt; LOADING $HUB TERMINAL…
    </span>
  </div>
);

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

  // Render the main app. Home is always the root — single-domain,
  // path-based routing on otchub.dev (app.otchub.dev / devnet.otchub.dev
  // are retired). /otc is kept as a legacy alias since it was Home's path
  // during the (never-shipped) period when Hub sat at "/".
  //
  // /hub (mainnet $HUB dashboard) and /devnet (forced-devnet QA sandbox,
  // see HUB_DEVNET_CONFIG in pages/Hub.jsx) are two independent mounts of
  // the same component tree. /devnet never depends on HUB_ENABLED — it's
  // meant to stay usable for testing while mainnet is still dark — so only
  // /hub is wrapped in the launch gate.
  return (
    <React.Suspense fallback={<HubFallback />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/otc" element={<Navigate to="/" replace />} />
        <Route path="/about" element={<About />} />
        <Route path="/connect" element={<Connect />} />
        {/* $HUB protocol metrics: "", /treasury, /tokenomics, /mechanics,
            /deployments, /desk/:asset — relative, so they resolve under
            either mount. HubRoutes redirects any other unknown sub-path
            back to its own root. */}
        <Route path="/devnet/*" element={<Hub devnet />} />
        {HUB_ENABLED && <Route path="/hub/*" element={<Hub />} />}
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