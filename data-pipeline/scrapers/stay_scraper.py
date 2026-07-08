"""
hotels.naver.com에서 도시별 최저 숙박가(체크인~체크아웃 총액)를 스크래핑해
DataFrame으로 반환한다(README의 stay_price_scrapes와 동일한 컬럼 구성이며, 실패한
도시도 price를 비워 성공률을 추적할 수 있게 남긴다). CSV를 거치지 않고 이 결과를
그대로 collectors/build_stay.py에 넘겨 Supabase에 적재한다(main_batch.py 참고).

대상 도시 목록은 Supabase cities 테이블에서 city_id/name_ko를 직접 읽어온다. 로컬 CSV
스냅샷 대신 매 실행마다 DB에서 읽어와, cities 테이블이 갱신돼도 대상 목록이 바로
따라간다. NRT/HND처럼 name_ko(예: 도쿄)가 같은 도시는 같은 실행 안에서 실제 스크래핑을
한 번만 하고 결과를 재사용해, hotels.naver.com에 대한 불필요한 중복 요청과 그로 인한
봇 차단 위험을 줄인다.

체크인은 항상 실행 시점의 다음날, 체크아웃은 체크인으로부터 7일 후로 고정한다.

호텔 지역 코드(placeSn)는 hotels.naver.com의 비공개 GraphQL API 대신,
search.naver.com 검색 결과에 노출되는 "네이버 호텔 {도시명}" 링크에서 정규식으로
뽑아낸다. 검색 결과 페이지 렌더링은 실제 Chrome을 화면 밖(-3000,-3000)에 띄우고
playwright-stealth로 자동화 흔적을 지운 뒤 진행해야 하는데, 그냥 headless=True로
띄우면 hotels.naver.com이 봇으로 감지해 가격이 로딩되지 않는 것이 실측으로
확인됐다. 가격은 페이지에 렌더링된 "OO,OOO원~" 텍스트를 정규식으로 읽는다(내부
API가 아니라 화면에 보이는 값 그대로이므로 사이트 UI가 바뀌면 같이 깨진다).

Supabase 적재는 collectors/build_stay.py가 이 DataFrame을 받아서 처리한다.

주의: headless=False로 실행하므로 이 스크립트는 디스플레이 서버(X 또는 Xvfb)가 있는
환경에서 실행해야 한다. Xvfb 없는 순수 헤드리스 컨테이너/서버에서는 브라우저 launch
자체가 실패하므로, 배포 시 `xvfb-run python main_batch.py ...`처럼 가상 디스플레이를
붙이거나 Xvfb가 설치된 이미지를 사용할 것.
"""

import logging
import os
import random
import re
import time
import urllib.parse
import urllib.request
from datetime import date, timedelta

import pandas as pd
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright
from playwright_stealth import Stealth

from _db import get_connection
from _parallel_runner import SCRAPE_DELAY_RANGE, run_sequential_or_parallel

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, "../.env"))
DB_URL = os.environ.get("SUPABASE_DB_URL")
FIELDNAMES = ["city_id", "checkin", "checkout", "price", "source_url"]

STAY_NIGHTS = 7
MIN_VALID_PRICE = 40000
MAX_VALID_PRICE = 5000000
PRICE_WAIT_TIMEOUT_MS = 20000


def get_hotel_dates():
    checkin = date.today() + timedelta(days=1)
    checkout = checkin + timedelta(days=STAY_NIGHTS)
    return checkin.strftime("%Y-%m-%d"), checkout.strftime("%Y-%m-%d")


def load_cities(conn=None):
    """Supabase cities 테이블에서 (city_id, name_ko) 목록을 읽어온다."""
    connection, owns_conn = get_connection(DB_URL, conn)
    try:
        with connection.cursor() as cur:
            cur.execute("SELECT city_id, name_ko FROM cities ORDER BY city_id")
            return cur.fetchall()
    finally:
        if owns_conn:
            connection.close()


def _get_hotel_place_id(city_name):
    """search.naver.com에서 "네이버 호텔 {도시명}"을 검색해, 결과에 노출되는
    hotels.naver.com 링크의 지역 코드(placeSn)를 정규식으로 추출한다."""
    query = urllib.parse.quote(f"네이버 호텔 {city_name}")
    url = f"https://search.naver.com/search.naver?query={query}"

    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    })

    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            html = response.read().decode("utf-8")
            match = re.search(r"https://hotels\.naver\.com/accommodation/([^/]+)/hotels", html)
            return match.group(1) if match else None
    except Exception as e:
        logging.error(f"Error getting place id for {city_name}: {e}")
        return None


def _extract_lowest_price(page):
    prices = []
    items = page.locator('li:has-text("원~")').all()
    for item in items:
        text = item.inner_text().replace("\n", " ")
        for match in re.findall(r"([0-9]{1,3}(?:,[0-9]{3})+)\s*원\s*~", text):
            price = int(match.replace(",", ""))
            if MIN_VALID_PRICE <= price <= MAX_VALID_PRICE:
                prices.append(price)

    if not prices:
        # 개별 <li> 파싱이 실패했을 때의 백업: 화면 전체 텍스트에서 다시 추출한다.
        text = page.locator("body").inner_text().replace("\n", " ")
        for match in re.findall(r"([0-9]{1,3}(?:,[0-9]{3})+)\s*원\s*~", text):
            price = int(match.replace(",", ""))
            if MIN_VALID_PRICE <= price <= MAX_VALID_PRICE:
                prices.append(price)

    return min(prices) if prices else None


def scrape_lowest_hotel_price(page, city_name, checkin, checkout):
    """특정 도시의 체크인~체크아웃 기간 네이버 호텔 최저가를 스크래핑한다.

    page는 호출부(_scrape_cities)에서 미리 띄워둔 브라우저의 페이지를 그대로 받아
    재사용한다 - 도시마다 브라우저를 새로 띄우고 종료하는 비용(수 초 단위)을 없애기 위함
    (flight_scraper.py의 _scrape_destinations와 동일한 패턴).
    """
    place_id = _get_hotel_place_id(city_name)
    if not place_id:
        logging.error(f"Could not find place id for {city_name}")
        return None, None

    url = f"https://hotels.naver.com/accommodation/{place_id}/hotels?checkin={checkin}&checkout={checkout}&adultCnt=1&types=HOTEL"

    logging.info(f"Scraping hotels for {city_name} at {url}")
    page.goto(url)

    try:
        page.locator("text=원~").first.wait_for(state="visible", timeout=PRICE_WAIT_TIMEOUT_MS)
        page.wait_for_timeout(1000)
    except Exception:
        if page.locator("text=일시적으로 응답하지 못했습니다").count() > 0:
            logging.warning(f"[{city_name}] 일시적 오류 감지, 새로고침 재시도")
            page.reload()
            try:
                page.locator("text=원~").first.wait_for(state="visible", timeout=PRICE_WAIT_TIMEOUT_MS)
                page.wait_for_timeout(1000)
            except Exception:
                logging.warning(f"[{city_name}] 재시도 후에도 가격 로딩 타임아웃")
        else:
            logging.warning(f"[{city_name}] 가격 로딩 타임아웃")

    price = _extract_lowest_price(page)
    if price is not None:
        logging.info(f"[{city_name}] Found lowest hotel price: {price} ₩")
    else:
        logging.warning(f"[{city_name}] No valid hotel price found on page.")

    return price, url


def _scrape_cities(cities, checkin, checkout):
    """(city_id, name_ko) 목록 하나를 브라우저 하나로 순차 스크랩해 rows 리스트를 반환한다.

    브라우저는 이 함수 호출당 한 번만 launch해서 목록 전체에 재사용한다(도시마다 새로
    띄우던 이전 방식 대비 브라우저 기동 비용을 없앰). name_ko가 같은 도시(NRT/HND 등)의
    중복 스크래핑 방지도 이 함수 호출 한 번 안에서만 적용된다 - main_parallel()처럼
    cities를 여러 프로세스로 나누면, 같은 name_ko가 서로 다른 청크에 걸쳐 들어갈 경우
    청크마다 한 번씩 다시 스크랩된다.
    """
    results_by_name = {}
    rows = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            args=[
                "--window-position=-3000,-3000",
                "--window-size=10,10",
                "--disable-blink-features=AutomationControlled",
            ],
        )
        try:
            context = browser.new_context(
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
            page = context.new_page()
            Stealth().apply_stealth_sync(page)

            for city_id, name_ko in cities:
                if name_ko in results_by_name:
                    price, url = results_by_name[name_ko]
                else:
                    price, url = scrape_lowest_hotel_price(page, name_ko, checkin, checkout)
                    results_by_name[name_ko] = (price, url)
                    time.sleep(random.uniform(*SCRAPE_DELAY_RANGE))

                rows.append({
                    "city_id": city_id,
                    "checkin": checkin,
                    "checkout": checkout,
                    "price": price,
                    "source_url": url,
                })

                if price:
                    logging.info(f"{city_id}({name_ko}): {price:,}원")
                else:
                    logging.warning(f"{city_id}({name_ko}): 가격을 찾지 못했습니다.")
        finally:
            browser.close()

    return rows


def _finalize(rows, label="스크래핑"):
    df = pd.DataFrame(rows, columns=FIELDNAMES)
    success_count = sum(1 for r in rows if r["price"])
    fail_count = len(rows) - success_count
    logging.info(f"{label} 완료. 성공 {success_count} / 실패 {fail_count}")
    return df


def _resolve_cities(city_id, conn=None):
    cities = load_cities(conn=conn)
    if city_id:
        cities = [c for c in cities if c[0] == city_id]
        if not cities:
            raise ValueError(f"알 수 없는 도시 코드: {city_id}")
    return cities


def main(city_id=None, conn=None):
    """city_id를 주면 해당 도시 하나만, 없으면 전체 도시를 순차로 스크래핑한다.

    반환값은 FIELDNAMES 컬럼을 가진 DataFrame이며, build_stay.main(df)로 그대로 넘긴다.
    conn을 주면 도시 목록 조회 시 커넥션을 재사용한다(main_batch.run_for_city 참고).
    """
    checkin, checkout = get_hotel_dates()
    cities = _resolve_cities(city_id, conn=conn)

    logging.info(f"{len(cities)}개 도시 숙박 최저가 스크래핑 시작 ({checkin} ~ {checkout})")

    rows = _scrape_cities(cities, checkin, checkout)
    return _finalize(rows)


def main_parallel(city_id=None, workers=4, conn=None):
    """main()과 같은 일을 cities를 workers개 프로세스로 나눠 동시에 처리한다.

    프로세스마다 자기 브라우저로 자기 몫의 도시를 순차 처리하고, 그 안에서는 지금까지와
    동일하게 도시마다 봇 탐지 회피용 랜덤 딜레이(_parallel_runner.SCRAPE_DELAY_RANGE)를
    둔다 - 딜레이를 없애는 게 아니라 여러 프로세스가 그 딜레이를 동시에 돌리는 방식으로
    전체 시간을 줄인다.

    name_ko 중복 제거는 프로세스(청크) 경계를 넘지 못하므로, 같은 도시명이 여러 청크에
    걸치면 청크 수만큼 중복 스크랩될 수 있다(_scrape_cities 참고). cities 수가 workers보다
    훨씬 많을 때만 이득이 크고, 동시 요청이 늘어나는 만큼 차단 위험도 커지니 workers는
    3~5 정도로 시작해서 차단률을 보며 조절할 것.

    conn을 주면 도시 목록 조회(부모 프로세스에서 한 번만 실행)에 커넥션을 재사용한다
    - ProcessPoolExecutor로 띄우는 워커 프로세스에는 이 conn을 넘기지 않는다(커넥션은
    프로세스 간에 공유할 수 없음).
    """
    checkin, checkout = get_hotel_dates()
    cities = _resolve_cities(city_id, conn=conn)

    logging.info(
        f"{len(cities)}개 도시 숙박 최저가 병렬 스크래핑 시작 "
        f"(workers={workers}, {checkin} ~ {checkout})"
    )

    rows = run_sequential_or_parallel(cities, _scrape_cities, workers, checkin, checkout)
    return _finalize(rows, label="병렬 스크래핑")


if __name__ == "__main__":
    main()
