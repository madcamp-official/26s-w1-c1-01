"""
scrapers/travel_alarm_scraper.py의 API 호출 로직(fetch_all_alarms/summarize_alarm)을
그대로 재사용해 외교부 여행경보 데이터를 가져오고, CSV를 거치지 않고 곧바로
Supabase(Postgres) countries.alarm_level / countries.special_advisory를 UPDATE한다.

(build_countries.py는 countries.csv 조립까지만 하고 DB에 쓰지 않아, 지금까지
countries 테이블에 여행경보가 반영되는 경로가 아예 없었다 - 이 스크립트가 그
마지막 단계를 담당한다.)

여행경보 API는 국가를 ISO 3166-1 alpha-3(iso_code)로 식별하므로, build_countries.py와
동일한 외교부 국가/지역별 표준코드 원본의 ISO(3자리) 컬럼으로 country_id(alpha-2)와
연결한다. countries 테이블에 이미 있는 country_id만 UPDATE 대상이라(INSERT는 하지
않음), DB에 없는 국가는 WHERE 절에서 자연히 매칭되지 않고 건너뛰어진다.

접속 문자열은 다른 collectors와 동일하게 data-pipeline/.env의 SUPABASE_DB_URL을 쓴다.
"""

import os
import sys

import pandas as pd
import psycopg2
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SCRAPERS_DIR = os.path.join(BASE_DIR, "../scrapers")
sys.path.insert(0, SCRAPERS_DIR)
from travel_alarm_scraper import fetch_all_alarms, summarize_alarm  # noqa: E402

load_dotenv(os.path.join(BASE_DIR, "../.env"))

MOFA_CSV = os.path.join(BASE_DIR, "../data/raw/외교부_국가_지역별 표준코드_20240716.csv")
DB_URL = os.environ.get("SUPABASE_DB_URL")

UPDATE_SQL = '''
    UPDATE countries
    SET alarm_level = %(alarm_level)s,
        special_advisory = %(special_advisory)s,
        updated_at = now()
    WHERE country_id = %(country_id)s
      AND (alarm_level, special_advisory) IS DISTINCT FROM (%(alarm_level)s, %(special_advisory)s)
'''


def load_iso3_to_country_id():
    mofa = pd.read_csv(MOFA_CSV, encoding="utf-16", sep="\t")
    mofa = mofa.rename(columns={
        "ISO(2자리)": "country_id",
        "ISO(3자리)": "iso3",
    })[["country_id", "iso3"]].dropna()
    return dict(zip(mofa["iso3"], mofa["country_id"]))


def build_rows():
    iso3_to_country_id = load_iso3_to_country_id()

    rows = []
    unmatched = set()
    for item in fetch_all_alarms():
        iso3 = item.get("iso_code")
        if not iso3:
            continue
        iso3 = iso3.upper()

        country_id = iso3_to_country_id.get(iso3)
        if not country_id:
            unmatched.add(iso3)
            continue

        alarm_level, special_advisory = summarize_alarm(item)
        rows.append({
            "country_id": country_id,
            "alarm_level": alarm_level,
            "special_advisory": special_advisory,
        })

    if unmatched:
        print(f"경고: 외교부 표준코드에서 country_id로 매칭되지 않은 iso3 {len(unmatched)}개: {sorted(unmatched)}")

    return rows


def get_country_id_for_city(city_id):
    if not DB_URL:
        raise RuntimeError("SUPABASE_DB_URL이 설정되어 있지 않습니다. data-pipeline/.env를 확인하세요.")

    conn = psycopg2.connect(DB_URL)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT country_id FROM cities WHERE city_id = %s", (city_id,))
            row = cur.fetchone()
    finally:
        conn.close()

    return row[0] if row else None


def update_countries(rows):
    if not DB_URL:
        raise RuntimeError("SUPABASE_DB_URL이 설정되어 있지 않습니다. data-pipeline/.env를 확인하세요.")

    conn = psycopg2.connect(DB_URL)
    updated = 0
    try:
        with conn.cursor() as cur:
            for row in rows:
                cur.execute(UPDATE_SQL, row)
                updated += cur.rowcount
        conn.commit()
    finally:
        conn.close()

    return updated


def main(city_id=None):
    """city_id를 주면 해당 도시가 속한 국가 하나만 갱신한다.

    여행경보 API 자체가 국가 단위 조회만 지원해 전체 목록은 그대로 받아오지만,
    DB에는 city_id로 찾은 country_id에 해당하는 국가만 반영한다.
    """
    rows = build_rows()

    if city_id:
        country_id = get_country_id_for_city(city_id)
        if not country_id:
            raise ValueError(f"알 수 없는 도시 코드: {city_id}")
        rows = [row for row in rows if row["country_id"] == country_id]

    updated = update_countries(rows)
    print(f"Supabase countries 테이블 여행경보 갱신 완료 (대상 {len(rows)}개국 중 {updated}개국 값 변경)")


if __name__ == "__main__":
    main()
