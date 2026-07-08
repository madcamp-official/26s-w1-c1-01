"""
네이버 항공권(flight.naver.com)에서 ICN 출발 왕복 최저가를 목적지별로 스크래핑해
DataFrame으로 반환한다(README의 flight_price_scrapes와 동일한 컬럼 구성이며, 실패한
목적지도 price를 비워 성공률을 추적할 수 있게 남긴다). CSV를 거치지 않고 이 결과를
그대로 collectors/build_flights.py에 넘겨 Supabase에 적재한다(main_batch.py 참고).

목적지 목록은 Supabase cities 테이블의 city_id를 그대로 쓴다(= IATA 코드). 로컬 CSV
스냅샷 대신 매 실행마다 DB에서 직접 읽어와, cities 테이블이 갱신돼도 목적지 목록이
바로 따라간다. 검색 결과 페이지는 기본적으로 "가격 낮은 순"으로
정렬되어 오지만 정렬 순서를 신뢰하지 않고, 로드된 모든 항공편 조합 카드에서 가격을 뽑아
직접 최솟값을 계산한다(스크롤로 더 불러와도 뒤에는 항상 같거나 더 비싼 조합만 추가되는 것을
확인함 - 첫 배치의 최솟값이 곧 전체 최솟값).

정적 요청으로는 결과가 비어 있는 클라이언트 사이드 렌더링 페이지라 Playwright(Chromium)로
실제 렌더링해서 파싱한다. 개별 항공편의 실제 예매 링크는 팝업으로 열리는 각 판매처별
버튼이라 안정적으로 크롤링할 정적 URL이 없으므로, source_url은 동일 조건으로 재검색하면
같은 결과를 볼 수 있는 검색 결과 페이지 URL로 남긴다.
"""

import logging
import os
import random
import time
from datetime import datetime, timedelta

import pandas as pd
from dotenv import load_dotenv
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from _db import get_connection
from _parallel_runner import SCRAPE_DELAY_RANGE, run_sequential_or_parallel

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, "../.env"))
DB_URL = os.environ.get("SUPABASE_DB_URL")

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


def load_destinations(conn=None):
    connection, owns_conn = get_connection(DB_URL, conn)
    try:
        with connection.cursor() as cur:
            cur.execute("SELECT city_id FROM cities WHERE city_id != %s ORDER BY city_id", (ORIGIN,))
            return [row[0] for row in cur.fetchall()]
    finally:
        if owns_conn:
            connection.close()


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


def _scrape_destinations(destinations, depart_date, return_date, scrape_date):
    """destinations 목록 하나를 브라우저 하나로 순차 스크랩해 rows 리스트를 반환한다.

    main()은 이 함수를 destinations 전체에 대해 한 번만 호출하고, main_parallel()은
    destinations를 나눠 이 함수를 프로세스마다 하나씩 동시에 돌린다.
    """
    depart_iso = datetime.strptime(depart_date, "%Y%m%d").date().isoformat()
    return_iso = datetime.strptime(return_date, "%Y%m%d").date().isoformat()

    rows = []

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
                "price": price,
                "airline": airline,
                "source_url": url,
            })

            if price:
                logging.info(f"{dest}: {price:,}원 ({airline})")
            else:
                logging.warning(f"{dest}: 가격을 찾지 못했습니다.")

            # 봇 탐지 우회를 위한 랜덤 딜레이
            time.sleep(random.uniform(*SCRAPE_DELAY_RANGE))

        browser.close()

    return rows


def _finalize(rows, label="스크래핑"):
    """rows -> DataFrame 변환, 성공/실패 로그, Top5 출력까지 main()/main_parallel() 공통 마무리."""
    df = pd.DataFrame(rows, columns=FIELDNAMES)
    success_count = sum(1 for r in rows if r["price"])
    fail_count = len(rows) - success_count
    logging.info(f"{label} 완료. 성공 {success_count} / 실패 {fail_count}")

    valid = [r for r in rows if r["price"]]
    if valid:
        top5 = sorted(valid, key=lambda r: r["price"])[:5]
        print("\n=== Top 5 Cheapest Destinations ===")
        for r in top5:
            print(f"{r['city_id']}: {r['price']:,} 원 ({r['airline']})")

    return df


def _resolve_destinations(city_id, conn=None):
    destinations = load_destinations(conn=conn)
    if city_id:
        if city_id not in destinations:
            raise ValueError(f"알 수 없는 목적지 코드: {city_id}")
        destinations = [city_id]
    return destinations


def main(city_id=None, conn=None):
    """city_id를 주면 해당 목적지 하나만, 없으면 전체 목적지를 순차로(브라우저 1개) 스크래핑한다.

    반환값은 FIELDNAMES 컬럼을 가진 DataFrame이며, build_flights.main(df)로 그대로 넘긴다.
    conn을 주면 목적지 목록 조회 시 커넥션을 재사용한다(main_batch.run_for_city 참고).
    """
    destinations = _resolve_destinations(city_id, conn=conn)
    scrape_date = datetime.now().strftime("%Y-%m-%d")
    depart_date, return_date = get_search_dates()
    depart_iso = datetime.strptime(depart_date, "%Y%m%d").date().isoformat()
    return_iso = datetime.strptime(return_date, "%Y%m%d").date().isoformat()

    logging.info(
        f"ICN 출발 {len(destinations)}개 목적지 항공권 최저가 스크래핑 시작 "
        f"({depart_iso} ~ {return_iso})"
    )

    rows = _scrape_destinations(destinations, depart_date, return_date, scrape_date)
    return _finalize(rows)


def main_parallel(city_id=None, workers=4, conn=None):
    """main()과 같은 일을 destinations를 workers개 프로세스로 나눠 동시에 처리한다.

    프로세스마다 자기 브라우저를 하나씩 띄우고, 각 프로세스 안에서는 지금까지와 동일하게
    목적지마다 봇 탐지 회피용 랜덤 딜레이(_parallel_runner.SCRAPE_DELAY_RANGE)를 두고
    순차 처리한다 - 딜레이 자체를 없애는 게 아니라 그 딜레이를 여러 프로세스가 동시에
    돌리는 방식으로 전체 시간을 줄인다.

    동시에 여러 프로세스가 같은 서버 IP에서 요청을 보내므로 workers를 너무 크게 잡으면
    차단 위험이 커진다 - 처음엔 3~5 정도로 시작해서 차단률을 보며 조절할 것.

    conn을 주면 목적지 목록 조회(부모 프로세스에서 한 번만 실행)에 커넥션을 재사용한다
    - ProcessPoolExecutor로 띄우는 워커 프로세스에는 이 conn을 넘기지 않는다(커넥션은
    프로세스 간에 공유할 수 없음).
    """
    destinations = _resolve_destinations(city_id, conn=conn)
    scrape_date = datetime.now().strftime("%Y-%m-%d")
    depart_date, return_date = get_search_dates()
    depart_iso = datetime.strptime(depart_date, "%Y%m%d").date().isoformat()
    return_iso = datetime.strptime(return_date, "%Y%m%d").date().isoformat()

    logging.info(
        f"ICN 출발 {len(destinations)}개 목적지 항공권 최저가 병렬 스크래핑 시작 "
        f"(workers={workers}, {depart_iso} ~ {return_iso})"
    )

    rows = run_sequential_or_parallel(
        destinations, _scrape_destinations, workers, depart_date, return_date, scrape_date
    )
    return _finalize(rows, label="병렬 스크래핑")


if __name__ == "__main__":
    main()
