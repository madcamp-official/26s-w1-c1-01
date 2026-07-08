"""
m.stock.naver.com/marketindex/exchange/FX_{통화코드}KRW 모바일 페이지가 내부적으로
호출하는 JSON API(api.stock.naver.com/marketindex/exchange/FX_{통화코드}KRW)에서
실시간 매매기준율(KRW 기준)을 수집해 Supabase currencies 테이블에 바로 upsert한다.
CSV 등 중간 파일을 거치지 않으며, 인증키가 필요 없어 한국수출입은행 API와 달리
EXIM_AUTH_KEY 설정이 불필요하다(SUPABASE_DB_URL만 필요).

HTML을 파싱하던 예전 finance.naver.com 방식과 달리 이 API는 exchangeInfo.closePrice에
현재가를 바로 JSON 숫자 문자열(천단위 콤마 포함, 예: "1,506.70")로 내려주므로 콤마만
제거하면 된다.

1단위 가치가 낮아 하나은행이 100단위로 고시하는 통화(JPY/IDR/VND)는 exchangeInfo.fullName이
"일본 JPY 100"처럼 " 100"으로 끝나는 것으로 실측 확인했다. 이를 이용해 하드코딩 없이
100단위 고시 여부를 응답에서 직접 판별해 unit 컬럼에 담는다. exchange_rate는 closePrice를
그대로 저장하며(1단위로 나누지 않음), exchange_scrapers.py/build_currencies.py와 동일하게
"unit당 exchange_rate원" 컨벤션을 따른다(예: unit=100, exchange_rate=927.46 ->
100엔=927.46원). frontend가 이 unit을 그대로 표시 라벨로 쓰므로 임의로 정규화하면 안 된다.

같은 이유로 이 API는 국가명을 안 주고 통화 단위명만 주는 계산기 위젯 API
(m.search.naver.com/.../qapirender.nhn)보다 취급 통화가 더 넓다 - 계산기 API에서는
빠졌던 피지(FJD)/케냐(KES)/스리랑카(LKR)/미얀마(MMK)/우즈베키스탄(UZS)/캄보디아(KHR)도
여기서는 조회된다. 다만 라오스(LAK)는 marketindexCd 자체가 없어(404 대신 409
StockConflict 응답) 이 방식으로도 못 채운다.
"""

import os
import time
from datetime import datetime

import psycopg2
import requests
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, "../.env"))

EXCHANGE_URL = "https://api.stock.naver.com/marketindex/exchange/FX_{code}KRW"
DB_URL = os.environ.get("SUPABASE_DB_URL")
REQUEST_DELAY_SEC = 0.3
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

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

CURRENCY_NAMES = {
    "AED": "아랍에미리트 디르함",
    "AUD": "호주 달러",
    "BHD": "바레인 디나르",
    "BND": "브루나이 달러",
    "CAD": "캐나다 달러",
    "CHF": "스위스 프랑",
    "CNY": "중국 위안",
    "CZK": "체코 코루나",
    "DKK": "덴마크 크로네",
    "EUR": "유로",
    "FJD": "피지 달러",
    "GBP": "영국 파운드",
    "HKD": "홍콩 달러",
    "IDR": "인도네시아 루피아",
    "ILS": "이스라엘 셰켈",
    "INR": "인도 루피",
    "JPY": "일본 엔",
    "KES": "케냐 실링",
    "KHR": "캄보디아 리엘",
    "KRW": "한국 원",
    "KWD": "쿠웨이트 디나르",
    "KZT": "카자흐스탄 텡게",
    "LKR": "스리랑카 루피",
    "MMK": "미얀마 짯",
    "MNT": "몽골 투그릭",
    "MOP": "마카오 파타카",
    "MYR": "말레이시아 링깃",
    "NOK": "노르웨이 크로네",
    "NPR": "네팔 루피",
    "NZD": "뉴질랜드 달러",
    "PHP": "필리핀 페소",
    "QAR": "카타르 리얄",
    "RUB": "러시아 루블",
    "SAR": "사우디아라비아 리얄",
    "SEK": "스웨덴 크로나",
    "SGD": "싱가포르 달러",
    "THB": "태국 바트",
    "TRY": "튀르키예 리라",
    "TWD": "대만 달러",
    "USD": "미국 달러",
    "UZS": "우즈베키스탄 숨",
    "VND": "베트남 동",
}


def fetch_rate(currency_code):
    """currency_code의 (고시 단위, 그 단위당 원화 매매기준율)을 조회한다.
    marketindexCd가 없는 통화는 409 StockConflict가 내려오므로 None을 반환한다."""
    if currency_code == "KRW":
        return 1, 1.0

    response = requests.get(
        EXCHANGE_URL.format(code=currency_code),
        headers=HEADERS,
        timeout=10,
    )
    if response.status_code == 409:
        return None
    response.raise_for_status()

    info = response.json()["exchangeInfo"]
    rate = float(info["closePrice"].replace(",", ""))
    unit = 100 if (info.get("fullName") or "").endswith(" 100") else 1

    return unit, rate


def fetch_latest_rates():
    today = datetime.now().date()

    result = []
    for code, name in CURRENCY_NAMES.items():
        fetched = fetch_rate(code)
        if fetched is None:
            print(f"환율 조회 실패, 건너뜀: {code}")
        else:
            unit, rate = fetched
            result.append({
                "currencyCode": code,
                "currencyName": name,
                "unit": unit,
                "exchangeRate": rate,
                "baseDate": today,
            })
        time.sleep(REQUEST_DELAY_SEC)

    return today, result


def main():
    if not DB_URL:
        raise RuntimeError("SUPABASE_DB_URL이 설정되어 있지 않습니다. data-pipeline/.env를 확인하세요.")

    today, result = fetch_latest_rates()
    if not result:
        raise RuntimeError("조회된 환율 데이터가 없습니다.")

    conn = psycopg2.connect(DB_URL)
    try:
        with conn.cursor() as cur:
            cur.executemany(UPSERT_SQL, result)
        conn.commit()
    finally:
        conn.close()

    print(f"Supabase currencies 테이블 upsert 완료 ({len(result)}개 통화, 기준일 {today})")


if __name__ == "__main__":
    main()
