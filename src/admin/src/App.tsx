import { Suspense, lazy } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import SkeletonCard from '@ui/components/shared/SkeletonCard';
import { Dashboard } from './components/Dashboard';

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
const LiveInspector = lazy(() => import('./components/LiveInspector').then(m => ({ default: m.LiveInspector })));
const TransportHealth = lazy(() => import('./components/TransportHealth').then(m => ({ default: m.TransportHealth })));
const DLQBrowser = lazy(() => import('./components/DLQBrowser').then(m => ({ default: m.DLQBrowser })));
const DeclarationViewer = lazy(() => import('./components/DeclarationViewer').then(m => ({ default: m.DeclarationViewer })));

/** Shown while a route chunk is in flight. Deliberately the same skeleton
 *  stack the views themselves render while fetching, so a cold navigation
 *  looks like one continuous load rather than two different waits. */
function RouteFallback() {
  return (
    <div className="skeleton-stack">
      {Array.from({ length: 4 }).map((_, i) => (
        <SkeletonCard key={i} height={64} />
      ))}
    </div>
  );
}

export function App() {
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar-header">
          <h1>Event Catalog</h1>
          <span className="version">v0.1.1</span>
        </div>
        <ul className="nav-links">
          <li><NavLink to="/">Dashboard</NavLink></li>
          <li><NavLink to="/events">Events</NavLink></li>
          <li><NavLink to="/namespaces">Namespaces</NavLink></li>
          <li><NavLink to="/declarations">Declarations</NavLink></li>
          <li><NavLink to="/topology">Topology</NavLink></li>
          <li><NavLink to="/flow">Flow</NavLink></li>
          <li><NavLink to="/audit">Audit</NavLink></li>
          <li><NavLink to="/subscribers">Subscribers</NavLink></li>
          <li><NavLink to="/live">Live Inspector</NavLink></li>
          <li><NavLink to="/dlq">DLQ</NavLink></li>
          <li><NavLink to="/health">Transports</NavLink></li>
        </ul>
      </nav>
      <main className="content">
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/events" element={<EventList />} />
            <Route path="/events/:name" element={<EventDetail />} />
            <Route path="/namespaces" element={<NamespacesView />} />
            <Route path="/declarations" element={<DeclarationViewer />} />
            <Route path="/topology" element={<TopologyView />} />
            <Route path="/flow" element={<FlowView />} />
            <Route path="/audit" element={<AuditView />} />
            <Route path="/subscribers" element={<SubscribersView />} />
            <Route path="/live" element={<LiveInspector />} />
            <Route path="/dlq" element={<DLQBrowser />} />
            <Route path="/health" element={<TransportHealth />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
