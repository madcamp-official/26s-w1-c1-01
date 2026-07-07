"""
stay_scraper.py가 생성한 data/processed/stay_prices.csv를 읽어
Supabase(Postgres) stay_price_scrapes 테이블에 적재한다.

stay_price_scrapes는 flight_price_scrapes와 마찬가지로 "현재값 캐시"가 아니라
스크래핑 원본 로그 테이블이다(data/README.md 참고). checkin은 stay_scraper.py에서
항상 실행 시점의 다음날로 정해지므로, 같은 날 이 스크립트를 여러 번 돌려도 로그가
중복 쌓이지 않도록 (city_id, checkin) 기준 upsert로 처리한다 - 같은 날 재실행하면
그 행이 최신 결과로 갱신되고, 날짜가 바뀌면 새 로그 행으로 그대로 누적된다.

접속 문자열은 build_currencies.py와 동일하게 data-pipeline/.env의 SUPABASE_DB_URL을 쓴다.

city_id는 cities.city_id를 참조하는 FK라, cities 테이블에 없는 도시가 CSV에
있으면 upsert가 실패한다 - collectors/build_cities.py로 cities 시드가 먼저
채워져 있어야 한다.
"""

import csv
import os

import psycopg2
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, "../.env"))

INPUT_CSV = os.path.join(BASE_DIR, "../data/processed/stay_prices.csv")
DB_URL = os.environ.get("SUPABASE_DB_URL")

CREATE_TABLE_SQL = '''
    CREATE TABLE IF NOT EXISTS stay_price_scrapes (
        id           BIGSERIAL PRIMARY KEY,
        city_id      CHAR(3) NOT NULL REFERENCES cities(city_id),
        checkin      DATE NOT NULL,
        checkout     DATE NOT NULL,
        price        INTEGER,
        source_url   TEXT,
        scraped_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (city_id, checkin)
    )
'''
CREATE_INDEX_SQL = '''
    CREATE INDEX IF NOT EXISTS idx_stay_scrapes_city_time
    ON stay_price_scrapes (city_id, scraped_at DESC)
'''

UPSERT_SQL = '''
    INSERT INTO stay_price_scrapes (city_id, checkin, checkout, price, source_url, scraped_at)
    VALUES (%(city_id)s, %(checkin)s, %(checkout)s, %(price)s, %(source_url)s, now())
    ON CONFLICT (city_id, checkin) DO UPDATE SET
        checkout   = EXCLUDED.checkout,
        price      = EXCLUDED.price,
        source_url = EXCLUDED.source_url,
        scraped_at = EXCLUDED.scraped_at
'''


def load_rows(csv_path=INPUT_CSV):
    with open(csv_path, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    for row in rows:
        row["price"] = int(row["price"]) if row["price"] else None
        row["source_url"] = row["source_url"] or None

    return rows


def main():
    if not DB_URL:
        raise RuntimeError("SUPABASE_DB_URL이 설정되어 있지 않습니다. data-pipeline/.env를 확인하세요.")

    rows = load_rows()

    conn = psycopg2.connect(DB_URL)
    try:
        with conn.cursor() as cur:
            cur.execute(CREATE_TABLE_SQL)
            cur.execute(CREATE_INDEX_SQL)
            cur.executemany(UPSERT_SQL, rows)
        conn.commit()
    finally:
        conn.close()

    print(f"Supabase stay_price_scrapes 테이블 upsert 완료 ({len(rows)}행)")


if __name__ == "__main__":
    main()
