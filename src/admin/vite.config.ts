import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const uiComponentsSrc = path.resolve(__dirname, '../../../ui-components/src');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@ui': uiComponentsSrc,
    },
    // `@ui` resolves to ui-components' SOURCE, so its own imports of these
    // peer deps resolve from ui-components/node_modules — a second copy of
    // @xyflow/react whose React context is not the one ReactFlowProvider
    // populates ("you have not used ReactFlowProvider as an ancestor", and a
    // white-screened /topology + /flow). Force one instance of each.
    dedupe: ['@xyflow/react', 'react', 'react-dom'],
  },
  server: {
    port: 3011,
    proxy: {
      '/api': {
        target: 'http://localhost:3010',
        changeOrigin: true,
      },
      // The root /health, which is a different endpoint from /api/health: it
      // runs the service-runtime check list, and the `coordinator` check in it
      // is the only place the registry replication state is exposed. Without
      // this proxy entry the Transports view renders "not reported" in dev
      // while the server is answering it perfectly one port over.
      '/health': {
        target: 'http://localhost:3010',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Topology and Flow are both lazy routes and both import
        // @xyflow/react + dagre. Naming that vendor code explicitly keeps it
        // in one chunk shared between them (instead of a synthetic shared
        // chunk named after whichever module rollup happened to pick), and
        // keeps it out of the entry chunk.
        //
        // This is a function rather than the object form because the object
        // form only places the packages it names — @xyflow's own d3-* and
        // graphlib dependencies were still being spilled into an anonymous
        // shared chunk. Matching on the resolved path catches the whole tree.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](@xyflow|dagre|graphlib|d3-)/.test(id)) {
            return 'vendor-graph';
          }
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return 'vendor-react';
          }
          return undefined;
        },
      },
    },
  },
});
