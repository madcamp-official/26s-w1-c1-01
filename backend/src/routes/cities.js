import { Router } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../db.js";
import { shouldSkip, runCityBatch } from "../services/cityBatchRunner.js";

const router = Router();

// 도시별 10분 쿨다운(cityBatchRunner)과 별개로, 서로 다른 cityId를 빠르게 순회 호출해
// 매번 실제 스크래핑 프로세스를 띄우는 남용을 막기 위한 IP 기준 전역 레이트리밋.
const updateRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too Many Requests" },
});

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT city_id, name_ko, name_en, country_id, lat, lng,
             meal_price, flight_price, stay_price, image_url, image_credit, updated_at
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
router.post("/:cityId/update", updateRateLimiter, async (req, res, next) => {
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
    imageUrl: row.image_url,
    imageCredit: row.image_credit,
    updatedAt: row.updated_at.toISOString(),
  };
}

export default router;
