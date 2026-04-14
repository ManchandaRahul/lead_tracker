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
    try {
      await auth.getUser(decoded.uid);
      console.log("[create-user] auth.getUser precheck passed for", decoded.uid);
    } catch (precheckError) {
      console.error("[create-user] auth.getUser precheck failed:", precheckError);
      throw precheckError;
    }

    const adminUserSnap = await firestore.collection("users").doc(decoded.uid).get();
    const adminUser = adminUserSnap.data();

    if (!adminUserSnap.exists || adminUser?.role !== "admin" || adminUser?.status !== "active") {
      return sendJson(res, 403, { error: "Only active admins can create users." });
    }

    const {
      username,
      email,
      displayName,
      role,
      status,
      temporaryPassword,
      createdBy,
    } = req.body || {};

    if (!username || !email || !displayName || !role || !status || !temporaryPassword) {
      return sendJson(res, 400, { error: "Missing required user fields." });
    }

    const normalizedUsername = String(username).trim();
    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedDisplayName = String(displayName).trim();
    const normalizedRole = role === "admin" ? "admin" : "user";
    const normalizedStatus = status === "inactive" ? "inactive" : "active";

    const existingUsernameSnap = await firestore
      .collection("users")
      .where("username", "==", normalizedUsername)
      .limit(1)
      .get();

    if (!existingUsernameSnap.empty) {
      return sendJson(res, 409, { error: "A user with this username already exists." });
    }

    let createdUser;
    try {
      createdUser = await auth.createUser({
        email: normalizedEmail,
        password: String(temporaryPassword),
        displayName: normalizedDisplayName,
        disabled: normalizedStatus !== "active",
      });
    } catch (error) {
      if (error?.code === "auth/email-already-exists") {
        return sendJson(res, 409, { error: "A Firebase Authentication user with this email already exists." });
      }
      throw error;
    }

    const now = new Date().toISOString();
    await firestore.collection("users").doc(createdUser.uid).set({
      uid: createdUser.uid,
      username: normalizedUsername,
      email: normalizedEmail,
      displayName: normalizedDisplayName,
      role: normalizedRole,
      status: normalizedStatus,
      createdAt: now,
      updatedAt: now,
      createdBy: createdBy || adminUser.username || decoded.uid,
    });

    return sendJson(res, 200, { ok: true, uid: createdUser.uid });
  } catch (error) {
    console.error("create-user error:", error);
    return sendJson(res, 500, {
      error: error?.message || "Failed to create user.",
    });
  }
}
