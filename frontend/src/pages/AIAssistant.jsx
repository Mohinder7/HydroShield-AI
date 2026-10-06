import { useState } from "react";
import { askAssistant } from "../api";

function AIAssistant() {
    const [messages, setMessages] = useState([
        {
            role: "assistant",
            text:
                "Hello! I'm HydroShield AI Assistant. Ask me anything about flood detection, Sentinel-1, risk analysis, routing, shelters, disaster management, or the HydroShield project.",
        },
    ]);

    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);

    const suggestions = [
        "How does HydroShield detect floods?",
        "Explain Sentinel-1 SAR in simple words",
        "How does the safe routing algorithm work?",
        "Explain this project to my professor",
    ];

    const sendMessage = async (message = input) => {
        const text = message.trim();

        if (!text || loading) {
            return;
        }

        const userMessage = {
            role: "user",
            text,
        };

        const updatedMessages = [
            ...messages,
            userMessage,
        ];

        setMessages(updatedMessages);
        setInput("");
        setLoading(true);

        try {
            const history = updatedMessages
                .slice(0, -1)
                .map((item) => ({
                    role: item.role,
                    content: item.text,
                }));

            const result = await askAssistant(
                text,
                history
            );

            setMessages((previous) => [
                ...previous,
                {
                    role: "assistant",
                    text:
                        result.answer ||
                        "I couldn't generate a response.",
                },
            ]);
        } catch (error) {
            setMessages((previous) => [
                ...previous,
                {
                    role: "assistant",
                    text:
                        error.message ||
                        "I couldn't connect to the AI assistant backend.",
                },
            ]);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        sendMessage();
    };

    return (
        <div className="ai-assistant-page">
            <div className="page-heading">
                <div>
                    <h1>AI Assistant</h1>

                    <p>
                        Ask HydroShield AI about flood detection,
                        risk analysis, routing, shelters, and
                        disaster response.
                    </p>
                </div>

                <div className="ai-status">
                    <span className="ai-status-dot"></span>
                    Responses on demand
                </div>
            </div>

            <div className="assistant-layout">
                <div className="assistant-chat-card">
                    <div className="assistant-header">
                        <div>
                            <h2>HydroShield AI</h2>
                            <p>
                                Intelligent disaster-response
                                assistant
                            </p>
                        </div>
                    </div>

                    <div className="assistant-messages">
                        {messages.map((message, index) => (
                            <div
                                key={index}
                                className={`message-row ${message.role}`}
                            >
                                <div className="message-avatar">
                                    {message.role === "assistant"
                                        ? "AI"
                                        : "You"}
                                </div>

                                <div className="message-bubble">
                                    {message.text}
                                </div>
                            </div>
                        ))}

                        {loading && (
                            <div className="message-row assistant">
                                <div className="message-avatar">
                                    AI
                                </div>

                                <div className="message-bubble typing">
                                    <span></span>
                                    <span></span>
                                    <span></span>
                                </div>
                            </div>
                        )}
                    </div>

                    <form
                        className="assistant-input-area"
                        onSubmit={handleSubmit}
                    >
                        <input
                            type="text"
                            value={input}
                            onChange={(event) =>
                                setInput(event.target.value)
                            }
                            placeholder="Ask anything..."
                            disabled={loading}
                        />

                        <button
                            type="submit"
                            disabled={
                                !input.trim() || loading
                            }
                        >
                            {loading ? "Thinking..." : "Send"}
                        </button>
                    </form>
                </div>

                <aside className="assistant-side-card">
                    <h3>Suggested Questions</h3>

                    <div className="suggestion-list">
                        {suggestions.map((suggestion) => (
                            <button
                                key={suggestion}
                                onClick={() =>
                                    sendMessage(suggestion)
                                }
                                disabled={loading}
                            >
                                {suggestion}
                            </button>
                        ))}
                    </div>

                    <div className="assistant-info">
                        <h3>What I can help with</h3>

                        <ul>
                            <li>Flood detection</li>
                            <li>Sentinel-1 SAR analysis</li>
                            <li>Flood risk interpretation</li>
                            <li>Safe route planning</li>
                            <li>Relief shelter information</li>
                            <li>AI and ML concepts</li>
                            <li>HydroShield project questions</li>
                            <li>General questions</li>
                        </ul>
                    </div>

                    <div className="assistant-note">
                        <strong>Prototype Notice</strong>

                        <p>
                            HydroShield AI is a decision-support
                            prototype. For real emergencies,
                            always follow instructions from
                            official emergency authorities.
                        </p>
                    </div>
                </aside>
            </div>
        </div>
    );
}

export default AIAssistant;