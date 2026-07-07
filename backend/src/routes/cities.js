import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

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
