import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import Dashboard from './pages/Dashboard'
import VehicleSearch from './pages/VehicleSearch'
import Analytics from './pages/Analytics'
import AlertsView from './pages/AlertsView'
import BlacklistView from './pages/BlacklistView'
import OCRPreview from './pages/OCRPreview'
import AuditLog from './pages/AuditLog'
import UserManagement from './pages/UserManagement'
import { AuthProvider, useAuth, hasRole } from './lib/auth'
import { AlertWebSocketProvider } from './lib/ws'

// Only mounted once the user is authenticated — this is deliberate, not
// just a route guard: AlertWebSocketProvider reads the token at connect()
// time, so nesting it here means a fresh login always gets a fresh socket
// (and a logout cleanly tears the old one down) rather than trying to swap
// the token on an already-open connection.
function AuthenticatedShell() {
  return (
    <AlertWebSocketProvider>
      <Layout />
    </AlertWebSocketProvider>
  )
}

function AppRoutes() {
  const { user } = useAuth()

  return (
    <Routes>
      {/* No separate /login route — signing in happens directly on the
          landing page's own embedded panel. Logged-out visitors land on
          Landing regardless of which of these paths they hit (the parent
          route's element fully replaces the tree, so the child routes
          below never render without a session); once authenticated, the
          same paths resolve to the real dashboard shell as before. */}
      <Route path="/" element={user ? <AuthenticatedShell /> : <Landing />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="vehicle" element={<VehicleSearch />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="alerts" element={<AlertsView />} />
        <Route path="blacklist" element={<BlacklistView />} />
        <Route path="ocr-preview" element={<OCRPreview />} />
        <Route
          path="audit-log"
          element={hasRole(user, 'admin') ? <AuditLog /> : <Navigate to="/dashboard" replace />}
        />
        <Route
          path="users"
          element={hasRole(user, 'admin') ? <UserManagement /> : <Navigate to="/dashboard" replace />}
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
