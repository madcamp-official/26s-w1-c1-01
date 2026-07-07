import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        c.country_id,
        c.name_ko,
        c.name_en,
        c.center_lat,
        c.center_lng,
        c.alarm_level,
        c.special_advisory,
        c.currency_code,
        cur.exchange_rate,
        cur.unit
      FROM countries c
      LEFT JOIN currencies cur ON cur.currency_code = c.currency_code
      ORDER BY c.country_id
    `);

    res.json(rows.map(toCountryDto));
  } catch (err) {
    next(err);
  }
});

// currencies.exchange_rate는 unit(고시 단위, 예: JPY는 100) 기준 원화값이라
// 프론트 표시용으로는 1단위당 원화로 나눠서 내려준다.
function toCountryDto(row) {
  return {
    countryId: row.country_id,
    nameKo: row.name_ko,
    nameEn: row.name_en,
    center: {
      lat: Number(row.center_lat),
      lng: Number(row.center_lng),
    },
    alarmLevel: row.alarm_level,
    specialAdvisory: row.special_advisory,
    currencyCode: row.currency_code,
    exchangeRate:
      row.exchange_rate != null ? Number(row.exchange_rate) / row.unit : null,
    // bigMac: 빅맥지수 연동 스크래퍼/컬럼이 아직 없어 항상 null.
    bigMac: null,
  };
}

export default router;
