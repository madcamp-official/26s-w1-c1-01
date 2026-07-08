"""
flight_price_scrapes / stay_price_scrapes 로그 테이블에서 도시별 최신(성공) 스크랩 가격을
뽑아 cities.flight_price / cities.stay_price 캐시 컬럼에 반영한다.

- 도시별로 price가 NULL이 아닌 로그 중 scraped_at이 가장 최신인 1건을 캐시 값으로 쓴다.
  실패 로그(price NULL)는 성공률 추적용으로 로그 테이블에는 남겨두되, 캐시 갱신에서는
  건너뛴다 - 하루 스크래핑이 일시적으로 실패했다고 해서 이미 알고 있는 최저가를
  NULL로 덮어쓰지 않기 위함.
- 로그 자체가 없거나 전부 실패(price NULL)인 도시는 건드리지 않는다(NULL 유지).

접속 문자열은 다른 collectors와 동일하게 data-pipeline/.env의 SUPABASE_DB_URL을 쓴다.
"""

import os

import psycopg2
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, "../.env"))

DB_URL = os.environ.get("SUPABASE_DB_URL")

SYNC_FLIGHT_PRICE_SQL = '''
    UPDATE cities c
    SET flight_price = latest.price,
        updated_at = now()
    FROM (
        SELECT DISTINCT ON (city_id) city_id, price
        FROM flight_price_scrapes
        WHERE price IS NOT NULL
        ORDER BY city_id, scraped_at DESC
    ) latest
    WHERE c.city_id = latest.city_id
      AND c.flight_price IS DISTINCT FROM latest.price
      AND (%(city_id)s IS NULL OR c.city_id = %(city_id)s)
'''

SYNC_STAY_PRICE_SQL = '''
    UPDATE cities c
    SET stay_price = latest.price,
        updated_at = now()
    FROM (
        SELECT DISTINCT ON (city_id) city_id, price
        FROM stay_price_scrapes
        WHERE price IS NOT NULL
        ORDER BY city_id, scraped_at DESC
    ) latest
    WHERE c.city_id = latest.city_id
      AND c.stay_price IS DISTINCT FROM latest.price
      AND (%(city_id)s IS NULL OR c.city_id = %(city_id)s)
'''


def main(city_id=None):
    """city_id를 주면 해당 도시의 캐시만 동기화한다."""
    if not DB_URL:
        raise RuntimeError("SUPABASE_DB_URL이 설정되어 있지 않습니다. data-pipeline/.env를 확인하세요.")

    conn = psycopg2.connect(DB_URL)
    try:
        with conn.cursor() as cur:
            cur.execute(SYNC_FLIGHT_PRICE_SQL, {"city_id": city_id})
            flight_updated = cur.rowcount
            cur.execute(SYNC_STAY_PRICE_SQL, {"city_id": city_id})
            stay_updated = cur.rowcount
        conn.commit()
    finally:
        conn.close()

    print(f"cities.flight_price 갱신: {flight_updated}행")
    print(f"cities.stay_price 갱신: {stay_updated}행")


if __name__ == "__main__":
    main()
