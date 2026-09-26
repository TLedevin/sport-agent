import { useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";
import Dashboard from "./Dashboard";
import Login from "./Login";

export default function App() {
  const [token, setTokenState] = useState(getToken);

  // Start waking the backend and database right away, while the user types the password.
  useEffect(() => {
    api.wake();
  }, []);

  function handleToken(value: string | null) {
    setToken(value);
    setTokenState(value);
  }

  return token ? <Dashboard onLogout={() => handleToken(null)} /> : <Login onLogin={handleToken} />;
}
