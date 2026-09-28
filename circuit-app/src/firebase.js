import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBTWYksNjdEK4JZ3YcrxDwVLWIqrkQeY34",
  authDomain: "tt-joves-castelldefels-league.firebaseapp.com",
  projectId: "tt-joves-castelldefels-league",
  storageBucket: "tt-joves-castelldefels-league.firebasestorage.app",
  messagingSenderId: "116306251220",
  appId: "1:116306251220:web:36bc7b9e4cc26558f39a41",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
