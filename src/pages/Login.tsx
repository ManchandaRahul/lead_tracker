import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { auth, db } from "../firebase/config";

type FirestoreUser = {
  uid?: string;
  username: string;
  email: string;
  role: "admin" | "user";
  status?: "active" | "inactive";
};

function getAuthErrorMessage(err: any) {
  const code = err?.code || "";

  switch (code) {
    case "auth/invalid-credential":
      return "Invalid email/password in Firebase Authentication. Please verify the Auth user and password.";
    case "auth/wrong-password":
      return "Wrong password for this Firebase Authentication user.";
    case "auth/user-not-found":
      return "No Firebase Authentication user exists for this email.";
    case "auth/invalid-email":
      return "The email stored for this user is invalid.";
    case "auth/user-disabled":
      return "This Firebase Authentication user is disabled.";
    case "auth/too-many-requests":
      return "Too many login attempts. Please wait a bit and try again.";
    default:
      return code
        ? `Authentication failed: ${code}`
        : "Authentication failed. Please contact your administrator.";
  }
}

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const trimmedUsername = username.trim();
      const rawPassword = password;

      if (!trimmedUsername || !rawPassword) {
        setError("Please enter username and password.");
        setLoading(false);
        return;
      }

      const usersRef = collection(db, "users");
      const userQuery = query(
        usersRef,
        where("username", "==", trimmedUsername),
        limit(1)
      );
      const userSnap = await getDocs(userQuery);

      if (userSnap.empty) {
        setError("Invalid credentials. Please try again.");
        setLoading(false);
        return;
      }

      const userDoc = userSnap.docs[0];
      const match = userDoc.data() as FirestoreUser;

      if (!match.email || !match.role) {
        const availableFields = Object.keys(match || {}).sort().join(", ");
        const missingFields = [
          !match.email ? "email" : null,
          !match.role ? "role" : null,
        ]
          .filter(Boolean)
          .join(", ");
        setError(
          `User record is incomplete. Missing: ${missingFields || "unknown"}. Available fields: ${availableFields || "none"}.`
        );
        setLoading(false);
        return;
      }

      if ((match.status || "active") !== "active") {
        setError("Your account is inactive. Please contact your administrator.");
        setLoading(false);
        return;
      }

      await signInWithEmailAndPassword(auth, match.email, rawPassword);

      localStorage.setItem("leadUser", JSON.stringify({
        username: match.username,
        role: match.role,
        uid: match.uid || userDoc.id,
        email: match.email,
      }));

      window.location.reload();
    } catch (err: any) {
      console.error("Firebase auth error:", err);
      setError(getAuthErrorMessage(err));
      setLoading(false);
    }
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.bgGlowTop} />
      <div style={styles.bgGlowBottom} />
      <div style={styles.arcOne} />
      <div style={styles.arcTwo} />

      <div style={styles.card}>
        <div style={styles.logoShell}>
          <img src="/k1.svg" alt="Karuyaki Logo" style={{ height: 34 }} />
        </div>
        <h1 style={styles.title}>Lead Tracker</h1>
        <p style={styles.subtitle}>
          Manage your pipeline and team activity.
        </p>

        <form onSubmit={handleLogin} style={styles.form}>
          <div style={styles.field}>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={styles.input}
              placeholder="Username"
              autoComplete="username"
            />
          </div>
          <div style={styles.field}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              placeholder="Password"
              autoComplete="current-password"
            />
          </div>

          {error && <p style={styles.error}>{error}</p>}

          <button type="submit" style={styles.btn} disabled={loading}>
            {loading ? "Signing in..." : "Get Started"}
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
    background: "linear-gradient(180deg, #9fd5f3 0%, #d9eefb 55%, #eff6fc 100%)",
    fontFamily: "'DM Sans', sans-serif",
    position: "relative",
    overflow: "hidden",
    padding: "32px 20px",
  },
  bgGlowTop: {
    position: "absolute",
    inset: "0 0 auto 0",
    height: "46%",
    background: "linear-gradient(180deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0) 100%)",
    pointerEvents: "none",
  },
  bgGlowBottom: {
    position: "absolute",
    left: "-8%",
    bottom: "-4%",
    width: "116%",
    height: "42%",
    background: "radial-gradient(circle at 50% 0%, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.22) 33%, rgba(255,255,255,0) 72%)",
    pointerEvents: "none",
  },
  arcOne: {
    position: "absolute",
    width: 980,
    height: 980,
    borderRadius: "50%",
    border: "2px solid rgba(255,255,255,0.28)",
    left: "50%",
    bottom: -700,
    transform: "translateX(-50%)",
    pointerEvents: "none",
  },
  arcTwo: {
    position: "absolute",
    width: 760,
    height: 760,
    borderRadius: "50%",
    border: "2px solid rgba(255,255,255,0.2)",
    left: "50%",
    bottom: -560,
    transform: "translateX(-50%)",
    pointerEvents: "none",
  },
  card: {
    background: "linear-gradient(180deg, rgba(232,247,255,0.94) 0%, rgba(255,255,255,0.9) 100%)",
    backdropFilter: "blur(14px)",
    borderRadius: 30,
    padding: "38px 38px 32px",
    width: "100%",
    maxWidth: 430,
    border: "1px solid rgba(177,220,244,0.95)",
    boxShadow: "0 22px 60px rgba(83,129,166,0.22)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    position: "relative",
    zIndex: 1,
  },
  logoShell: {
    width: 64,
    height: 64,
    borderRadius: 20,
    background: "linear-gradient(180deg, #ffffff 0%, #eef6fb 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 10px 26px rgba(116,151,181,0.24)",
    marginBottom: 22,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    color: "#111827",
    margin: "0 0 10px",
    letterSpacing: "-0.7px",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    color: "#6b7280",
    margin: "0 0 26px",
    textAlign: "center",
    maxWidth: 310,
    lineHeight: 1.55,
  },
  form: {
    width: "100%",
  },
  field: {
    marginBottom: 14,
  },
  input: {
    width: "100%",
    padding: "14px 16px",
    borderRadius: 14,
    border: "1px solid rgba(226,232,240,0.95)",
    fontSize: 14,
    color: "#0f172a",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.2s, box-shadow 0.2s",
    background: "rgba(244,247,250,0.96)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8)",
  },
  error: {
    color: "#ef4444",
    fontSize: 13,
    margin: "4px 0 12px",
    textAlign: "center",
  },
  btn: {
    width: "100%",
    padding: "14px",
    background: "linear-gradient(180deg, #2b2d39 0%, #171923 100%)",
    color: "#fff",
    border: "none",
    borderRadius: 14,
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 8,
    letterSpacing: "0.2px",
    boxShadow: "0 10px 18px rgba(23,25,35,0.22)",
  },
};
