import admin from "firebase-admin";
import fs from "node:fs";
import { Buffer } from "node:buffer";

let adminInitMetadata = {
  source: "unknown",
  projectId: "",
  clientEmail: "",
  keyId: "",
};

function normalizeQuotedValue(rawValue) {
  if (!rawValue) return "";
  let value = String(rawValue).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

function normalizePrivateKey(rawValue) {
  if (!rawValue) return "";
  const key = normalizeQuotedValue(rawValue);

  return key.replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
}

function parseServiceAccountFromEnv() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing Firebase Admin env vars. Check FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.");
  }

  if (!privateKey.includes("BEGIN PRIVATE KEY") || !privateKey.includes("END PRIVATE KEY")) {
    throw new Error("FIREBASE_PRIVATE_KEY is not a valid PEM key. Ensure full key is present with BEGIN/END markers.");
  }

  return {
    projectId,
    clientEmail,
    privateKey,
  };
}

function parseServiceAccountFromJsonEnv() {
  const rawJson = normalizeQuotedValue(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const rawBase64 = normalizeQuotedValue(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64);

  let parsed;
  if (rawJson) {
    parsed = JSON.parse(rawJson);
  } else if (rawBase64) {
    const decoded = Buffer.from(rawBase64, "base64").toString("utf8");
    parsed = JSON.parse(decoded);
  } else {
    return null;
  }

  if (!parsed?.project_id || !parsed?.client_email || !parsed?.private_key) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON(_BASE64) is missing project_id/client_email/private_key."
    );
  }

  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
  };
}

export function getAdminApp() {
  if (admin.apps.length) return admin.app();

  // Prefer explicit local service-account file when configured.
  // Using cert(...) directly avoids ADC ambiguity during local testing.
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const credentialsPath = normalizeQuotedValue(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    if (!credentialsPath) {
      throw new Error("GOOGLE_APPLICATION_CREDENTIALS is set but empty.");
    }
    if (!fs.existsSync(credentialsPath)) {
      throw new Error(`GOOGLE_APPLICATION_CREDENTIALS file not found at: ${credentialsPath}`);
    }
    const raw = fs.readFileSync(credentialsPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed?.project_id || !parsed?.client_email || !parsed?.private_key) {
      throw new Error("Service account JSON is missing project_id/client_email/private_key.");
    }

    adminInitMetadata = {
      source: "google_application_credentials",
      projectId: parsed.project_id || "",
      clientEmail: parsed.client_email || "",
      keyId: parsed.private_key_id || "",
    };

    console.log("[firebase-admin] init via GOOGLE_APPLICATION_CREDENTIALS", {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      keyId: parsed.private_key_id,
    });

    return admin.initializeApp({
      credential: admin.credential.cert({
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key,
      }),
    });
  }

  try {
    const jsonServiceAccount = parseServiceAccountFromJsonEnv();
    if (jsonServiceAccount) {
      adminInitMetadata = {
        source: "firebase_service_account_json",
        projectId: jsonServiceAccount.projectId,
        clientEmail: jsonServiceAccount.clientEmail,
        keyId: "",
      };
      console.log("[firebase-admin] init via FIREBASE_SERVICE_ACCOUNT_JSON(_BASE64)", {
        projectId: jsonServiceAccount.projectId,
        clientEmail: jsonServiceAccount.clientEmail,
      });
      return admin.initializeApp({
        credential: admin.credential.cert(jsonServiceAccount),
      });
    }

    const serviceAccount = parseServiceAccountFromEnv();
    adminInitMetadata = {
      source: "firebase_split_env",
      projectId: serviceAccount.projectId,
      clientEmail: serviceAccount.clientEmail,
      keyId: "",
    };
    console.log("[firebase-admin] init via FIREBASE_* env", {
      projectId: serviceAccount.projectId,
      clientEmail: serviceAccount.clientEmail,
    });
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (envError) {
    throw envError;
  }
}

export function getAdminInitMetadata() {
  return adminInitMetadata;
}
