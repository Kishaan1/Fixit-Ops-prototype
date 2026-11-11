import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import Layout from './components/Layout'
import { Button, EmptyState, LoadingState } from './components/ui'
import { useAuth } from './lib/auth'
import Login from './pages/Login'
import PublicReport from './pages/PublicReport'
import NotFound from './pages/NotFound'

// Route-level code splitting keeps the initial shell small; analytics and the
// dashboard pull in the charting library, which should not block sign-in.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Repairs = lazy(() => import('./pages/Repairs'))
const NewRepair = lazy(() => import('./pages/NewRepair'))
const Diagnostics = lazy(() => import('./pages/Diagnostics'))
const RepairDetail = lazy(() => import('./pages/RepairDetail'))
const Customers = lazy(() => import('./pages/Customers'))
const CustomerDetail = lazy(() => import('./pages/CustomerDetail'))
const Technicians = lazy(() => import('./pages/Technicians'))
const TechnicianDetail = lazy(() => import('./pages/TechnicianDetail'))
const OwnerTechnicianAccounts = lazy(() => import('./pages/OwnerTechnicianAccounts'))
const PasswordResetRequests = lazy(() => import('./pages/PasswordResetRequests'))
const Profile = lazy(() => import('./pages/Profile'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const Parts = lazy(() => import('./pages/Parts'))
const Inventory = lazy(() => import('./pages/Inventory'))
const Reports = lazy(() => import('./pages/Reports'))
const Analytics = lazy(() => import('./pages/Analytics'))
const SettingsPage = lazy(() => import('./pages/Settings'))

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingState label="Preparing your workspace…" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <>{children}</>
}

function OwnerRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  if (user?.role !== 'OWNER') {
    return (
      <div className="surface mx-auto max-w-lg p-6 my-10">
        <EmptyState
          icon={ShieldAlert}
          title="Owner access required"
          description="This area contains administrative, financial, and team data that only the shop owner can view."
          action={
            <Button variant="outline" onClick={() => window.history.back()}>
              Go back
            </Button>
          }
        />
      </div>
    )
  }
  return <>{children}</>
}

export default function App() {
  // Dropping a file outside a supported upload box must never replace the app
  // with the raw image. The dropzone handlers still receive the event first.
  useEffect(() => {
    const blockFileDrop = (event: DragEvent) => {
      if (event.dataTransfer?.types?.includes('Files')) event.preventDefault()
    }
    window.addEventListener('dragover', blockFileDrop)
    window.addEventListener('drop', blockFileDrop)
    return () => {
      window.removeEventListener('dragover', blockFileDrop)
      window.removeEventListener('drop', blockFileDrop)
    }
  }, [])

  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <LoadingState label="Loading workspace…" />
        </div>
      }
    >
      <Routes>
        {/* Public & Authentication Routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/login/owner" element={<Login />} />
        <Route path="/login/technician" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/r/:token" element={<PublicReport />} />

        {/* Authenticated Workspace */}
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/repairs" element={<Repairs />} />
          <Route path="/repairs/new" element={<NewRepair />} />
          <Route path="/diagnostics" element={<Diagnostics />} />
          <Route path="/repairs/:id" element={<RepairDetail />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/:id" element={<CustomerDetail />} />

          {/* Profile Management (both Owner and Technician) */}
          <Route path="/profile" element={<Profile />} />

          {/* Owner-only Technician Account Management */}
          <Route
            path="/owner/technicians"
            element={
              <OwnerRoute>
                <OwnerTechnicianAccounts />
              </OwnerRoute>
            }
          />
          <Route
            path="/owner/password-requests"
            element={
              <OwnerRoute>
                <PasswordResetRequests />
              </OwnerRoute>
            }
          />

          {/* Technician Profiles & Performance */}
          <Route
            path="/technicians"
            element={
              <OwnerRoute>
                <Technicians />
              </OwnerRoute>
            }
          />
          <Route path="/technicians/:id" element={<TechnicianDetail />} />

          {/* Parts & Inventory */}
          <Route path="/parts" element={<Parts />} />
          <Route
            path="/inventory"
            element={
              <OwnerRoute>
                <Inventory />
              </OwnerRoute>
            }
          />

          {/* Reports & Analytics */}
          <Route path="/reports" element={<Reports />} />
          <Route
            path="/analytics"
            element={
              <OwnerRoute>
                <Analytics />
              </OwnerRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <OwnerRoute>
                <SettingsPage />
              </OwnerRoute>
            }
          />

          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
