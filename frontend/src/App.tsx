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
import NotFound from './pages/NotFound'
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

// Gate for the actual app (dashboard, search, analytics, etc.) — separate
// from the root route on purpose: "/" always shows Landing first, even for
// an already-logged-in visitor (a stored session shouldn't skip straight
// past it). Only these feature routes require a session, redirecting back
// to Landing rather than rendering anything if there isn't one.
function ProtectedRoute() {
  const { user } = useAuth()
  return user ? <AuthenticatedShell /> : <Navigate to="/" replace />
}

function AppRoutes() {
  const { user } = useAuth()

  return (
    <Routes>
      {/* Landing is the true home page — shown first regardless of auth
          state, whether this is a fresh visitor or a returning logged-in
          one. Reaching the dashboard from here is a deliberate action
          (scroll past the hero, swipe up, or the logo link elsewhere),
          not an automatic redirect. */}
      <Route path="/" element={<Landing />} />
      {/* /home is an alias — used by the logo link in Layout.tsx so a
          logged-in visitor can navigate back here explicitly without it
          reading as "back to the root," which some routing shortcuts
          special-case. Same element, same behavior. */}
      <Route path="/home" element={<Landing />} />
      <Route element={<ProtectedRoute />}>
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
      <Route path="*" element={<NotFound />} />
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
