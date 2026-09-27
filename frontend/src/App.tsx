import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import { api, getToken, SESSION_EXPIRED_EVENT, setToken } from "./api";
import Layout from "./components/Layout";
import Login from "./Login";
import ActivitiesPage from "./pages/ActivitiesPage";
import ActivityDetailPage from "./pages/ActivityDetailPage";
import DashboardPage from "./pages/DashboardPage";
import EquipmentPage from "./pages/EquipmentPage";
import MapPage from "./pages/MapPage";
import { SyncProvider } from "./sync";

export default function App() {
  const [token, setTokenState] = useState(getToken);

  const handleToken = useCallback((value: string | null) => {
    setToken(value);
    setTokenState(value);
  }, []);

  // Start waking the backend and database right away, while the user types the password.
  useEffect(() => {
    api.wake();
  }, []);

  // Any 401 from the API (expired session) sends you back to the login page.
  useEffect(() => {
    const logout = () => handleToken(null);
    window.addEventListener(SESSION_EXPIRED_EVENT, logout);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, logout);
  }, [handleToken]);

  if (!token) return <Login onLogin={handleToken} />;

  return (
    <SyncProvider>
      <Routes>
        <Route element={<Layout onLogout={() => handleToken(null)} />}>
          <Route index element={<DashboardPage />} />
          <Route path="activities" element={<ActivitiesPage />} />
          <Route path="activities/:id" element={<ActivityDetailPage />} />
          <Route path="map" element={<MapPage />} />
          <Route path="equipment" element={<EquipmentPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </SyncProvider>
  );
}
