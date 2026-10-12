import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDfXHa6EBQalBPDRCLDnExBA7Mk-MHIBDM",
  authDomain: "deckbuilder-b5cd8.firebaseapp.com",
  projectId: "deckbuilder-b5cd8",
  storageBucket: "deckbuilder-b5cd8.firebasestorage.app",
  messagingSenderId: "157025460178",
  appId: "1:157025460178:web:fa5ac55d39194500ad720b"
};

export const firebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
export const firebaseDb = getFirestore(firebaseApp);

export async function ensureAnonymousAuth(){
  if (firebaseAuth.currentUser) return firebaseAuth.currentUser;
  const credential = await signInAnonymously(firebaseAuth);
  return credential.user;
}
