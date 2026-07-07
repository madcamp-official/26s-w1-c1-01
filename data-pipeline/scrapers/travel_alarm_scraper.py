"""
공공데이터포털의 외교부_여행경보제도(TravelWarningServiceV3) API에서
국가별 여행경보 단계와 특이사항을 수집해 data/processed/travel_alarm.csv 로 저장한다.

countries.alarm_level / countries.special_advisory는 currencies.exchange_rate와
같은 성격의 "배치로 갱신되는 현재값"이라, 원본 로그를 쌓지 않고 최신 상태만
CSV에 담아 collectors/build_countries.py가 병합하도록 한다.

인증키(MOFA_TRAVEL_ALARM_KEY)는 data.go.kr에서 "외교부_여행경보제도" 활용신청 후
발급받아 저장소에 커밋되지 않는 .env 파일에 넣는다. data.go.kr이 내려주는 키는
이미 퍼센트 인코딩된 상태라 requests에 그대로 넘기면 이중 인코딩되어 401이
발생하므로 unquote로 한 번 풀어서 사용한다.

API는 국가를 ISO 3166-1 alpha-3(iso_code)로 식별하고, 레벨은 국가 전체 발령
여부(attention/control/limita/ban_yna)와 일부 지역 발령 여부
(attention_partial/control_partial/limita_partial/ban_yn_partial)를 각각의
필드로 내려준다. 두 필드 중 하나라도 값이 있으면 해당 단계가 발령된 것으로 보고,
발령된 단계 중 가장 높은 것을 국가 단위 alarm_level로 요약한다.
"""

import csv
import html
import os
from urllib.parse import unquote

import requests
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, "../.env"))

API_URL = "http://apis.data.go.kr/1262000/TravelWarningServiceV3/getTravelWarningListV3"
AUTH_KEY = unquote(os.environ.get("MOFA_TRAVEL_ALARM_KEY", ""))
OUTPUT_CSV = os.path.join(BASE_DIR, "../data/processed/travel_alarm.csv")
NUM_OF_ROWS = 300

# (alarm_level, 전역 발령 필드, 사유/지역 필드, 부분 발령 필드) — 숫자가 클수록 높은 단계
LEVELS = [
    (1, "attention", "attention_note", "attention_partial"),
    (2, "control", "control_note", "control_partial"),
    (3, "limita", "limita_note", "limita_partial"),
    (4, "ban_yna", "ban_note", "ban_yn_partial"),
]


def summarize_alarm(item):
    """발령된 단계 중 가장 높은 단계를 (alarm_level, special_advisory)로 요약한다."""
    highest = None
    for level, full_field, note_field, partial_field in LEVELS:
        label = item.get(full_field) or item.get(partial_field)
        if label:
            note = item.get(note_field) or ""
            highest = (level, f"{label}: {note}" if note else label)

    if highest is None:
        return 0, None
    level, advisory = highest
    return level, html.unescape(advisory)[:255]


def fetch_page(page_no):
    params = {
        "serviceKey": AUTH_KEY,
        "numOfRows": NUM_OF_ROWS,
        "pageNo": page_no,
        "returnType": "JSON",
    }
    response = requests.get(API_URL, params=params, timeout=10)
    response.raise_for_status()
    return response.json()


def fetch_all_alarms():
    if not AUTH_KEY:
        raise RuntimeError("MOFA_TRAVEL_ALARM_KEY가 설정되어 있지 않습니다. data-pipeline/.env를 확인하세요.")

    items = []
    page_no = 1
    while True:
        body = fetch_page(page_no)["response"]["body"]
        page_items = body["items"]["item"] if body.get("items") else []
        if isinstance(page_items, dict):
            page_items = [page_items]
        if not page_items:
            break
        items.extend(page_items)
        if len(items) >= body.get("totalCount", 0):
            break
        page_no += 1

    return items


def main():
    items = fetch_all_alarms()

    result = []
    for item in items:
        iso3 = item.get("iso_code")
        if not iso3:
            continue
        alarm_level, special_advisory = summarize_alarm(item)
        result.append({
            "iso_alpha3": iso3.upper(),
            "alarm_level": alarm_level,
            "special_advisory": special_advisory,
        })

    os.makedirs(os.path.dirname(OUTPUT_CSV), exist_ok=True)
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=["iso_alpha3", "alarm_level", "special_advisory"])
        writer.writeheader()
        writer.writerows(result)

    print(f"저장 완료: {OUTPUT_CSV} ({len(result)}개국)")


if __name__ == "__main__":
    main()
