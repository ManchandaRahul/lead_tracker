import admin from "firebase-admin";
import { getAdminApp } from "./_firebaseAdmin.js";

function sendJson(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    const app = getAdminApp();
    const auth = admin.auth(app);
    const firestore = admin.firestore(app);

    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!idToken) return sendJson(res, 401, { error: "Missing authorization token." });

    const decoded = await auth.verifyIdToken(idToken);
    const requesterSnap = await firestore.collection("users").doc(decoded.uid).get();
    const requester = requesterSnap.data();

    if (!requesterSnap.exists || requester?.status !== "active") {
      return sendJson(res, 403, { error: "Only active users can change passwords." });
    }

    const { uid, newPassword } = req.body || {};
    if (!uid || !newPassword) {
      return sendJson(res, 400, { error: "Missing required password fields." });
    }

    if (String(newPassword).length < 6) {
      return sendJson(res, 400, { error: "Password must be at least 6 characters long." });
    }

    const isSelfChange = String(uid) === decoded.uid;
    const isRootPasswordAdmin =
      requester?.role === "admin" &&
      requester?.username === "admin" &&
      requester?.email === "admin@leadtracker.app";

    if (!isSelfChange && !isRootPasswordAdmin) {
      return sendJson(res, 403, {
        error: "Only the primary admin account can change other users' passwords.",
      });
    }

    const targetUserSnap = await firestore.collection("users").doc(String(uid)).get();
    if (!targetUserSnap.exists) {
      return sendJson(res, 404, { error: "Target user not found." });
    }

    await auth.updateUser(String(uid), {
      password: String(newPassword),
    });

    const now = new Date().toISOString();
    await firestore.collection("users").doc(String(uid)).update({
      updatedAt: now,
      updatedBy: requester?.username || decoded.uid,
      passwordChangedAt: now,
      passwordChangedBy: requester?.username || decoded.uid,
    });

    return sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error("change-password error:", error);
    return sendJson(res, 500, {
      error: error?.message || "Failed to change password.",
    });
  }
}
