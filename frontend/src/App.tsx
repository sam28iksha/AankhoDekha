import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import VehicleSearch from './pages/VehicleSearch'
import Analytics from './pages/Analytics'
import AlertsView from './pages/AlertsView'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="vehicle" element={<VehicleSearch />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="alerts" element={<AlertsView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
