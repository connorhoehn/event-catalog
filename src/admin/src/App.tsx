import { Suspense, lazy, useEffect, useRef } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import SkeletonCard from '@ui/components/shared/SkeletonCard';
import SkipLink from '@ui/components/shared/SkipLink';
import LiveRegion from '@ui/components/shared/LiveRegion';
import { Dashboard } from './components/Dashboard';
import { AuthNotice } from './components/AuthNotice';

// Every route except the landing Dashboard is code-split. Topology and Flow
// are the reason: they pull @xyflow/react + dagre, which together are most of
// the bundle, and an operator who only ever looks at the event list should
// never download them. The rest are split too so the initial payload is just
// the shell, React, the router and the Dashboard.
const EventList = lazy(() => import('./components/EventList').then(m => ({ default: m.EventList })));
const EventDetail = lazy(() => import('./components/EventDetail').then(m => ({ default: m.EventDetail })));
const TopologyView = lazy(() => import('./components/TopologyView').then(m => ({ default: m.TopologyView })));
const FlowView = lazy(() => import('./components/FlowView').then(m => ({ default: m.FlowView })));
const AuditView = lazy(() => import('./components/AuditView').then(m => ({ default: m.AuditView })));
const SubscribersView = lazy(() => import('./components/SubscribersView').then(m => ({ default: m.SubscribersView })));
const NamespacesView = lazy(() => import('./components/NamespacesView').then(m => ({ default: m.NamespacesView })));
const BundlesView = lazy(() => import('./components/BundlesView').then(m => ({ default: m.BundlesView })));
const BundleDetail = lazy(() => import('./components/BundleDetail').then(m => ({ default: m.BundleDetail })));
const CoverageView = lazy(() => import('./components/CoverageView').then(m => ({ default: m.CoverageView })));
const LiveInspector = lazy(() => import('./components/LiveInspector').then(m => ({ default: m.LiveInspector })));
const TransportHealth = lazy(() => import('./components/TransportHealth').then(m => ({ default: m.TransportHealth })));
const DLQBrowser = lazy(() => import('./components/DLQBrowser').then(m => ({ default: m.DLQBrowser })));
const DeclarationViewer = lazy(() => import('./components/DeclarationViewer').then(m => ({ default: m.DeclarationViewer })));

/** Nav destinations, in tab order. `end` marks the exact-match root route. */
const NAV: ReadonlyArray<{ to: string; label: string; end?: boolean }> = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/events', label: 'Events' },
  { to: '/namespaces', label: 'Namespaces' },
  { to: '/bundles', label: 'Bundles' },
  { to: '/coverage', label: 'Coverage' },
  { to: '/declarations', label: 'Declarations' },
  { to: '/topology', label: 'Topology' },
  { to: '/flow', label: 'Flow' },
  { to: '/audit', label: 'Audit' },
  { to: '/subscribers', label: 'Subscribers' },
  { to: '/live', label: 'Live Inspector' },
  { to: '/dlq', label: 'DLQ' },
  // NOT '/health': the server serves its health JSON at that exact path
  // (src/server/index.ts rootRouter.get('/health')), and the admin bundle is
  // served from the same origin — so deep-linking or reloading the Transports
  // view returned raw JSON instead of the UI. Found when the e2e harness
  // started serving a root /health of its own.
  { to: '/transports', label: 'Transports' },
];

/** Human name for the current path, for the route announcer. */
function routeName(pathname: string): string {
  if (pathname.startsWith('/events/')) return 'Event detail';
  // `/bundles` is a nav destination and `/bundles/:name` is not, so the
  // prefix match below would announce the detail page as the list it came
  // from. Coverage lives at its own top-level path for the same reason —
  // nesting it under /bundles would have made the sidebar highlight two
  // entries at once.
  if (pathname.startsWith('/bundles/')) return 'Bundle detail';
  const hit = NAV.find(n => (n.end ? pathname === n.to : pathname.startsWith(n.to)));
  return hit?.label ?? 'Page not found';
}

/** Shown while a route chunk is in flight. Deliberately the same skeleton
 *  stack the views themselves render while fetching, so a cold navigation
 *  looks like one continuous load rather than two different waits.
 *
 *  `aria-busy` is what tells a screen reader the region is mid-update; the
 *  shimmer rectangles say nothing on their own. */
function RouteFallback() {
  return (
    <div className="skeleton-stack" aria-busy="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <SkeletonCard key={i} height={64} />
      ))}
      <LiveRegion role="none" message="Loading view…" />
    </div>
  );
}

export function App() {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  // A client-side route swap replaces <main>'s contents while focus stays on
  // the nav link that was clicked, so a keyboard user's next Tab continues
  // down the sidebar rather than entering the view they just opened, and a
  // screen reader is told nothing at all. Moving focus to the (now
  // programmatically focusable) main landmark fixes both: the reader
  // announces the landmark, and Tab resumes inside the new view.
  //
  // Skipped on first paint — on a cold load focus belongs at the top of the
  // document, and stealing it would skip the sidebar entirely.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [pathname]);

  return (
    <div className="app">
      <SkipLink targetId="main-content" />
      {/* Announces the destination of a client-side navigation, which is
          otherwise silent. `polite` because the user asked for it and is not
          in the middle of anything else. Sits outside <main> so it is never
          replaced by the route it describes. */}
      <LiveRegion role="none" message={`${routeName(pathname)} view`} />

      <nav className="sidebar" aria-label="Views">
        <div className="sidebar-header">
          <h1>Event Catalog</h1>
          <span className="version">v0.1.1</span>
        </div>
        <ul className="nav-links">
          {NAV.map(item => (
            <li key={item.to}>
              <NavLink to={item.to} end={item.end}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <main className="content" id="main-content" ref={mainRef} tabIndex={-1}>
        {/* Inside <main> so the skip link reaches it, above <Routes> so a
            route swap cannot unmount it. */}
        <AuthNotice />
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/events" element={<EventList />} />
            <Route path="/events/:name" element={<EventDetail />} />
            <Route path="/namespaces" element={<NamespacesView />} />
            <Route path="/bundles" element={<BundlesView />} />
            <Route path="/bundles/:name" element={<BundleDetail />} />
            <Route path="/coverage" element={<CoverageView />} />
            <Route path="/declarations" element={<DeclarationViewer />} />
            <Route path="/topology" element={<TopologyView />} />
            <Route path="/flow" element={<FlowView />} />
            <Route path="/audit" element={<AuditView />} />
            <Route path="/subscribers" element={<SubscribersView />} />
            <Route path="/live" element={<LiveInspector />} />
            <Route path="/dlq" element={<DLQBrowser />} />
            <Route path="/transports" element={<TransportHealth />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
