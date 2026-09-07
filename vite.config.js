import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// Vendored read-only $HUB SDK (mirror of hubconnect/sdk) consumed by src/hub via `@hub-sdk`.
const hubSdkDir = fileURLToPath(new URL('./src/hub-sdk/src', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  // `process.env` is referenced by anchor's node-oriented paths; stub it for the browser.
  define: { 'process.env': {} },
  resolve: {
    alias: { '@hub-sdk': hubSdkDir },
    // One copy each so PublicKey/BN instances are interchangeable across sdk + app.
    dedupe: ['@solana/web3.js', '@anchor-lang/core', 'bn.js', 'buffer', 'react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['@anchor-lang/core', '@solana/web3.js', 'buffer', 'bn.js'],
    esbuildOptions: { target: 'esnext' },
  },
  build: { target: 'esnext' },
  plugins: [
    base44({
      // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
      // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true',
      hmrNotifier: true,
      navigationNotifier: true,
      analyticsTracker: true,
      visualEditAgent: true
    }),
    react(),
  ]
});
