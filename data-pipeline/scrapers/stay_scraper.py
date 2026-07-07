"""
hotels.naver.com에서 도시별 최저 숙박가(체크인~체크아웃 총액)를 스크래핑해
data/processed/stay_prices.csv 에 원본 로그로 적재한다(README의 stay_price_scrapes와
동일하게 매 실행마다 append하며, 실패한 도시도 price를 비워 성공률을 추적할 수 있게 남긴다).

대상 도시 목록은 collectors/build_cities.py가 만든 data/processed/cities.csv의
city_id/name_ko를 그대로 쓴다. NRT/HND처럼 name_ko(예: 도쿄)가 같은 도시는 같은
실행 안에서 실제 스크래핑을 한 번만 하고 결과를 재사용해, hotels.naver.com에 대한
불필요한 중복 요청과 그로 인한 봇 차단 위험을 줄인다.

체크인은 항상 실행 시점의 다음날, 체크아웃은 체크인으로부터 7일 후로 고정한다.

호텔 지역 코드(placeSn)는 hotels.naver.com의 비공개 GraphQL API 대신,
search.naver.com 검색 결과에 노출되는 "네이버 호텔 {도시명}" 링크에서 정규식으로
뽑아낸다. 검색 결과 페이지 렌더링은 실제 Chrome을 화면 밖(-3000,-3000)에 띄우고
playwright-stealth로 자동화 흔적을 지운 뒤 진행해야 하는데, 그냥 headless=True로
띄우면 hotels.naver.com이 봇으로 감지해 가격이 로딩되지 않는 것이 실측으로
확인됐다. 가격은 페이지에 렌더링된 "OO,OOO원~" 텍스트를 정규식으로 읽는다(내부
API가 아니라 화면에 보이는 값 그대로이므로 사이트 UI가 바뀌면 같이 깨진다).

Supabase 적재는 collectors/build_stay.py가 이 CSV를 읽어서 처리한다.
"""

import csv
import logging
import os
import random
import re
import time
import urllib.parse
import urllib.request
from datetime import date, timedelta

from playwright.sync_api import sync_playwright
from playwright_stealth import Stealth

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CITIES_CSV = os.path.join(BASE_DIR, "../data/processed/cities.csv")
OUTPUT_CSV = os.path.join(BASE_DIR, "../data/processed/stay_prices.csv")
FIELDNAMES = ["city_id", "checkin", "checkout", "price", "source_url"]

STAY_NIGHTS = 7
MIN_VALID_PRICE = 40000
MAX_VALID_PRICE = 5000000
PRICE_WAIT_TIMEOUT_MS = 20000


def get_hotel_dates():
    checkin = date.today() + timedelta(days=1)
    checkout = checkin + timedelta(days=STAY_NIGHTS)
    return checkin.strftime("%Y-%m-%d"), checkout.strftime("%Y-%m-%d")


def load_cities():
    """(city_id, name_ko) 목록을 반환한다."""
    with open(CITIES_CSV, encoding="utf-8-sig") as f:
        return [(row["city_id"], row["name_ko"]) for row in csv.DictReader(f)]


def _get_hotel_place_id(city_name):
    """search.naver.com에서 "네이버 호텔 {도시명}"을 검색해, 결과에 노출되는
    hotels.naver.com 링크의 지역 코드(placeSn)를 정규식으로 추출한다."""
    query = urllib.parse.quote(f"네이버 호텔 {city_name}")
    url = f"https://search.naver.com/search.naver?query={query}"

    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    })

    try:
        with urllib.request.urlopen(req) as response:
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


def scrape_lowest_hotel_price(city_name, checkin, checkout):
    """특정 도시의 체크인~체크아웃 기간 네이버 호텔 최저가를 스크래핑한다."""
    place_id = _get_hotel_place_id(city_name)
    if not place_id:
        logging.error(f"Could not find place id for {city_name}")
        return None, None

    url = f"https://hotels.naver.com/accommodation/{place_id}/hotels?checkin={checkin}&checkout={checkout}&adultCnt=1&types=HOTEL"

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
        finally:
            browser.close()

    return price, url


def append_rows(rows):
    file_exists = os.path.exists(OUTPUT_CSV)
    os.makedirs(os.path.dirname(OUTPUT_CSV), exist_ok=True)
    with open(OUTPUT_CSV, "a", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        if not file_exists:
            writer.writeheader()
        writer.writerows(rows)


def main():
    checkin, checkout = get_hotel_dates()
    cities = load_cities()
    logging.info(f"{len(cities)}개 도시 숙박 최저가 스크래핑 시작 ({checkin} ~ {checkout})")

    results_by_name = {}
    rows = []
    success_count = fail_count = 0

    for city_id, name_ko in cities:
        if name_ko in results_by_name:
            price, url = results_by_name[name_ko]
        else:
            price, url = scrape_lowest_hotel_price(name_ko, checkin, checkout)
            results_by_name[name_ko] = (price, url)
            time.sleep(random.uniform(3, 10))

        rows.append({
            "city_id": city_id,
            "checkin": checkin,
            "checkout": checkout,
            "price": price if price else "",
            "source_url": url or "",
        })

        if price:
            success_count += 1
            logging.info(f"{city_id}({name_ko}): {price:,}원")
        else:
            fail_count += 1
            logging.warning(f"{city_id}({name_ko}): 가격을 찾지 못했습니다.")

    append_rows(rows)
    logging.info(f"스크래핑 완료. 성공 {success_count} / 실패 {fail_count} -> {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
