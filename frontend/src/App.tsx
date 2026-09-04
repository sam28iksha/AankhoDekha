import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import VehicleSearch from './pages/VehicleSearch'
import Analytics from './pages/Analytics'
import AlertsView from './pages/AlertsView'
import BlacklistView from './pages/BlacklistView'
import OCRPreview from './pages/OCRPreview'
import { AlertWebSocketProvider } from './lib/ws'

export default function App() {
  return (
    <AlertWebSocketProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="vehicle" element={<VehicleSearch />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="alerts" element={<AlertsView />} />
            <Route path="blacklist" element={<BlacklistView />} />
            <Route path="ocr-preview" element={<OCRPreview />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AlertWebSocketProvider>
  )
}
