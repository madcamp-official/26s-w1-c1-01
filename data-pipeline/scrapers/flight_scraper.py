"""
네이버 항공권(flight.naver.com)에서 ICN 출발 왕복 최저가를 목적지별로 스크래핑해
data/processed/flight_prices.csv 에 원본 로그로 적재한다(README의 flight_price_scrapes와
동일하게 매 실행마다 append하며, 실패한 목적지도 price를 비워 성공률을 추적할 수 있게 남긴다).

목적지 목록은 collectors/merge_airport_db.py가 만든 data/processed/airports.csv의
IATA 코드를 그대로 쓴다(= cities.city_id). 검색 결과 페이지는 기본적으로 "가격 낮은 순"으로
정렬되어 오지만 정렬 순서를 신뢰하지 않고, 로드된 모든 항공편 조합 카드에서 가격을 뽑아
직접 최솟값을 계산한다(스크롤로 더 불러와도 뒤에는 항상 같거나 더 비싼 조합만 추가되는 것을
확인함 - 첫 배치의 최솟값이 곧 전체 최솟값).

정적 요청으로는 결과가 비어 있는 클라이언트 사이드 렌더링 페이지라 Playwright(Chromium)로
실제 렌더링해서 파싱한다. 개별 항공편의 실제 예매 링크는 팝업으로 열리는 각 판매처별
버튼이라 안정적으로 크롤링할 정적 URL이 없으므로, source_url은 동일 조건으로 재검색하면
같은 결과를 볼 수 있는 검색 결과 페이지 URL로 남긴다.
"""

import csv
import logging
import os
import random
import time
from datetime import datetime, timedelta

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
AIRPORTS_CSV = os.path.join(BASE_DIR, "../data/processed/airports.csv")
OUTPUT_CSV = os.path.join(BASE_DIR, "../data/processed/flight_prices.csv")

ORIGIN = "ICN"
SEARCH_URL = "https://flight.naver.com/flights/international/{origin}-{dest}-{depart}/{dest}-{origin}-{ret}?adultCount=1"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)
RESULT_SELECTOR = ".combination_ConcurrentItemContainer__uUEbl"
PRICE_SELECTOR = ".item_num__aKbk4"
AIRLINE_SELECTOR = ".airline_name__0Tw5w"
RESULT_TIMEOUT_MS = 15000
RENDER_SETTLE_SEC = 2
FIELDNAMES = ["city_id", "scrape_date", "depart_date", "return_date", "price", "airline", "source_url"]

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")


def load_destinations():
    with open(AIRPORTS_CSV, encoding="utf-8-sig") as f:
        return [row["IATA"] for row in csv.DictReader(f) if row["IATA"] != ORIGIN]


def get_search_dates():
    """실행일 다음날 출발, 7일 후 귀국하는 왕복 일정을 검색 기준으로 삼는다."""
    depart = datetime.now() + timedelta(days=1)
    return_ = depart + timedelta(days=7)
    return depart.strftime("%Y%m%d"), return_.strftime("%Y%m%d")


def scrape_lowest_price(page, dest, depart_date, return_date):
    url = SEARCH_URL.format(origin=ORIGIN, dest=dest, depart=depart_date, ret=return_date)
    page.goto(url, timeout=30000)

    try:
        page.wait_for_selector(RESULT_SELECTOR, timeout=RESULT_TIMEOUT_MS)
    except PlaywrightTimeoutError:
        return None, None, url

    time.sleep(RENDER_SETTLE_SEC)

    best_price, best_airline = None, None
    for card in page.query_selector_all(RESULT_SELECTOR):
        price_texts = [el.inner_text() for el in card.query_selector_all(PRICE_SELECTOR)]
        prices = [int(t.replace(",", "")) for t in price_texts if t.replace(",", "").isdigit()]
        if not prices:
            continue

        price = min(prices)
        if best_price is None or price < best_price:
            best_price = price
            names = [el.inner_text() for el in card.query_selector_all(AIRLINE_SELECTOR)]
            best_airline = ", ".join(dict.fromkeys(names)) if names else None

    return best_price, best_airline, url


def append_rows(rows):
    file_exists = os.path.exists(OUTPUT_CSV)
    os.makedirs(os.path.dirname(OUTPUT_CSV), exist_ok=True)
    with open(OUTPUT_CSV, "a", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        if not file_exists:
            writer.writeheader()
        writer.writerows(rows)


def main():
    destinations = load_destinations()
    scrape_date = datetime.now().strftime("%Y-%m-%d")
    depart_date, return_date = get_search_dates()
    depart_iso = datetime.strptime(depart_date, "%Y%m%d").date().isoformat()
    return_iso = datetime.strptime(return_date, "%Y%m%d").date().isoformat()

    logging.info(
        f"ICN 출발 {len(destinations)}개 목적지 항공권 최저가 스크래핑 시작 "
        f"({depart_iso} ~ {return_iso})"
    )

    rows = []
    success_count = fail_count = 0

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(user_agent=USER_AGENT)

        for idx, dest in enumerate(destinations, start=1):
            logging.info(f"[{idx}/{len(destinations)}] ICN -> {dest}")

            try:
                price, airline, url = scrape_lowest_price(page, dest, depart_date, return_date)
            except Exception:
                logging.exception(f"{dest} 스크래핑 중 오류 발생")
                price, airline, url = None, None, None

            rows.append({
                "city_id": dest,
                "scrape_date": scrape_date,
                "depart_date": depart_iso,
                "return_date": return_iso,
                "price": price if price else "",
                "airline": airline or "",
                "source_url": url or "",
            })

            if price:
                success_count += 1
                logging.info(f"{dest}: {price:,}원 ({airline})")
            else:
                fail_count += 1
                logging.warning(f"{dest}: 가격을 찾지 못했습니다.")

            # 봇 탐지 우회를 위한 랜덤 딜레이 (3 ~ 10초)
            time.sleep(random.uniform(3, 10))

        browser.close()

    append_rows(rows)
    logging.info(f"스크래핑 완료. 성공 {success_count} / 실패 {fail_count} -> {OUTPUT_CSV}")

    valid = [r for r in rows if r["price"]]
    if valid:
        top5 = sorted(valid, key=lambda r: r["price"])[:5]
        print("\n=== Top 5 Cheapest Destinations ===")
        for r in top5:
            print(f"{r['city_id']}: {r['price']:,} 원 ({r['airline']})")


if __name__ == "__main__":
    main()
