"""
스크래핑 없이 정적 원본(data/raw/big-mac-full-index.csv, The Economist Big Mac Index)을
가공해 countries.big_mac_price(KRW)를 채운다.

- 원본은 국가(iso_a3)별 시계열이라 국가마다 가장 최근 date 한 행만 쓴다.
- local_price 대신 dollar_price(빅맥 1개의 USD 환산가)를 쓴다: local_price는 국가마다
  자국 통화 그대로라 자릿수가 제각각인데, dollar_price는 원본에서 이미 모든 국가가
  USD로 정규화돼 있어 동일한 환산식(dollar_price * USD/KRW)을 일괄 적용할 수 있다.
  USD/KRW 환율은 CSV를 새로 받지 않고 currencies 테이블의 최신 값을 그대로 쓴다.
- 원본에 유로존은 개별 국가(DEU/FRA/...)가 아니라 EUZ(유로존 평균) 한 행만 있어,
  countries.currency_code = 'EUR'인 국가 전체에 EUZ 값을 적용한다.
- iso_a3 -> country_id(alpha-2) 매핑은 build_travel_alarm.py와 동일하게 외교부
  국가/지역별 표준코드의 ISO(3자리) 컬럼을 쓴다.
- DB에 이미 있는 country_id만 대상으로 하고(INSERT 없음), 원본에 매칭되는 데이터가
  없는 국가는 big_mac_price를 NULL로 명시적으로 덮어써 이전 값이 남지 않게 한다.

접속 문자열은 다른 collectors와 동일하게 data-pipeline/.env의 SUPABASE_DB_URL을 쓴다.
"""

import os
import sys

import pandas as pd
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SCRAPERS_DIR = os.path.join(BASE_DIR, "../scrapers")
sys.path.insert(0, SCRAPERS_DIR)
from _db import get_connection  # noqa: E402

load_dotenv(os.path.join(BASE_DIR, "../.env"))

BIG_MAC_CSV = os.path.join(BASE_DIR, "../data/raw/big-mac-full-index.csv")
MOFA_CSV = os.path.join(BASE_DIR, "../data/raw/외교부_국가_지역별 표준코드_20240716.csv")
DB_URL = os.environ.get("SUPABASE_DB_URL")

EUROZONE_ISO3 = "EUZ"

UPDATE_SQL = '''
    UPDATE countries
    SET big_mac_price = %(big_mac_price)s,
        updated_at = now()
    WHERE country_id = %(country_id)s
      AND big_mac_price IS DISTINCT FROM %(big_mac_price)s
'''


def load_iso3_to_country_id():
    mofa = pd.read_csv(MOFA_CSV, encoding="utf-16", sep="\t")
    mofa = mofa.rename(columns={
        "ISO(2자리)": "country_id",
        "ISO(3자리)": "iso3",
    })[["country_id", "iso3"]].dropna()
    return dict(zip(mofa["iso3"], mofa["country_id"]))


def load_latest_dollar_price_by_iso3():
    """iso_a3별 가장 최근 date 한 행만 남긴 Series(index=iso_a3, value=dollar_price)."""
    df = pd.read_csv(BIG_MAC_CSV, usecols=["date", "iso_a3", "dollar_price"])
    df["date"] = pd.to_datetime(df["date"])
    latest_idx = df.groupby("iso_a3")["date"].idxmax()
    return df.loc[latest_idx].set_index("iso_a3")["dollar_price"]


def get_usd_krw_rate(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT exchange_rate, unit FROM currencies WHERE currency_code = 'USD'")
        row = cur.fetchone()
    if not row:
        raise RuntimeError("currencies 테이블에 USD 환율이 없습니다. build_currencies.py를 먼저 실행하세요.")
    exchange_rate, unit = row
    return float(exchange_rate) / unit


def get_existing_countries(conn):
    """country_id -> currency_code. DB에 이미 있는 국가만 갱신 대상으로 삼는다."""
    with conn.cursor() as cur:
        cur.execute("SELECT country_id, currency_code FROM countries")
        rows = cur.fetchall()
    return dict(rows)


def build_rows(conn):
    usd_krw_rate = get_usd_krw_rate(conn)
    dollar_price_by_iso3 = load_latest_dollar_price_by_iso3()
    country_id_to_iso3 = {v: k for k, v in load_iso3_to_country_id().items()}
    existing_countries = get_existing_countries(conn)
    eurozone_dollar_price = dollar_price_by_iso3.get(EUROZONE_ISO3)

    rows = []
    matched, unmatched = 0, 0
    for country_id, currency_code in existing_countries.items():
        if currency_code == "EUR":
            dollar_price = eurozone_dollar_price
        else:
            iso3 = country_id_to_iso3.get(country_id)
            dollar_price = dollar_price_by_iso3.get(iso3) if iso3 else None

        if pd.notna(dollar_price):
            big_mac_price = round(dollar_price * usd_krw_rate)
            matched += 1
        else:
            big_mac_price = None
            unmatched += 1

        rows.append({"country_id": country_id, "big_mac_price": big_mac_price})

    print(f"빅맥지수 매칭 {matched}개국, 매칭 안 돼 NULL 처리 {unmatched}개국 (총 {len(rows)}개국)")
    return rows


def update_countries(rows, conn=None):
    connection, owns_conn = get_connection(DB_URL, conn)
    updated = 0
    try:
        with connection.cursor() as cur:
            for row in rows:
                cur.execute(UPDATE_SQL, row)
                updated += cur.rowcount
        if owns_conn:
            connection.commit()
    finally:
        if owns_conn:
            connection.close()

    return updated


def main(conn=None):
    connection, owns_conn = get_connection(DB_URL, conn)
    try:
        rows = build_rows(connection)
        updated = update_countries(rows, conn=connection)
        if owns_conn:
            connection.commit()
    finally:
        if owns_conn:
            connection.close()

    print(f"Supabase countries 테이블 big_mac_price 갱신 완료 ({updated}개국 값 변경)")


if __name__ == "__main__":
    main()
