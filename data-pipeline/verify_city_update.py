"""
POST /cities/:cityId/update 요청 후 main_batch.run_for_city(city_id)가 실제로
Supabase(cities.flight_price/stay_price, countries.alarm_level/special_advisory)에
반영했는지 확인하는 조회 전용 스크립트(쓰기 없음).

사용법: python3 verify_city_update.py <city_id>
"""

import os
import sys

import psycopg2
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))
DB_URL = os.environ.get("SUPABASE_DB_URL")


def fetch_city_state(city_id):
    conn = psycopg2.connect(DB_URL)
    try:
        with conn.cursor() as cur:
            cur.execute('''
                SELECT city_id, name_ko, country_id, flight_price, stay_price, updated_at
                FROM cities WHERE city_id = %s
            ''', (city_id,))
            city = cur.fetchone()
            if not city:
                return None, None

            cur.execute('''
                SELECT country_id, alarm_level, special_advisory, updated_at
                FROM countries WHERE country_id = %s
            ''', (city[2],))
            country = cur.fetchone()
    finally:
        conn.close()

    return city, country


def main():
    if len(sys.argv) != 2:
        raise SystemExit("사용법: python3 verify_city_update.py <city_id>")
    if not DB_URL:
        raise RuntimeError("SUPABASE_DB_URL이 설정되어 있지 않습니다. data-pipeline/.env를 확인하세요.")

    city_id = sys.argv[1]
    city, country = fetch_city_state(city_id)
    if city is None:
        print(f"cities에 {city_id}가 없습니다.")
        return

    print(f"[cities] {city[0]} ({city[1]}) flight_price={city[3]} stay_price={city[4]} updated_at={city[5]}")
    if country:
        print(
            f"[countries] {country[0]} alarm_level={country[1]} "
            f"special_advisory={country[2]} updated_at={country[3]}"
        )


if __name__ == "__main__":
    main()
