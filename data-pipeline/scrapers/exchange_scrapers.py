"""
한국수출입은행 오픈API(환율정보)에서 최신 매매기준율을 수집해
data/processed/exchange.csv 로 저장한다.

exchange_rate_scraper.py는 'JPY(100)'처럼 100단위로 고시되는 통화를
1단위 기준으로 나눠서 저장하지만, 이 스크립트는 고시 단위(unit)와
원본 매매기준율(exchangeRate)을 나누지 않고 그대로 각각의 컬럼에 저장한다.

인증키(EXIM_AUTH_KEY)는 저장소에 커밋되지 않는 .env 파일에서 읽는다.
주말/공휴일에는 해당 일자 환율이 고시되지 않아 빈 배열이 오므로,
값이 나올 때까지 최근 영업일을 거슬러 조회한다.
"""

import csv
import os
from datetime import datetime, timedelta

import requests
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, "../.env"))

API_URL = "https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON"
AUTH_KEY = os.environ.get("EXIM_AUTH_KEY")
OUTPUT_CSV = os.path.join(BASE_DIR, "../data/processed/exchange.csv")
MAX_LOOKBACK_DAYS = 7


def fetch_rates_for_date(search_date):
    params = {"authkey": AUTH_KEY, "searchdate": search_date, "data": "AP01"}
    response = requests.get(API_URL, params=params, timeout=10)
    response.raise_for_status()
    return response.json()


def fetch_latest_rates():
    if not AUTH_KEY:
        raise RuntimeError("EXIM_AUTH_KEY가 설정되어 있지 않습니다. data-pipeline/.env를 확인하세요.")

    date = datetime.now()
    for _ in range(MAX_LOOKBACK_DAYS):
        search_date = date.strftime("%Y%m%d")
        rates = fetch_rates_for_date(search_date)
        valid = [r for r in rates if r.get("result") == 1]
        if valid:
            return search_date, valid
        date -= timedelta(days=1)

    raise RuntimeError(f"최근 {MAX_LOOKBACK_DAYS}일간 조회된 환율 데이터가 없습니다.")


def split_unit_rate(row):
    """'JPY(100)'처럼 괄호가 붙은 cur_unit은 통화 코드와 고시 단위(100)로 분리하고,
    매매기준율(deal_bas_r)은 정규화하지 않고 고시 단위 그대로의 값을 반환한다."""
    cur_unit = row["cur_unit"]
    rate = float(row["deal_bas_r"].replace(",", ""))

    if "(" in cur_unit:
        code, unit = cur_unit.rstrip(")").split("(")
        unit = int(unit)
    else:
        code, unit = cur_unit, 1

    return code, unit, rate


def main():
    search_date, rows = fetch_latest_rates()

    result = []
    for row in rows:
        code, unit, rate = split_unit_rate(row)
        result.append({
            "currencyCode": code,
            "currencyName": row["cur_nm"],
            "unit": unit,
            "exchangeRate": rate,
            "baseDate": search_date,
        })

    os.makedirs(os.path.dirname(OUTPUT_CSV), exist_ok=True)
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=["currencyCode", "currencyName", "unit", "exchangeRate", "baseDate"])
        writer.writeheader()
        writer.writerows(result)

    print(f"저장 완료: {OUTPUT_CSV} ({len(result)}개 통화, 기준일 {search_date})")


if __name__ == "__main__":
    main()
