import { useEffect, useState } from "react";
import { checkBackendHealth } from "./api";
import Dashboard from "./pages/dashboard";
import FloodMap from "./pages/FloodMap";
import Alerts from "./pages/Alerts";
import Shelters from "./pages/Shelters";
import Routing from "./pages/Routing";
import Analytics from "./pages/Analytics";
import AIAssistant from "./pages/AIAssistant";
import Icon from "./components/Icon";

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
                    <div className="logo-icon">
                        <Icon name="shield" size={24} />
                    </div>

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
                            aria-label={item}
                            title={item}
                            aria-current={activePage === item ? "page" : undefined}
                        >
                            <span className="nav-icon">
                                <Icon
                                    name={
                                        {
                                            Dashboard: "grid",
                                            "Flood Map": "map",
                                            Alerts: "alert",
                                            Shelters: "building",
                                            Routing: "route",
                                            Analytics: "chart",
                                            "AI Assistant": "grid",
                                        }[item]
                                    }
                                />
                            </span>

                            <span>{item}</span>
                        </button>
                    ))}
                </nav>

                <div className="sidebar-bottom">
                    <div className="system-status">
                        <span className="status-dot"></span>

                        <div>
                            <strong>
                                {backendStatus === "connected"
                                    ? "API Connected"
                                    : backendStatus === "offline"
                                    ? "API Unavailable"
                                    : "Checking API"}
                            </strong>
                            <small>Health endpoint only</small>
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
                    
                        <span className="language-button">
                            <Icon name="globe" size={16} />
                            English
                        </span>

                        <button className="notification-button" onClick={() => setActivePage("Alerts")} aria-label="Open alerts">
                            <Icon name="bell" size={19} />
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
                        <Dashboard onNavigate={setActivePage} />
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

                    {activePage === "Analytics" && (
                        <Analytics />
                    )}

                    {activePage === "AI Assistant" && <AIAssistant />}

                    {activePage !== "Dashboard" &&
                      activePage !== "Flood Map" &&
                      activePage !== "Alerts" &&
                      activePage !== "Shelters" && 
                      activePage !== "Routing" &&
                      activePage !== "Analytics" &&
                      activePage !== "AI Assistant" &&(
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