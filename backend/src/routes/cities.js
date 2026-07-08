import { spawn } from "node:child_process";
import path from "node:path";
import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const DATA_PIPELINE_DIR =
  process.env.DATA_PIPELINE_DIR || path.resolve(process.cwd(), "../data-pipeline");
// 같은 도시를 짧은 시간에 여러 번 요청해도 재계산은 스킵한다(외부 항공권/숙박 스크래핑은
// 비용/레이트리밋이 있는 호출이라 폭주를 막아야 함).
const UPDATE_COOLDOWN_MS = 10 * 60 * 1000;

// cityId -> { status: "running" | "done", updatedAt: number }
// 서버 프로세스 하나 안에서만 유효한 디바운스/락이라, 인스턴스를 여러 개 띄우면
// 이 상태는 인스턴스별로 따로 논다(지금 규모에서는 충분).
const cityUpdateState = new Map();

function shouldSkip(cityId) {
  const state = cityUpdateState.get(cityId);
  if (!state) return false;
  if (state.status === "running") return true;
  return Date.now() - state.updatedAt < UPDATE_COOLDOWN_MS;
}

function runCityBatch(cityId) {
  cityUpdateState.set(cityId, { status: "running", updatedAt: Date.now() });

  const child = spawn(PYTHON_BIN, ["main_batch.py", cityId], {
    cwd: DATA_PIPELINE_DIR,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => console.log(`[batch:${cityId}] ${chunk}`.trimEnd()));
  child.stderr.on("data", (chunk) => console.error(`[batch:${cityId}] ${chunk}`.trimEnd()));

  child.on("close", (code) => {
    cityUpdateState.set(cityId, { status: "done", updatedAt: Date.now() });
    if (code !== 0) {
      console.error(`[batch:${cityId}] main_batch.py 종료 코드 ${code}`);
    } else {
      console.log(`[batch:${cityId}] 갱신 완료`);
    }
  });

  child.on("error", (err) => {
    cityUpdateState.set(cityId, { status: "done", updatedAt: Date.now() });
    console.error(`[batch:${cityId}] 실행 실패`, err);
  });
}

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT city_id, name_ko, name_en, country_id, lat, lng,
             meal_price, flight_price, stay_price, updated_at
      FROM cities
      ORDER BY city_id
    `);

    res.json(rows.map(toCityDto));
  } catch (err) {
    next(err);
  }
});

// 프런트는 이 응답의 status/body를 읽지 않는 fire-and-forget 요청이라, 계약은
// "받았다(202)"만 보장하면 된다. 실제 스크래핑/DB 반영은 main_batch.py 자식 프로세스가
// 백그라운드에서 처리하고, 끝나면 그 결과가 다음 GET /cities 응답에 그대로 반영된다.
router.post("/:cityId/update", async (req, res, next) => {
  try {
    const { cityId } = req.params;

    const { rows } = await pool.query("SELECT 1 FROM cities WHERE city_id = $1", [cityId]);
    if (rows.length === 0) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    if (shouldSkip(cityId)) {
      res.status(202).json({ accepted: true, cityId, skipped: true });
      return;
    }

    runCityBatch(cityId);
    res.status(202).json({ accepted: true, cityId });
  } catch (err) {
    next(err);
  }
});

// cityId는 IATA 코드를 그대로 재사용하므로 iata는 city_id를 복사해서 내려준다.
function toCityDto(row) {
  return {
    cityId: row.city_id,
    nameKo: row.name_ko,
    nameEn: row.name_en,
    countryId: row.country_id,
    iata: row.city_id,
    lat: Number(row.lat),
    lng: Number(row.lng),
    mealPrice: row.meal_price,
    flightPrice: row.flight_price,
    stayPrice: row.stay_price,
    updatedAt: row.updated_at.toISOString(),
  };
}

export default router;
