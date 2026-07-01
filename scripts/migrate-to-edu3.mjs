/**
 * 1회용 마이그레이션: 모든 users/{uid}의 워크스페이스 데이터를 공유 카테고리(기본 "edu3")로 복사하고
 * 각 사용자 프로필에 category를 기록한다.
 *
 * 안전 원칙:
 *  - 원본(users/...)은 절대 삭제하지 않는다(백업 보존).
 *  - dest 문서 id는 소스에서 결정적으로 생성하므로 재실행해도 덮어쓰기만 됨(멱등, 중복 생성 없음).
 *  - 사용자에게 per-user workspaces가 있으면 그것만 옮기고 flat 데이터는 건너뛴다
 *    (직전 버전의 per-user 마이그레이션이 flat→workspaces/default로 이미 접었을 수 있어 중복 방지).
 *
 * 실행:
 *   1) Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → "새 비공개 키 생성"으로 JSON 키 발급
 *   2) 키를 이 레포 루트에 serviceAccountKey.json 로 저장 (또는 GOOGLE_APPLICATION_CREDENTIALS 환경변수)
 *   3) npm i -D firebase-admin
 *   4) 먼저 점검:   DRY_RUN=1 node scripts/migrate-to-edu3.mjs
 *      실제 실행:   node scripts/migrate-to-edu3.mjs
 *
 * 옵션 환경변수: CATEGORY(기본 edu3), STORAGE_BUCKET(기본 pwork-9bf30.firebasestorage.app), DRY_RUN=1
 */
import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getAuth } from "firebase-admin/auth";

const CATEGORY = process.env.CATEGORY || "edu3";
const BUCKET = process.env.STORAGE_BUCKET || "pwork-9bf30.firebasestorage.app";
const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || "./serviceAccountKey.json";

const DATA_COLLECTIONS = [
  "fieldRows",
  "valueColumns",
  "pdfSlotRows",
  "pdfAreas",
  "columnPdfAdjusts",
  "settings",
];

if (existsSync(KEY_PATH)) {
  initializeApp({ credential: cert(JSON.parse(readFileSync(KEY_PATH, "utf8"))), storageBucket: BUCKET });
  console.log(`[init] service account key: ${KEY_PATH}`);
} else {
  initializeApp({ credential: applicationDefault(), storageBucket: BUCKET });
  console.log("[init] application default credentials");
}

const db = getFirestore();
const bucket = getStorage().bucket();
const auth = getAuth();

async function emailFor(uid) {
  try {
    return (await auth.getUser(uid)).email ?? null;
  } catch {
    return null;
  }
}

async function copyStorage(srcPath, destPath) {
  const srcFile = bucket.file(srcPath);
  const [exists] = await srcFile.exists();
  if (!exists) return false;
  if (DRY_RUN) {
    console.log(`     [dry] storage ${srcPath} -> ${destPath}`);
    return true;
  }
  await srcFile.copy(bucket.file(destPath));
  return true;
}

/**
 * 하나의 소스 워크스페이스(=6개 하위 컬렉션을 가진 DocumentReference)를 edu3로 복사한다.
 * 셀 이미지/PDF/폰트 파일도 복사하고 valueColumns의 storagePath를 새 위치로 재작성한다.
 */
async function migrateWorkspace({ sourceWsRef, sourceStoragePrefix, destWsId, name, createdAt }) {
  const destWsRef = db.collection("categories").doc(CATEGORY).collection("workspaces").doc(destWsId);
  const destPrefix = `categories/${CATEGORY}/workspaces/${destWsId}`;
  console.log(`   -> "${name}"  =>  ${destWsId}`);

  for (const cname of DATA_COLLECTIONS) {
    const snap = await sourceWsRef.collection(cname).get();

    for (const d of snap.docs) {
      let data = d.data();

      if (cname === "valueColumns" && data.images) {
        const nextImages = {};
        for (const [rowId, image] of Object.entries(data.images)) {
          const srcImgPath = image.storagePath || `${sourceStoragePrefix}/images/${d.id}/${rowId}`;
          const destImgPath = `${destPrefix}/images/${d.id}/${rowId}`;
          const ok = await copyStorage(srcImgPath, destImgPath);
          nextImages[rowId] = { ...image, storagePath: ok ? destImgPath : srcImgPath };
        }
        data = { ...data, images: nextImages };
      }

      if (DRY_RUN) console.log(`     [dry] ${cname}/${d.id}`);
      else await destWsRef.collection(cname).doc(d.id).set(data);
    }

    if (cname === "pdfSlotRows") {
      for (const d of snap.docs) {
        const row = d.data();
        if (row.pdf) await copyStorage(`${sourceStoragePrefix}/pdfs/${d.id}`, `${destPrefix}/pdfs/${d.id}`);
      }
    }
    if (cname === "settings" && snap.docs.some((d) => d.id === "active-font")) {
      await copyStorage(`${sourceStoragePrefix}/font/active-font`, `${destPrefix}/font/active-font`);
    }
  }

  if (!DRY_RUN) {
    await destWsRef.set(
      { id: destWsId, name, createdAt: createdAt ?? Date.now(), updatedAt: Date.now() },
      { merge: true },
    );
  }
}

async function hasFlatData(userRef) {
  for (const c of ["fieldRows", "valueColumns", "pdfSlotRows"]) {
    const s = await userRef.collection(c).limit(1).get();
    if (!s.empty) return true;
  }
  return false;
}

async function migrateUser(userRef) {
  const uid = userRef.id;
  const email = await emailFor(uid);
  const local = email ? email.split("@")[0] : uid;
  console.log(`[user] ${uid} (${email ?? "no-email"})`);

  const wsSnap = await userRef.collection("workspaces").get();
  let migratedAny = false;

  if (!wsSnap.empty) {
    // per-user 워크스페이스가 있으면 그것만 옮긴다(flat은 이미 접혔을 수 있어 건너뜀).
    for (const wsDoc of wsSnap.docs) {
      const meta = wsDoc.data();
      await migrateWorkspace({
        sourceWsRef: wsDoc.ref,
        sourceStoragePrefix: `users/${uid}/workspaces/${wsDoc.id}`,
        destWsId: `${uid}-${wsDoc.id}`,
        name: meta?.name ? `${meta.name} (${local})` : `${local} 작업 공간`,
        createdAt: meta?.createdAt,
      });
      migratedAny = true;
    }
  } else if (await hasFlatData(userRef)) {
    // per-user가 없으면 flat 데이터를 하나의 워크스페이스로 옮긴다.
    await migrateWorkspace({
      sourceWsRef: userRef,
      sourceStoragePrefix: `users/${uid}`,
      destWsId: `${uid}-flat`,
      name: `${local} 작업 공간`,
    });
    migratedAny = true;
  }

  if (!DRY_RUN) {
    await db
      .collection("userProfiles")
      .doc(uid)
      .set({ uid, email: email ?? null, category: CATEGORY, createdAt: Date.now() }, { merge: true });
  }
  console.log(`   profile.category=${CATEGORY}${migratedAny ? "" : "  (옮길 워크스페이스 없음)"}`);
}

async function main() {
  console.log(`=== migrate to category "${CATEGORY}"  (DRY_RUN=${DRY_RUN}, bucket=${BUCKET}) ===`);
  const userRefs = await db.collection("users").listDocuments();
  console.log(`found ${userRefs.length} user(s)\n`);
  for (const ref of userRefs) {
    try {
      await migrateUser(ref);
    } catch (error) {
      console.error(`[user ${ref.id}] FAILED:`, error);
    }
  }
  console.log("\n=== done ===");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
