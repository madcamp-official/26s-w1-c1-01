"""
exchange_scrapers.py가 생성한 data/processed/exchange.csv를 읽어
Supabase(Postgres) currencies 테이블을 생성/갱신한다.

접속 문자열은 Supabase 프로젝트 > Project Settings > Database > Connection string
에서 받아 data-pipeline/.env의 SUPABASE_DB_URL에 넣는다. DB 자격 증명이므로
저장소에는 절대 커밋하지 않는다(.env는 .gitignore 처리됨).

테이블 스키마는 data-pipeline/data/README.md의 currencies 정의를 따른다:
currency_code(PK), currency_name, unit, exchange_rate, base_date, updated_at
"""

import csv
import os
from datetime import datetime

import psycopg2
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, "../.env"))

INPUT_CSV = os.path.join(BASE_DIR, "../data/processed/exchange.csv")
DB_URL = os.environ.get("SUPABASE_DB_URL")

CREATE_TABLE_SQL = '''
    CREATE TABLE IF NOT EXISTS currencies (
        currency_code CHAR(3) PRIMARY KEY,
        currency_name VARCHAR(50) NOT NULL,
        unit INTEGER NOT NULL DEFAULT 1,
        exchange_rate NUMERIC(14,4) NOT NULL,
        base_date DATE NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
'''

UPSERT_SQL = '''
    INSERT INTO currencies (currency_code, currency_name, unit, exchange_rate, base_date, updated_at)
    VALUES (%(currencyCode)s, %(currencyName)s, %(unit)s, %(exchangeRate)s, %(baseDate)s, now())
    ON CONFLICT (currency_code) DO UPDATE SET
        currency_name = EXCLUDED.currency_name,
        unit          = EXCLUDED.unit,
        exchange_rate = EXCLUDED.exchange_rate,
        base_date     = EXCLUDED.base_date,
        updated_at    = EXCLUDED.updated_at
'''


def load_rows(csv_path=INPUT_CSV):
    with open(csv_path, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    for row in rows:
        row["unit"] = int(row["unit"])
        row["exchangeRate"] = float(row["exchangeRate"])
        row["baseDate"] = datetime.strptime(row["baseDate"], "%Y%m%d").date().isoformat()

    return rows


def main():
    if not DB_URL:
        raise RuntimeError("SUPABASE_DB_URL이 설정되어 있지 않습니다. data-pipeline/.env를 확인하세요.")

    rows = load_rows()

    conn = psycopg2.connect(DB_URL)
    try:
        with conn.cursor() as cur:
            cur.execute(CREATE_TABLE_SQL)
            cur.executemany(UPSERT_SQL, rows)
        conn.commit()
    finally:
        conn.close()

    print(f"Supabase currencies 테이블 upsert 완료 ({len(rows)}개 통화)")


if __name__ == "__main__":
    main()
