import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // ui-components is installed from a packed tarball and lists these as
    // peers, so there should only ever be one copy — but a second
    // @xyflow/react (e.g. from a stray `file:` link) puts ReactFlowProvider's
    // context in a different module instance ("you have not used
    // ReactFlowProvider as an ancestor", a white-screened /topology + /flow).
    // Force one instance of each.
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
      // ui-components' package.json declares no `sideEffects`, so Rollup
      // must assume every chunk the root barrel imports has side effects and
      // keeps all of them: AppShell and ThemeProvider are root-only, and
      // importing them dragged tiptap, yjs, prosemirror and the social and
      // graph chunks into the entry (1,024 kB). Treat the library's JS chunks
      // as side-effect free (its CSS arrives through styles.css, which this
      // rule does not match) so tree-shaking drops what the app never
      // references (entry: 257 kB). If a library feature ever relies on an
      // import-time side effect, the e2e suite's per-route render is what
      // catches it. Remove this once the package declares `sideEffects`.
      treeshake: {
        moduleSideEffects: (id: string) => !/[\\/]@connorhoehnslalom[\\/]ui-components[\\/]dist[\\/].*\.js$/.test(id),
      },
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
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/.test(id)) {
            return 'vendor-react';
          }
          return undefined;
        },
      },
    },
  },
});
