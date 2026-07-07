import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL이 설정되어 있지 않습니다. backend/.env를 확인하세요.");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
