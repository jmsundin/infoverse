import { useState, FC, FormEvent } from "react";

interface AuthPageProps {
  onLogin: (user: {
    id: string;
    username: string;
    storagePath?: string;
  }) => void;
  onCancel: () => void;
  initialMode?: "login" | "signup";
}

export const AuthPage: React.FC<AuthPageProps> = ({
  onLogin,
  onCancel,
  initialMode = "login",
}) => {
  const [isLogin, setIsLogin] = useState(initialMode === "login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const apiBase = (import.meta as any).env.VITE_API_URL || "";
    const endpoint = isLogin
      ? `${apiBase}/api/auth/login`
      : `${apiBase}/api/auth/signup`;
    // During signup, we no longer send storagePath
    const body = { username, password };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (response.ok) {
        onLogin(data.user);
      } else {
        setError(data.message || "Authentication failed");
      }
    } catch (err) {
      setError("Network error. Please ensure the server is running.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-900 text-slate-200">
      <div className="w-full max-w-md p-8 bg-slate-800 rounded-xl shadow-2xl border border-slate-700">
        <div className="text-center mb-8">
          <div className="flex flex-col items-center justify-center mb-2">
            <div className="w-16 h-16 bg-gradient-to-br from-sky-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-sky-500/20 mb-4">
              <svg
                className="w-10 h-10 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <circle cx="6" cy="6" r="2" />
                <circle cx="18" cy="6" r="2" />
                <circle cx="6" cy="18" r="2" />
                <circle cx="18" cy="18" r="2" />
                <path d="M12 12L6 6" />
                <path d="M12 12L18 6" />
                <path d="M12 12L6 18" />
                <path d="M12 12L18 18" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-white tracking-tight">
              infoverse
            </h1>
          </div>
          <p className="text-slate-400 mt-2">
            {isLogin
              ? "Sign in to access your personalized Infoverse."
              : "Join Infoverse to start mapping your mind."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-3 text-sm text-red-200 bg-red-900/50 border border-red-800 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Username
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-transparent outline-none text-white placeholder-slate-500 transition-all"
              placeholder="Enter your username"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-transparent outline-none text-white placeholder-slate-500 transition-all"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg shadow-lg shadow-sky-500/20 transition-all transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed flex justify-center"
          >
            {loading ? (
              <svg
                className="animate-spin h-5 w-5 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
            ) : isLogin ? (
              "Sign In"
            ) : (
              "Sign Up"
            )}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-slate-400">
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <button
            onClick={() => {
              setIsLogin(!isLogin);
              setError("");
            }}
            className="text-sky-400 hover:text-sky-300 font-semibold hover:underline"
          >
            {isLogin ? "Sign Up" : "Log In"}
          </button>
        </div>

        <div className="mt-4 text-center">
          <button
            onClick={onCancel}
            className="text-slate-500 hover:text-slate-300 text-xs"
          >
            Return to Home
          </button>
        </div>
      </div>
    </div>
  );
};
