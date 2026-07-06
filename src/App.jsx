import React, { useState, useEffect } from "react";
import Login from "./Components/Login/Login";
import Chat from "./Components/Chat/Chat";
import ReportAccess from "./Components/ReportDelivery/ReportAccess";
import { logout } from "./AWS/auth";
import "./App.css";

const App = () => {
  const [authenticated, setAuthenticated] = useState(false);
  const [chatVisible, setChatVisible] = useState(false);
  const [theme, setTheme] = useState("light");

  const isReportAccessPage =
    window.location.pathname === "/report-access" ||
    window.location.pathname.startsWith("/report-access/");

  const toggleTheme = () =>
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));

  useEffect(() => {
    document.body.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    const root = document.getElementById("root");

    if (isReportAccessPage) {
      document.body.style.margin = "0";
      document.body.style.padding = "0";
      document.body.style.overflow = "auto";
      document.body.style.width = "100vw";
      document.body.style.minHeight = "100vh";
      document.body.style.height = "auto";

      if (root) {
        root.style.width = "100vw";
        root.style.minHeight = "100vh";
        root.style.height = "auto";
        root.style.overflow = "auto";
        root.style.margin = "0";
        root.style.padding = "0";
      }

      return;
    }

    if (!authenticated) {
      document.body.style.margin = "0";
      document.body.style.padding = "0";
      document.body.style.overflow = "hidden";
      document.body.style.width = "100vw";
      document.body.style.height = "100vh";

      if (root) {
        root.style.width = "100vw";
        root.style.height = "100vh";
        root.style.overflow = "hidden";
        root.style.margin = "0";
        root.style.padding = "0";
      }
    } else {
      document.body.style.overflow = "";
      document.body.style.width = "";
      document.body.style.height = "";

      if (root) {
        root.style.width = "";
        root.style.height = "";
        root.style.overflow = "";
      }

      setTimeout(() => setChatVisible(true), 80);
    }
  }, [authenticated, isReportAccessPage]);

  const handleLogout = async () => {
    await logout();
    setChatVisible(false);
    setAuthenticated(false);
  };

  if (isReportAccessPage) {
    return <ReportAccess />;
  }

  return authenticated ? (
    <div
      className={`layout ${theme}`}
      style={{
        opacity: chatVisible ? 1 : 0,
        transform: chatVisible ? "translateY(0)" : "translateY(20px)",
        transition: "opacity 0.5s ease, transform 0.5s ease",
      }}
    >
      <Chat
        theme={theme}
        toggleTheme={toggleTheme}
        onLogout={handleLogout}
      />
    </div>
  ) : (
    <Login onAuthenticate={() => setAuthenticated(true)} />
  );
};

export default App;
