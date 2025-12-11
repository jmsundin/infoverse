import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[200px] w-full p-6 text-center bg-slate-900 text-slate-200">
          <div className="max-w-md p-6 bg-slate-800 rounded-lg shadow-xl border border-slate-700">
            <h2 className="text-xl font-bold text-red-400 mb-2">Something went wrong</h2>
            <p className="text-slate-400 mb-4 text-sm">
              {this.state.error?.message || "An unexpected error occurred."}
            </p>
            <button
              onClick={this.handleReset}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

