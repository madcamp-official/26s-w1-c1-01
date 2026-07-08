import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL이 설정되어 있지 않습니다. backend/.env를 확인하세요.");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// idle 커넥션에서 발생하는 백그라운드 에러(DB 재시작, 네트워크 단절 등)를 처리하지
// 않으면 uncaught exception으로 취급되어 프로세스가 죽는다(node-postgres 공식 문서 경고).
pool.on("error", (err) => {
  console.error("Unexpected idle client error on pg pool", err);
});
