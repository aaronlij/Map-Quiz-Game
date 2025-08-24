import React from "react";
import MapQuizGame from "./MapQuizGame.jsx";

class ErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error){ return { error }; }
  componentDidCatch(error, info){ console.error("App error:", error, info); }
  render(){
    if (this.state.error) {
      return (
        <div style={{padding:16,fontFamily:"system-ui, sans-serif"}}>
          <h1>Something went wrong.</h1>
          <pre style={{whiteSpace:"pre-wrap"}}>{String(this.state.error && this.state.error.message || this.state.error)}</pre>
          <p>Check file names & imports. If you fix and redeploy, this will disappear.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <div style={{ minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
        <MapQuizGame />
      </div>
    </ErrorBoundary>
  );
}
