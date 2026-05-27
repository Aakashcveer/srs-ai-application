import React, { useState, useEffect } from "react";
import Login from "./Components/Login/Login";
import Chat from "./Components/Chat/Chat";
import { logout } from "./AWS/auth";
import "./App.css";

const App = () => {
  const [authenticated, setAuthenticated] = useState(false);
  const [chatVisible, setChatVisible] = useState(false);
  const [theme, setTheme] = useState("light");

  const toggleTheme = () =>
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));

  useEffect(() => {
    document.body.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    const root = document.getElementById("root");
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
      // Slight delay so chat fades in after login exits
      setTimeout(() => setChatVisible(true), 80);
    }
  }, [authenticated]);

  const handleLogout = async () => {
    await logout();
    setChatVisible(false);
    setAuthenticated(false);
  };

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
