"""
환율(currencies), 항공권/숙박 최저가(flight_price_scrapes/stay_price_scrapes ->
cities 캐시), 여행경보(countries.alarm_level/special_advisory)를 한 번에 새로
스크래핑/조회해서 Supabase에 반영하는 배치 진입점.

scrapers/collectors의 기존 스크립트를 모듈로 그대로 불러와 main()을 순서대로
호출한다(로직 재구현 없음). 각 카테고리의 스크래핑 단계가 실패하면 그 카테고리의
DB 반영 단계는 건너뛰고(반영할 DataFrame 자체가 없으므로) 나머지 카테고리는 계속 진행한다.

실행 순서:
  1. 환율: exchange_scrapers.py(API -> exchange.csv) -> build_currencies.py(CSV -> currencies upsert)
  2. 항공권: flight_scraper.py(스크래핑 -> DataFrame) -> build_flights.py(DataFrame -> flight_price_scrapes upsert)
  3. 숙박: stay_scraper.py(스크래핑 -> DataFrame) -> build_stay.py(DataFrame -> stay_price_scrapes upsert)
  4. cities.flight_price/stay_price 캐시 반영: sync_city_prices.py (2, 3 중 하나라도 로그가 쌓였으면 실행)
  5. 여행경보: build_travel_alarm.py(API -> countries UPDATE, CSV 미경유)

유저가 특정 도시 갱신을 요청했을 때(API의 POST + cityId 쿼리 등)는 run_for_city(city_id)를
호출하면 위 2~5단계를 그 도시(및 도시가 속한 국가)로만 스코프를 좁혀 수행한다(환율은 도시
단위가 아니므로 제외). CLI에서는 `python main_batch.py <city_id>`로 바로 테스트할 수 있다.
"""

import logging
import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(BASE_DIR, "scrapers"))
sys.path.insert(0, os.path.join(BASE_DIR, "collectors"))

import build_currencies  # noqa: E402
import build_flights  # noqa: E402
import build_stay  # noqa: E402
import build_travel_alarm  # noqa: E402
import exchange_scrapers  # noqa: E402
import flight_scraper  # noqa: E402
import stay_scraper  # noqa: E402
import sync_city_prices  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")


def run_step(label, func):
    """func()를 실행하고 (성공 여부, 반환값)을 돌려준다.

    항공권/숙박 단계는 스크래핑 결과 DataFrame을 반환값으로 다음 단계(build_*)에
    그대로 넘겨야 하므로, 성공 여부만 boolean으로 주던 이전 방식 대신 반환값도 함께 준다.
    """
    logging.info(f"=== {label} 시작 ===")
    try:
        return True, func()
    except Exception:
        logging.exception(f"{label} 실패")
        return False, None


def main():
    if run_step("환율 스크래핑 (exchange_scrapers)", exchange_scrapers.main)[0]:
        run_step("환율 DB 반영 (build_currencies)", build_currencies.main)

    flight_ok, flight_df = run_step("항공권 스크래핑 (flight_scraper)", flight_scraper.main)
    if flight_ok:
        run_step("항공권 DB 반영 (build_flights)", lambda: build_flights.main(flight_df))

    stay_ok, stay_df = run_step("숙박 스크래핑 (stay_scraper)", stay_scraper.main)
    if stay_ok:
        run_step("숙박 DB 반영 (build_stay)", lambda: build_stay.main(stay_df))

    if flight_ok or stay_ok:
        run_step("항공권/숙박 cities 캐시 동기화 (sync_city_prices)", sync_city_prices.main)

    run_step("여행경보 스크래핑 + DB 반영 (build_travel_alarm)", build_travel_alarm.main)


def run_for_city(city_id):
    """API에서 유저가 특정 도시를 갱신 요청했을 때 그 도시 하나만 새로 돌린다.

    전체 배치(main)와 달리 환율은 도시 단위가 아니라 건너뛰고, 항공권/숙박
    스크래핑 -> DB 반영 -> cities 캐시 동기화 -> 여행경보 갱신만 city_id로
    스코프를 좁혀 수행한다.
    """
    logging.info(f"=== 단일 도시 배치 시작: {city_id} ===")

    flight_ok, flight_df = run_step(
        f"[{city_id}] 항공권 스크래핑 (flight_scraper)", lambda: flight_scraper.main(city_id)
    )
    if flight_ok:
        run_step(f"[{city_id}] 항공권 DB 반영 (build_flights)", lambda: build_flights.main(flight_df, city_id))

    stay_ok, stay_df = run_step(
        f"[{city_id}] 숙박 스크래핑 (stay_scraper)", lambda: stay_scraper.main(city_id)
    )
    if stay_ok:
        run_step(f"[{city_id}] 숙박 DB 반영 (build_stay)", lambda: build_stay.main(stay_df, city_id))

    if flight_ok or stay_ok:
        run_step(f"[{city_id}] cities 캐시 동기화 (sync_city_prices)", lambda: sync_city_prices.main(city_id))

    run_step(f"[{city_id}] 여행경보 갱신 (build_travel_alarm)", lambda: build_travel_alarm.main(city_id))


if __name__ == "__main__":
    if len(sys.argv) > 1:
        run_for_city(sys.argv[1])
    else:
        main()
