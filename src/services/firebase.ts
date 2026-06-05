import { initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { getFirestore, initializeFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyAnHWjR0gl4MMkjqd6a_ivFO5lxejjGstM",
  authDomain: "pwork-9bf30.firebaseapp.com",
  projectId: "pwork-9bf30",
  storageBucket: "pwork-9bf30.firebasestorage.app",
  messagingSenderId: "107579372980",
  appId: "1:107579372980:web:cf31183c90228923d3aee1",
  measurementId: "G-CLNYP6QNNY",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// 일부 네트워크/임베디드 브라우저에서 WebChannel 스트리밍이 막혀 요청이 멈추는 문제를 피하려고
// long-polling을 강제한다. (스트리밍 백채널이 ERR_ABORTED로 끊기는 환경 대응)
// try/catch는 Vite HMR로 모듈이 두 번 평가될 때 initializeFirestore 재호출 에러를 흡수한다.
function createDb() {
  try {
    return initializeFirestore(app, { experimentalForceLongPolling: true });
  } catch {
    return getFirestore(app);
  }
}
export const db = createDb();
export const storage = getStorage(app);

const provider = new GoogleAuthProvider();

export function signInWithGoogle() {
  return signInWithPopup(auth, provider);
}

export function signOutUser() {
  return signOut(auth);
}

export function watchAuth(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

/** 로그인 임시 비활성화 스위치. true면 로그인 화면을 건너뛰고 바로 앱을 보여준다. */
export const SKIP_LOGIN = false;

/** 로그인 비활성화 상태에서 데이터가 저장될 임시 UID. */
const LOCAL_DEV_UID = "local-dev";

/** 현재 로그인한 사용자 UID. 모든 저장소 경로의 최상위 키로 쓰여 데이터가 사용자별로 격리된다. */
export function requireUid() {
  const uid = auth.currentUser?.uid;
  if (uid) return uid;
  if (SKIP_LOGIN) return LOCAL_DEV_UID;
  throw new Error("로그인이 필요합니다.");
}
