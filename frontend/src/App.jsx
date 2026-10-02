import { useEffect, useState } from "react";
import { checkBackendHealth } from "./api";
import Dashboard from "./pages/dashboard";
import FloodMap from "./pages/FloodMap";
import Alerts from "./pages/Alerts";
import Shelters from "./pages/Shelters";
import Routing from "./pages/Routing";

function App() {
    const [activePage, setActivePage] = useState("Dashboard");
    const [backendStatus, setBackendStatus] = useState("checking");

    useEffect(() => {
        checkBackendHealth()
            .then(() => {
                setBackendStatus("connected");
            })
            .catch(() => {
                setBackendStatus("offline");
            });
    }, []);

    const menuItems = [
        "Dashboard",
        "Flood Map",
        "Alerts",
        "Shelters",
        "Routing",
        "Analytics",
        "AI Assistant",
    ];

    return (
        <div className="app">
            {/* Sidebar */}
            <aside className="sidebar">
                <div className="logo-section">
                    <div className="logo-icon">🌊</div>

                    <div>
                        <h2>HydroShield</h2>
                        <span>AI Disaster Management</span>
                    </div>
                </div>

                <nav className="navigation">
                    {menuItems.map((item) => (
                        <button
                            key={item}
                            className={`nav-item ${
                                activePage === item ? "active" : ""
                            }`}
                            onClick={() => setActivePage(item)}
                        >
                            <span className="nav-icon">
                                {item === "Dashboard" && "⌂"}
                                {item === "Flood Map" && "◉"}
                                {item === "Alerts" && "⚠"}
                                {item === "Shelters" && "⌖"}
                                {item === "Routing" && "➜"}
                                {item === "Analytics" && "▥"}
                                {item === "AI Assistant" && "✦"}
                            </span>

                            <span>{item}</span>
                        </button>
                    ))}
                </nav>

                <div className="sidebar-bottom">
                    <div className="system-status">
                        <span className="status-dot"></span>

                        <div>
                            <strong>System Online</strong>
                            <small>HydroShield AI</small>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="main-content">
                <header className="topbar">
                    <div>
                        <h1>{activePage}</h1>
                        <p>Flood monitoring and disaster response system</p>
                    </div>

                    <div className="topbar-actions">
                        <div className={`backend-status ${backendStatus}`}>
                            <span className="status-dot"></span>

                            {backendStatus === "connected"
                                ? "Backend Connected"
                                    : backendStatus === "offline"
                                    ? "Backend Offline"
                                    : "Connecting..."}
                    </div>
                    
                        <button className="language-button">
                            🌐 English
                        </button>

                        <button className="notification-button">
                            🔔
                            <span className="notification-badge">3</span>
                        </button>

                        <div className="user-profile">
                            <div className="user-avatar">HM</div>

                            <div>
                                <strong>HydroShield User</strong>
                                <small>Emergency Manager</small>
                            </div>
                        </div>
                    </div>
                </header>

                <section className="page-content">
                    {activePage === "Dashboard" && (
                        <Dashboard />
                    )}

                    {activePage === "Flood Map" && (
                        <FloodMap />
                    )}

                    {activePage === "Alerts" && (
                        <Alerts />
                    )}

                    {activePage === "Shelters" && (
                        <Shelters />
                    )}

                    {activePage === "Routing" && <Routing />}

                    {activePage !== "Dashboard" &&
                      activePage !== "Flood Map" &&
                      activePage !== "Alerts" &&
                      activePage !== "Shelters" && 
                      activePage !== "Routing" &&(
                        <div className="welcome-card">
                          <h2>{activePage}</h2>

                          <p>
                            This module will be connected to the
                              HydroShield AI backend.
                          </p>
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
}

export default App;