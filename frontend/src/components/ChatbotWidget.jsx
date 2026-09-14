import React, { useEffect } from 'react';

const AGENT_ID = process.env.REACT_APP_DF_AGENT_ID;
const BOOTSTRAP_SRC = 'https://www.gstatic.com/dialogflow-console/fast/messenger/bootstrap.js?v=1';

// Dialogflow Messenger widget for the chatbot module's ES agent
// (chatbot/README.md "Embedding in the frontend"). Renders nothing until the
// agent id is configured, so pages can mount it unconditionally.
export default function ChatbotWidget() {
  useEffect(() => {
    if (!AGENT_ID || document.querySelector(`script[src="${BOOTSTRAP_SRC}"]`)) return;
    const script = document.createElement('script');
    script.src = BOOTSTRAP_SRC;
    script.async = true;
    document.body.appendChild(script);
  }, []);

  if (!AGENT_ID) return null;

  return <df-messenger intent="WELCOME" chat-title="SAWS Assistant" agent-id={AGENT_ID} language-code="en" />;
}
