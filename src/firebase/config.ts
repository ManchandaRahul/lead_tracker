import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// 🔧 Fill in your Firebase project details below
const firebaseConfig = {
  apiKey: "AIzaSyBs26tInQ4zTCqeOKl5kmKYJBE-kQF1dqM",
  authDomain: "lead-tracker-eca30.firebaseapp.com",
  projectId: "lead-tracker-eca30",
  storageBucket: "lead-tracker-eca30.firebasestorage.app",
  messagingSenderId: "558086386596",
  appId: "1:558086386596:web:d8533e668df609401d8731"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);