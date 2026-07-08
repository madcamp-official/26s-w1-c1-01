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
        c.big_mac_price,
        c.image_url,
        c.image_credit,
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
    exchangeRate: row.exchange_rate != null ? Number(row.exchange_rate) : null,
    unit: row.unit != null ? Number(row.unit) : null,
    bigMac: row.big_mac_price != null ? Number(row.big_mac_price) : null,
    imageUrl: row.image_url,
    imageCredit: row.image_credit,
  };
}

export default router;
