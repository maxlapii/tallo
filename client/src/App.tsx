import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { RequireRole } from './auth/RequireRole';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { CustomerDisplayPage } from './pages/CustomerDisplayPage';
import { DashboardPage } from './pages/DashboardPage';
import { InventoryPage } from './pages/InventoryPage';
import { LoginPage } from './pages/LoginPage';
import { PosPage } from './pages/PosPage';
import { PrintersPage } from './pages/PrintersPage';
import { PrintStationPage } from './pages/PrintStationPage';
import { ProductsPage } from './pages/ProductsPage';
import { RegisterPage } from './pages/RegisterPage';
import { ReportsPage } from './pages/ReportsPage';
import { SaleDetailPage } from './pages/SaleDetailPage';
import { SalesPage } from './pages/SalesPage';
import { SignupPage } from './pages/SignupPage';
import { StorePage } from './pages/StorePage';
import { UsersPage } from './pages/UsersPage';

const STAFF = ['ADMIN', 'CASHIER'] as const;

function Home() {
  const { user } = useAuth();
  return user?.role === 'SALE' ? <Navigate to="/pos" replace /> : <DashboardPage />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route
        path="/display"
        element={
          <RequireAuth>
            <RequireRole roles={[...STAFF]}>
              <CustomerDisplayPage />
            </RequireRole>
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Home />} />
        <Route path="/pos" element={<PosPage />} />
        <Route
          path="/products"
          element={
            <RequireRole roles={[...STAFF]}>
              <ProductsPage />
            </RequireRole>
          }
        />
        <Route
          path="/inventory"
          element={
            <RequireRole roles={[...STAFF]}>
              <InventoryPage />
            </RequireRole>
          }
        />
        <Route path="/print-station" element={<PrintStationPage />} />
        <Route
          path="/printers"
          element={
            <RequireRole roles={['ADMIN']}>
              <PrintersPage />
            </RequireRole>
          }
        />
        <Route
          path="/store"
          element={
            <RequireRole roles={['ADMIN']}>
              <StorePage />
            </RequireRole>
          }
        />
        <Route
          path="/users"
          element={
            <RequireRole roles={['ADMIN']}>
              <UsersPage />
            </RequireRole>
          }
        />
        <Route path="/sales" element={<SalesPage />} />
        <Route path="/sales/:id" element={<SaleDetailPage />} />
        <Route
          path="/shift"
          element={
            <RequireRole roles={[...STAFF]}>
              <RegisterPage />
            </RequireRole>
          }
        />
        <Route
          path="/reports"
          element={
            <RequireRole roles={[...STAFF]}>
              <ReportsPage />
            </RequireRole>
          }
        />
      </Route>
      <Route path="/register" element={<Navigate to="/shift" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
