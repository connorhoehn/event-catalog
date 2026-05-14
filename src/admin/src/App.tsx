import { Routes, Route, NavLink } from 'react-router-dom';
import { Dashboard } from './components/Dashboard';
import { EventList } from './components/EventList';
import { EventDetail } from './components/EventDetail';
import { TopologyView } from './components/TopologyView';
import { LiveInspector } from './components/LiveInspector';
import { TransportHealth } from './components/TransportHealth';
import { DLQBrowser } from './components/DLQBrowser';
import { DeclarationViewer } from './components/DeclarationViewer';

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
          <li><NavLink to="/declarations">Declarations</NavLink></li>
          <li><NavLink to="/topology">Topology</NavLink></li>
          <li><NavLink to="/live">Live Inspector</NavLink></li>
          <li><NavLink to="/dlq">DLQ</NavLink></li>
          <li><NavLink to="/health">Transports</NavLink></li>
        </ul>
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/events" element={<EventList />} />
          <Route path="/events/:name" element={<EventDetail />} />
          <Route path="/declarations" element={<DeclarationViewer />} />
          <Route path="/topology" element={<TopologyView />} />
          <Route path="/live" element={<LiveInspector />} />
          <Route path="/dlq" element={<DLQBrowser />} />
          <Route path="/health" element={<TransportHealth />} />
        </Routes>
      </main>
    </div>
  );
}
