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
    const adminUserSnap = await firestore.collection("users").doc(decoded.uid).get();
    const adminUser = adminUserSnap.data();

    if (!adminUserSnap.exists || adminUser?.role !== "admin" || adminUser?.status !== "active") {
      return sendJson(res, 403, { error: "Only active admins can update users." });
    }

    const { uid, role, status, allowedLeadIds } = req.body || {};
    if (!uid || !role || !status) {
      return sendJson(res, 400, { error: "Missing required update fields." });
    }

    const normalizedRole =
      role === "admin" ? "admin" : role === "restricted_user" ? "restricted_user" : "user";
    const normalizedStatus = status === "inactive" ? "inactive" : "active";
    const normalizedAllowedLeadIds =
      normalizedRole === "restricted_user" && Array.isArray(allowedLeadIds)
        ? Array.from(new Set(allowedLeadIds.map((value) => String(value).trim()).filter(Boolean)))
        : [];

    await auth.updateUser(String(uid), {
      disabled: normalizedStatus !== "active",
    });

    await firestore.collection("users").doc(String(uid)).update({
      role: normalizedRole,
      status: normalizedStatus,
      allowedLeadIds: normalizedAllowedLeadIds,
      updatedAt: new Date().toISOString(),
      updatedBy: adminUser.username || decoded.uid,
    });

    return sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error("update-user error:", error);
    const errorMessage =
      error?.message ||
      error?.errorInfo?.message ||
      (typeof error === "string" ? error : JSON.stringify(error));
    const errorCode = error?.code || error?.errorInfo?.code || "";
    return sendJson(res, 500, {
      error: errorCode ? `${errorMessage} (${errorCode})` : errorMessage || "Failed to update user.",
    });
  }
}
