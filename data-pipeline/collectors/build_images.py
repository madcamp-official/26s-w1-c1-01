"""
cities/countries의 대표 이미지(image_url)를 채워 넣는 배치.

프런트(CityDetailPanel.tsx 등)가 지금 picsum.photos 랜덤 플레이스홀더로 때우고 있는
대표 사진을 실제 사진/국기로 교체하기 위한 것. 도시와 국가는 이미지 성격이 다르다:
  - 도시(cities): 실제 스카이라인/랜드마크 사진. 소스 우선순위는
    1) Pexels API(PEXELS_API_KEY 있을 때) - 화질 좋은 여행 사진, API 키/저작자
       표시(image_credit) 필요
    2) Wikipedia REST API(summary) - API 키 불필요하지만 국기/지도 등 사진이 아닌
       이미지가 섞여 있어 is_bad_wikipedia_image로 걸러내고 검색 폴백을 탄다
  - 국가(countries): 국기(디자인 결정) - update_countries 참고. 위키피디아 국가
    문서 인포박스가 거의 항상 국기라 그걸 그대로 쓴다(is_bad_wikipedia_image 필터
    미적용).
둘 다 이미지를 못 찾으면 해당 행은 건너뛰고(기존 값 유지) 경고만 출력한다.

image_url/image_credit 컬럼이 아직 없는 기존 DB를 위해 이 스크립트가 직접
ALTER TABLE ... ADD COLUMN IF NOT EXISTS를 실행한다(다른 collector의
CREATE TABLE IF NOT EXISTS와 같은 멱등 패턴).

cities/countries 두 테이블 다 이미 시드되어 있어야 하며, 이 스크립트는 UPDATE만
하고 INSERT는 하지 않는다(build_travel_alarm.py와 동일한 이유 - 대상 행이 이미
DB에 있어야 함).
"""

import os
import sys
import time
from urllib.parse import quote

import requests
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(BASE_DIR, "../scrapers"))
from _db import get_connection  # noqa: E402

load_dotenv(os.path.join(BASE_DIR, "../.env"))

DB_URL = os.environ.get("SUPABASE_DB_URL")
PEXELS_API_KEY = os.environ.get("PEXELS_API_KEY")

PEXELS_SEARCH_URL = "https://api.pexels.com/v1/search"
WIKIPEDIA_SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
WIKIPEDIA_SEARCH_URL = "https://en.wikipedia.org/w/api.php"
# Wikimedia REST API 정책상 연락처가 있는 User-Agent를 권장하며, 없으면 우선순위가
# 낮아져 익명 트래픽이 몰릴 때 429가 훨씬 잘 발생한다.
WIKIPEDIA_USER_AGENT = "nomadlist-data-pipeline/1.0 (yskstuff@gmail.com)"
REQUEST_SLEEP_SEC = 0.3
MAX_WIKIPEDIA_RETRIES = 2
MAX_RETRY_WAIT_SEC = 60

# 도시 이미지용 필터. 위키피디아 문서 인포박스가 실제 풍경 사진 대신 국기/문장/지도를
# 대표 이미지로 쓰는 경우가 있다(홍콩/싱가포르/마카오/괌처럼 국가=도시인 경우 등).
# 파일명에 이런 패턴이 있으면 "이미지 없음"과 동일하게 취급해 검색 폴백으로 넘긴다.
# (국가 이미지는 국기를 의도적으로 쓰므로 update_countries에서는 이 필터를 끈다.)
BAD_IMAGE_URL_KEYWORDS = [
    "flag_of", "flag of", "coat_of_arms", "coat of arms", "emblem_of", "emblem of",
    "seal_of", "seal of", "locator", "map", ".svg",
]


def is_bad_wikipedia_image(url):
    lowered = url.lower()
    return any(keyword in lowered for keyword in BAD_IMAGE_URL_KEYWORDS)


# countries.name_en은 외교부 표준코드 국문/영문 매핑용 표기라 위키피디아 문서 제목과
# 다른 경우가 있다(예: "Czech"는 국가가 아니라 동명이의 문서로 빠지고, 이미지 자체가
# 없는 disambiguation 문서라 국기조차 못 건짐. "United Arab Emirates : UAE"는 콜론이
# 들어가 있어 URL 자체가 깨진다). 국가 이미지는 의도적으로 국기를 쓰므로(아래
# update_countries 참고) is_bad_wikipedia_image 필터를 적용하지 않고, 이 두 건만
# 문서 제목 자체를 못 찾는 문제를 보정한다.
COUNTRY_WIKI_TITLE_OVERRIDES = {
    "AE": "United Arab Emirates",
    "CZ": "Czech Republic",
}

# cities.name_en으로 찾은 위키피디아 문서가 도시 사진이 아닌 엉뚱한 이미지를 내려주는
# 경우를 도시 단위로 보정한다. 이런 경우는 disambiguation 폴백(이미지가 아예 없을 때만
# 검색 재시도)만으로는 못 잡는다 - 문서 자체엔 이미지가 있고 단지 우리가 원하는 게
# 아닐 뿐이라서다(국기/지도 등은 is_bad_wikipedia_image가 걸러내지만, "{도시} city"
# 검색 폴백이 자기 자신으로 되돌아오는 소규모 도시국가/특별행정구는 그마저도 안 통한다).
#   - SGN: "Ho Chi Minh"는 위키피디아에서 기본적으로 인물(호치민) 문서라 인물 사진이
#     들어갔었다 - "Ho Chi Minh City"로 명시해야 도시 문서로 간다.
#   - TLV: "Tel Aviv Yafo"는 직접 매칭되는 문서가 없어 검색 폴백이 "Tel Aviv-Yafo
#     Municipality"(행정구역 문서)로 빠졌는데, 그 문서 대표 이미지가 사진이 아니라
#     위치를 표시한 지도(PNG)였다 - "Tel Aviv"로 명시해야 스카이라인 사진이 나온다.
#   - HKG/SIN/MFM/GUM: 국가=도시인 도시국가/특별행정구라 국가와 동일한 문제(국기 이미지).
#   - OKA: "Okinawa" 문서 대표 이미지가 오키나와현 위치를 표시한 지도(PNG)였다.
CITY_WIKI_TITLE_OVERRIDES = {
    "SGN": "Ho Chi Minh City",
    "TLV": "Tel Aviv",
    "HKG": "Victoria Harbour",
    "SIN": "Marina Bay, Singapore",
    "MFM": "Macau Tower",
    "GUM": "Tumon, Guam",
    "OKA": "Shuri Castle",
}

ALTER_COLUMNS_SQL = [
    "ALTER TABLE cities ADD COLUMN IF NOT EXISTS image_url TEXT",
    "ALTER TABLE cities ADD COLUMN IF NOT EXISTS image_credit TEXT",
    "ALTER TABLE countries ADD COLUMN IF NOT EXISTS image_url TEXT",
    "ALTER TABLE countries ADD COLUMN IF NOT EXISTS image_credit TEXT",
]


def fetch_from_pexels(query):
    if not PEXELS_API_KEY:
        return None
    try:
        res = requests.get(
            PEXELS_SEARCH_URL,
            headers={"Authorization": PEXELS_API_KEY},
            params={"query": query, "per_page": 1, "orientation": "landscape"},
            timeout=10,
        )
        res.raise_for_status()
        photos = res.json().get("photos") or []
        if not photos:
            return None
        photo = photos[0]
        return {
            "image_url": photo["src"]["large2x"],
            "image_credit": f'Photo by {photo["photographer"]} on Pexels',
        }
    except requests.RequestException as e:
        print(f"경고: Pexels 조회 실패({query}): {e}")
        return None


def search_wikipedia_title(query):
    """동명이의(disambiguation) 문서라 요약에 이미지가 없을 때, 전문 검색으로 가장
    그럴듯한 실제 문서 제목을 찾는다(예: "Niigata" -> "Niigata (city)").
    """
    try:
        res = requests.get(
            WIKIPEDIA_SEARCH_URL,
            headers={"User-Agent": WIKIPEDIA_USER_AGENT},
            params={"action": "query", "list": "search", "srsearch": query, "format": "json", "srlimit": 1},
            timeout=10,
        )
        if res.status_code != 200:
            return None
        results = (res.json().get("query") or {}).get("search") or []
        return results[0]["title"] if results else None
    except requests.RequestException:
        return None


def fetch_wikipedia_summary(title, reject_bad_images=True):
    url = WIKIPEDIA_SUMMARY_URL.format(title=quote(title.replace(" ", "_")))

    for attempt in range(MAX_WIKIPEDIA_RETRIES + 1):
        try:
            res = requests.get(url, headers={"User-Agent": WIKIPEDIA_USER_AGENT}, timeout=10)
        except requests.RequestException as e:
            print(f"경고: Wikipedia 조회 실패({title}): {e}")
            return None

        if res.status_code == 429:
            if attempt == MAX_WIKIPEDIA_RETRIES:
                print(f"경고: Wikipedia 레이트리밋으로 포기({title})")
                return None
            wait = min(int(res.headers.get("Retry-After", 30)), MAX_RETRY_WAIT_SEC)
            print(f"Wikipedia 레이트리밋 - {wait}초 대기 후 재시도({title})")
            time.sleep(wait)
            continue

        if res.status_code != 200:
            return None

        data = res.json()
        image = data.get("originalimage") or data.get("thumbnail")
        if not image or (reject_bad_images and is_bad_wikipedia_image(image["source"])):
            return None
        return {
            "image_url": image["source"],
            "image_credit": "Wikipedia",
        }

    return None


def fetch_from_wikipedia(title, search_hint=None, reject_bad_images=True):
    result = fetch_wikipedia_summary(title, reject_bad_images=reject_bad_images)
    if result:
        return result

    if not search_hint:
        return None

    resolved_title = search_wikipedia_title(search_hint)
    if not resolved_title or resolved_title.lower() == title.lower():
        return None

    time.sleep(REQUEST_SLEEP_SEC)
    return fetch_wikipedia_summary(resolved_title, reject_bad_images=reject_bad_images)


def fetch_image(pexels_query, wiki_title, wiki_search_hint=None):
    return fetch_from_pexels(pexels_query) or fetch_from_wikipedia(wiki_title, search_hint=wiki_search_hint)


def ensure_columns(conn):
    with conn.cursor() as cur:
        for sql in ALTER_COLUMNS_SQL:
            cur.execute(sql)
    conn.commit()


def update_cities(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT city_id, name_en FROM cities WHERE image_url IS NULL ORDER BY city_id")
        rows = cur.fetchall()

    updated = 0
    with conn.cursor() as cur:
        for city_id, name_en in rows:
            wiki_title = CITY_WIKI_TITLE_OVERRIDES.get(city_id, name_en)
            result = fetch_image(f"{name_en} city skyline", wiki_title, wiki_search_hint=f"{name_en} city")
            time.sleep(REQUEST_SLEEP_SEC)
            if not result:
                print(f"경고: 이미지 못 찾음 - city {city_id}({name_en})")
                continue
            cur.execute(
                "UPDATE cities SET image_url = %s, image_credit = %s, updated_at = now() WHERE city_id = %s",
                (result["image_url"], result["image_credit"], city_id),
            )
            updated += 1
    conn.commit()

    print(f"cities 이미지 갱신 완료 ({updated}/{len(rows)}개)")


def update_countries(conn):
    """국가 이미지는 랜드마크 사진이 아니라 국기를 쓴다(디자인 결정) - 위키피디아
    국가 문서의 인포박스 이미지가 거의 항상 국기라, Pexels/사진 검색 없이 위키피디아
    문서를 그대로 받아 쓰되 국기 이미지를 걸러내는 is_bad_wikipedia_image 필터만
    끈다.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT country_id, name_en FROM countries WHERE image_url IS NULL ORDER BY country_id")
        rows = cur.fetchall()

    updated = 0
    with conn.cursor() as cur:
        for country_id, name_en in rows:
            wiki_title = COUNTRY_WIKI_TITLE_OVERRIDES.get(country_id, name_en)
            result = fetch_from_wikipedia(wiki_title, search_hint=f"{name_en} country", reject_bad_images=False)
            time.sleep(REQUEST_SLEEP_SEC)
            if not result:
                print(f"경고: 이미지 못 찾음 - country {country_id}({name_en})")
                continue
            cur.execute(
                "UPDATE countries SET image_url = %s, image_credit = %s, updated_at = now() WHERE country_id = %s",
                (result["image_url"], result["image_credit"], country_id),
            )
            updated += 1
    conn.commit()

    print(f"countries 이미지 갱신 완료 ({updated}/{len(rows)}개)")


def main():
    if not PEXELS_API_KEY:
        print("PEXELS_API_KEY 미설정 - Wikipedia만으로 이미지를 채웁니다(화질/커버리지가 Pexels보다 낮을 수 있음).")

    connection, owns_conn = get_connection(DB_URL)
    try:
        ensure_columns(connection)
        update_cities(connection)
        update_countries(connection)
    finally:
        if owns_conn:
            connection.close()


if __name__ == "__main__":
    main()
