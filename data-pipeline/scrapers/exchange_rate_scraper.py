"""
finance.naver.com/marketindex/exchangeDetail.naver?marketindexCd=FX_{통화코드}KRW
페이지에서 실시간 매매기준율(KRW 기준)을 수집해 data/processed/exchange_rates.csv 로
저장한다. 인증키가 필요 없어 한국수출입은행 API와 달리 .env 설정이 불필요하다.

네이버는 현재가를 이미지가 아니라 자릿수마다 <span class="no3">3</span>처럼 쪼갠
텍스트로 그리므로(첫 <p class="no_today"> 블록), no%d/jum(소수점)/shim(천단위 콤마)
span의 텍스트를 순서대로 이어붙여 숫자로 만든다.

같은 이유로 이 API는 국가명을 안 주고 통화 단위명만 주는 계산기 위젯 API
(m.search.naver.com/.../qapirender.nhn)보다 취급 통화가 더 넓다 - 계산기 API에서는
빠졌던 피지(FJD)/케냐(KES)/스리랑카(LKR)/미얀마(MMK)/우즈베키스탄(UZS)/캄보디아(KHR)도
여기서는 조회된다. 다만 라오스(LAK)는 marketindexCd 자체가 없어(빈 기본 페이지로
빠짐) 이 방식으로도 못 채운다.
"""

import csv
import os
import re
import time
from datetime import datetime

import requests

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DETAIL_URL = "https://finance.naver.com/marketindex/exchangeDetail.naver"
OUTPUT_CSV = os.path.join(BASE_DIR, "../data/processed/exchange_rates.csv")
REQUEST_DELAY_SEC = 0.3
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

RATE_BLOCK_RE = re.compile(r'<p class="no_today">(.*?)</p>', re.S)
DIGIT_SPAN_RE = re.compile(r'<span class="(?:no\d|jum|shim)">([^<]*)</span>')

# 1단위 가치가 낮아 하나은행이 100단위로 고시하는 통화. 이 페이지는 EXIM API의
# cur_unit("JPY(100)")처럼 고시 단위를 텍스트로 알려주지 않으므로 직접 나열해서
# 1단위 기준으로 환산한다. 다른 저가치 통화(MMK/KHR/UZS/MNT 등)는 그대로 1단위로
# 고시되는 것을 실측으로 확인했다.
PER_100_CURRENCIES = {"JPY", "IDR", "VND"}

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
    """currency_code 1단위가 몇 원인지 조회한다. marketindexCd가 없는 통화는
    빈 기본 페이지가 내려와 no_today 블록을 못 찾으므로 None을 반환한다."""
    if currency_code == "KRW":
        return 1.0

    response = requests.get(
        DETAIL_URL,
        params={"marketindexCd": f"FX_{currency_code}KRW"},
        headers=HEADERS,
        timeout=10,
    )
    response.raise_for_status()
    response.encoding = "euc-kr"

    block = RATE_BLOCK_RE.search(response.text)
    if not block:
        return None

    digits = "".join(DIGIT_SPAN_RE.findall(block.group(1))).replace(",", "")
    if not digits:
        return None

    rate = float(digits)
    if currency_code in PER_100_CURRENCIES:
        rate /= 100

    return rate


def fetch_latest_rates():
    today = datetime.now().strftime("%Y%m%d")

    result = []
    for code, name in CURRENCY_NAMES.items():
        rate = fetch_rate(code)
        if rate is None:
            print(f"환율 조회 실패, 건너뜀: {code}")
        else:
            result.append({
                "currencyCode": code,
                "currencyName": name,
                "exchangeRate": rate,
                "baseDate": today,
            })
        time.sleep(REQUEST_DELAY_SEC)

    return today, result


def main():
    today, result = fetch_latest_rates()
    if not result:
        raise RuntimeError("조회된 환율 데이터가 없습니다.")

    os.makedirs(os.path.dirname(OUTPUT_CSV), exist_ok=True)
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=["currencyCode", "currencyName", "exchangeRate", "baseDate"])
        writer.writeheader()
        writer.writerows(result)

    print(f"저장 완료: {OUTPUT_CSV} ({len(result)}개 통화, 기준일 {today})")


if __name__ == "__main__":
    main()
