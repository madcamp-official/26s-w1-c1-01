"""
flight_scraper.py가 생성한 data/processed/flight_prices.csv를 읽어
Supabase(Postgres) flight_price_scrapes 테이블에 적재한다.

flight_price_scrapes는 currencies처럼 "현재값 캐시"가 아니라 스크래핑 원본 로그
테이블이다(data/README.md 참고). 다만 flight_prices.csv 자체가 실행할 때마다
새 스크랩 로그를 append하는 구조라, 이 빌드 스크립트를 여러 번 돌려도 같은 날 로그가
중복 적재되지 않도록 (city_id, scrape_date) 기준 upsert로 처리한다 - 같은 날 재실행하면
그날 행이 최신 결과로 갱신되고, 날짜가 바뀌면 새 로그 행으로 그대로 누적된다.

접속 문자열은 build_currencies.py와 동일하게 data-pipeline/.env의 SUPABASE_DB_URL을 쓴다.

city_id는 cities.city_id를 참조하는 FK라, cities 테이블에 없는 목적지가 CSV에
있으면 upsert가 실패한다 - collectors/build_countries.py 등으로 cities 시드가
먼저 채워져 있어야 한다.
"""

import csv
import os

import psycopg2
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, "../.env"))

INPUT_CSV = os.path.join(BASE_DIR, "../data/processed/flight_prices.csv")
DB_URL = os.environ.get("SUPABASE_DB_URL")

CREATE_TABLE_SQL = '''
    CREATE TABLE IF NOT EXISTS flight_price_scrapes (
        id          BIGSERIAL PRIMARY KEY,
        city_id     CHAR(3) NOT NULL REFERENCES cities(city_id),
        scrape_date DATE NOT NULL,
        depart_date DATE NOT NULL,
        return_date DATE NOT NULL,
        price       INTEGER,
        airline     VARCHAR(255),
        source_url  TEXT,
        scraped_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (city_id, scrape_date)
    )
'''
# airline은 왕복 구간에서 항공사가 갈리면 "A항공, B항공"처럼 콤마로 합쳐 저장하므로
# README DDL의 VARCHAR(100)보다 여유 있게 잡는다.

CREATE_INDEX_SQL = '''
    CREATE INDEX IF NOT EXISTS idx_flight_scrapes_city_time
    ON flight_price_scrapes (city_id, scraped_at DESC)
'''

UPSERT_SQL = '''
    INSERT INTO flight_price_scrapes
        (city_id, scrape_date, depart_date, return_date, price, airline, source_url, scraped_at)
    VALUES
        (%(city_id)s, %(scrape_date)s, %(depart_date)s, %(return_date)s,
         %(price)s, %(airline)s, %(source_url)s, now())
    ON CONFLICT (city_id, scrape_date) DO UPDATE SET
        depart_date = EXCLUDED.depart_date,
        return_date = EXCLUDED.return_date,
        price       = EXCLUDED.price,
        airline     = EXCLUDED.airline,
        source_url  = EXCLUDED.source_url,
        scraped_at  = EXCLUDED.scraped_at
'''


def load_rows(csv_path=INPUT_CSV, city_id=None):
    with open(csv_path, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    if city_id:
        rows = [row for row in rows if row["city_id"] == city_id]

    for row in rows:
        row["price"] = int(row["price"]) if row["price"] else None
        row["airline"] = row["airline"] or None
        row["source_url"] = row["source_url"] or None

    return rows


def main(city_id=None):
    """city_id를 주면 CSV에서 해당 도시 로그만 upsert한다."""
    if not DB_URL:
        raise RuntimeError("SUPABASE_DB_URL이 설정되어 있지 않습니다. data-pipeline/.env를 확인하세요.")

    rows = load_rows(city_id=city_id)

    conn = psycopg2.connect(DB_URL)
    try:
        with conn.cursor() as cur:
            cur.execute(CREATE_TABLE_SQL)
            cur.execute(CREATE_INDEX_SQL)
            cur.executemany(UPSERT_SQL, rows)
        conn.commit()
    finally:
        conn.close()

    print(f"Supabase flight_price_scrapes 테이블 upsert 완료 ({len(rows)}행)")


if __name__ == "__main__":
    main()
