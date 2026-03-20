import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase/config";

// ─── Hardcoded credentials → Firebase email mapping ──────────────────────────
const USERS = [
  { username: "user", password: "password", role: "user",  email: "username@leadtracker.app" },
  { username: "admin",    password: "admin123", role: "admin", email: "admin@leadtracker.app"    },
];

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    // 1. Check hardcoded credentials first
    const match = USERS.find(
      (u) => u.username === username && u.password === password
    );

    if (!match) {
      setError("Invalid credentials. Please try again.");
      setLoading(false);
      return;
    }

    try {
      // 2. Sign into Firebase Auth silently using the mapped email
      await signInWithEmailAndPassword(auth, match.email, match.password);

      // 3. Store user info in localStorage as before
      localStorage.setItem("leadUser", JSON.stringify({
        username: match.username,
        role: match.role,
      }));

      window.location.reload();
    } catch (err: any) {
      console.error("Firebase auth error:", err);
      setError("Authentication failed. Please contact your administrator.");
      setLoading(false);
    }
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <img src="/k1.svg" alt="Karuyaki Logo" style={{ height: 40 }} />
        </div>
        <h1 style={styles.title}>Lead Tracker</h1>
        <p style={styles.subtitle}>Sign in to manage your pipeline</p>

        <form onSubmit={handleLogin} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={styles.input}
              placeholder="Enter username"
              autoComplete="username"
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              placeholder="Enter password"
              autoComplete="current-password"
            />
          </div>

          {error && <p style={styles.error}>{error}</p>}

          <button type="submit" style={styles.btn} disabled={loading}>
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f3460 100%)",
    fontFamily: "'DM Sans', sans-serif",
  },
  card: {
    background: "#ffffff",
    borderRadius: 20,
    padding: "48px 40px",
    width: "100%",
    maxWidth: 400,
    boxShadow: "0 32px 80px rgba(0,0,0,0.35)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  logo: { marginBottom: 16 },
  title: {
    fontSize: 26,
    fontWeight: 700,
    color: "#0f172a",
    margin: "0 0 6px",
    letterSpacing: "-0.5px",
  },
  subtitle: { fontSize: 14, color: "#64748b", margin: "0 0 32px" },
  form:     { width: "100%" },
  field:    { marginBottom: 20 },
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "#334155",
    marginBottom: 6,
  },
  input: {
    width: "100%",
    padding: "11px 14px",
    borderRadius: 10,
    border: "1.5px solid #e2e8f0",
    fontSize: 14,
    color: "#0f172a",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.2s",
    background: "#f8fafc",
  },
  error: {
    color: "#ef4444",
    fontSize: 13,
    marginBottom: 12,
    textAlign: "center",
  },
  btn: {
    width: "100%",
    padding: "13px",
    background: "#0f172a",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 4,
    letterSpacing: "0.2px",
  },
};