"""
cities 테이블 시드 데이터를 raw/processed 데이터에서 조립해 Supabase(Postgres)에
생성/upsert한다. 아래 순서로 먼저 생성되어 있어야 한다:

  1. merge_airport_db.py         -> data/processed/airports.csv
  2. filter_gdp_by_airport.py    -> data/processed/gdp_pli_by_airport.csv
  3. build_countries.py          -> data/processed/countries.csv (country_id 조인용)

컬럼별 출처:
  - city_id/name_en : airports.csv의 IATA/City (cityId는 IATA 코드를 그대로 재사용)
  - name_ko         : 공식 번역 마스터 데이터가 아직 없어 NAME_KO 표에 수동으로 채운
                       도시명 한글 표기 (airports.csv의 Name_kor는 "OO 국제공항" 같은
                       공항명이라 도시명과 다름)
  - country_id      : build_countries.py와 동일한 COUNTRY_ALIASES로 name_en을 맞춰
                       countries.csv에 조인
  - lat/lng         : data/raw/worldcities.csv를 (City, Country)로 조인, 표기가 달라
                       매칭 안 되는 15개 공항은 LATLNG_OVERRIDES에 수동으로 채움
  - meal_price      : 실제 식비 데이터가 없어 collectors/filter_gdp_by_airport.py가
                       만든 국가별 PLI(가격수준지수)값을 임시로 대입한다. KRW 금액이
                       아니라 US=100 기준 지수이므로, 실제 식비 데이터가 들어오면
                       반드시 교체해야 한다.
  - flight_price/stay_price : 아직 스크래핑 연동 전이라 NULL

접속 문자열은 Supabase 프로젝트 > Project Settings > Database > Connection string
에서 받아 data-pipeline/.env의 SUPABASE_DB_URL에 넣는다. DB 자격 증명이므로
저장소에는 절대 커밋하지 않는다.
"""

import os

import pandas as pd
import psycopg2
from dotenv import load_dotenv

from build_countries import COUNTRY_ALIASES

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, "../.env"))

AIRPORTS_CSV = os.path.join(BASE_DIR, "../data/processed/airports.csv")
COUNTRIES_CSV = os.path.join(BASE_DIR, "../data/processed/countries.csv")
PLI_CSV = os.path.join(BASE_DIR, "../data/processed/gdp_pli_by_airport.csv")
WORLDCITIES_CSV = os.path.join(BASE_DIR, "../data/raw/worldcities.csv")
OUTPUT_CSV = os.path.join(BASE_DIR, "../data/processed/cities.csv")

DB_URL = os.environ.get("SUPABASE_DB_URL")

# airports.csv의 Country 표기 -> worldcities.csv의 country 표기
WC_COUNTRY_ALIASES = {
    "United States of America": "United States",
    "Republic of Korea": "Korea, South",
    "HongKong": "Hong Kong",
    "Czech Republic": "Czechia",
    "Italia": "Italy",
    "Republic of Turkiye": "Turkey",
    "Russian Federation": "Russia",
    "Myanmar": "Burma",
    "Macao": "Macau",
}

# worldcities.csv와 도시명 표기가 달라 조인이 안 되는 공항들의 수동 좌표 보정
# (도시 대표 좌표 기준)
LATLNG_OVERRIDES = {
    "CEB": (10.3157, 123.8854),   # Cebu
    "CRK": (15.1450, 120.5887),   # Angeles/Mabalacat (Clark)
    "DAD": (16.0544, 108.2022),   # Da Nang
    "DPS": (-8.6705, 115.2126),   # Denpasar (Bali)
    "GUM": (13.4443, 144.7937),   # Guam (Hagatna)
    "KIX": (34.6937, 135.5023),   # Osaka
    "LED": (59.9311, 30.3609),    # St Petersburg
    "LJG": (26.8721, 100.2240),   # Lijiang
    "MFM": (22.1987, 113.5439),   # Macao
    "OIT": (33.2382, 131.6126),   # Oita
    "RGN": (16.8409, 96.1735),    # Yangon
    "SGN": (10.8231, 106.6297),   # Ho Chi Minh City
    "SPN": (15.1780, 145.7500),   # Saipan
    "TLV": (32.0853, 34.7818),    # Tel Aviv
    "XIY": (34.3416, 108.9398),   # Xian
}

# 도시명 한글 표기 (IATA 기준). 공식 번역 마스터 데이터가 생기면 이 표를 대체한다.
NAME_KO = {
    "AKL": "오클랜드", "ALA": "알마티", "AMS": "암스테르담", "AOJ": "아오모리",
    "ATL": "애틀랜타", "AUH": "아부다비", "AXT": "아키타", "BKI": "코타키나발루",
    "BKK": "방콕", "BNE": "브리즈번", "BOM": "뭄바이", "CAN": "광저우",
    "CDG": "파리", "CEB": "세부", "CGK": "자카르타", "CGO": "정저우",
    "CGQ": "창춘", "CJU": "제주", "CKG": "충칭", "CMB": "콜롬보",
    "CNX": "치앙마이", "CRK": "앙헬레스(클라크)", "CSX": "창사", "CTS": "삿포로",
    "CTU": "청두", "DAD": "다낭", "DEL": "델리", "DFW": "댈러스",
    "DLC": "다롄", "DOH": "도하", "DPS": "덴파사르(발리)", "DTW": "디트로이트",
    "DXB": "두바이", "FRA": "프랑크푸르트", "FSZ": "시즈오카", "FUK": "후쿠오카",
    "GUM": "괌", "HAN": "하노이", "HEL": "헬싱키", "HFE": "허페이",
    "HGH": "항저우", "HIJ": "히로시마", "HKG": "홍콩", "HKT": "푸켓",
    "HND": "도쿄", "HNL": "호놀룰루", "HRB": "하얼빈", "HSG": "사가",
    "IAD": "워싱턴", "IAH": "휴스턴", "ISL": "이스탄불", "JFK": "뉴욕",
    "KHH": "가오슝", "KHN": "난창", "KHV": "하바롭스크", "KIJ": "니가타",
    "KIX": "오사카", "KLO": "칼리보", "KMG": "쿤밍", "KMI": "미야자키",
    "KMJ": "구마모토", "KMQ": "고마쓰", "KOJ": "가고시마", "KTM": "카트만두",
    "KUL": "쿠알라룸푸르", "KWL": "구이린", "LAS": "라스베이거스", "LAX": "로스앤젤레스",
    "LED": "상트페테르부르크", "LHR": "런던", "LJG": "리장", "MAD": "마드리드",
    "MDG": "무단장", "MFM": "마카오", "MNL": "마닐라", "MUC": "뮌헨",
    "MXP": "밀라노", "MYJ": "마쓰야마", "NAN": "난디", "NBO": "나이로비",
    "NGB": "닝보", "NGO": "나고야", "NGS": "나가사키", "NKG": "난징",
    "NRT": "도쿄", "OIT": "오이타", "OKA": "오키나와", "OKJ": "오카야마",
    "ORD": "시카고", "PEK": "베이징", "PNH": "프놈펜", "PRG": "프라하",
    "PVG": "상하이", "RGN": "양곤", "ROR": "코로르", "RUH": "리야드",
    "SDJ": "센다이", "SEA": "시애틀", "SFO": "샌프란시스코", "SGN": "호치민",
    "SHE": "선양", "SIN": "싱가포르", "SPN": "사이판", "SVO": "모스크바",
    "SYD": "시드니", "SZX": "선전", "TAE": "대구", "TAK": "다카마쓰",
    "TAO": "칭다오", "TAS": "타슈켄트", "TLV": "텔아비브", "TNA": "지난",
    "TOY": "도야마", "TPE": "타이베이", "TSN": "톈진", "TXN": "황산",
    "UBJ": "우베", "ULN": "울란바토르", "UUS": "유즈노사할린스크", "VIE": "빈",
    "VTE": "비엔티안", "VVO": "블라디보스토크", "WUH": "우한", "XIY": "시안",
    "XMN": "샤먼", "YGJ": "요나고", "YNJ": "옌지", "YNT": "옌타이",
    "YVR": "밴쿠버", "YYZ": "토론토",
}

CREATE_TABLE_SQL = '''
    CREATE TABLE IF NOT EXISTS cities (
        city_id      CHAR(3) PRIMARY KEY,
        name_ko      VARCHAR(100) NOT NULL,
        name_en      VARCHAR(100) NOT NULL,
        country_id   CHAR(2) NOT NULL REFERENCES countries(country_id),
        lat          NUMERIC(8,6) NOT NULL,
        lng          NUMERIC(9,6) NOT NULL,
        meal_price   INTEGER,
        flight_price INTEGER,
        stay_price   INTEGER,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
'''
CREATE_INDEX_SQL = "CREATE INDEX IF NOT EXISTS idx_cities_country_id ON cities(country_id)"

UPSERT_SQL = '''
    INSERT INTO cities (city_id, name_ko, name_en, country_id, lat, lng, meal_price, flight_price, stay_price, updated_at)
    VALUES (%(city_id)s, %(name_ko)s, %(name_en)s, %(country_id)s, %(lat)s, %(lng)s, %(meal_price)s, %(flight_price)s, %(stay_price)s, now())
    ON CONFLICT (city_id) DO UPDATE SET
        name_ko      = EXCLUDED.name_ko,
        name_en      = EXCLUDED.name_en,
        country_id   = EXCLUDED.country_id,
        lat          = EXCLUDED.lat,
        lng          = EXCLUDED.lng,
        meal_price   = EXCLUDED.meal_price,
        flight_price = EXCLUDED.flight_price,
        stay_price   = EXCLUDED.stay_price,
        updated_at   = now()
'''


def build_cities():
    airports = pd.read_csv(AIRPORTS_CSV)

    missing_name_ko = set(airports["IATA"]) - set(NAME_KO)
    if missing_name_ko:
        print(f"경고: NAME_KO에 없는 IATA {len(missing_name_ko)}개: {sorted(missing_name_ko)}")
    airports["name_ko"] = airports["IATA"].map(NAME_KO)

    countries = pd.read_csv(COUNTRIES_CSV)
    airports["name_en_country"] = airports["Country"].map(lambda c: COUNTRY_ALIASES.get(c, c))
    airports = airports.merge(
        countries[["country_id", "name_en"]].rename(columns={"name_en": "name_en_country"}),
        on="name_en_country", how="left",
    )
    missing_country = airports[airports["country_id"].isna()]["Country"].unique()
    if len(missing_country):
        print(f"경고: country_id 매칭 안 된 국가: {list(missing_country)}")

    worldcities = pd.read_csv(WORLDCITIES_CSV)
    worldcities = worldcities.sort_values("population", ascending=False).drop_duplicates(
        subset=["city", "country"], keep="first"
    )
    airports["wc_country"] = airports["Country"].map(lambda c: WC_COUNTRY_ALIASES.get(c, c))
    airports = airports.merge(
        worldcities[["city", "country", "lat", "lng"]],
        left_on=["City", "wc_country"], right_on=["city", "country"], how="left",
    )
    for iata, (lat, lng) in LATLNG_OVERRIDES.items():
        mask = airports["IATA"] == iata
        airports.loc[mask, "lat"] = lat
        airports.loc[mask, "lng"] = lng
    missing_latlng = airports[airports["lat"].isna()]["IATA"].tolist()
    if missing_latlng:
        print(f"경고: 위경도 없는 IATA {len(missing_latlng)}개: {missing_latlng}")

    pli = pd.read_csv(PLI_CSV)
    airports = airports.merge(pli, on="IATA", how="left")
    airports["meal_price"] = airports["PLI"].round().astype("Int64")
    missing_pli = airports[airports["meal_price"].isna()]["IATA"].tolist()
    if missing_pli:
        print(f"경고: PLI(meal_price 대체값) 없는 IATA {len(missing_pli)}개: {missing_pli}")

    airports["flight_price"] = None
    airports["stay_price"] = None

    cities = airports.rename(columns={"IATA": "city_id", "Name_eng": "_unused_name_en_airport"})
    cities["name_en"] = airports["City"]

    columns = ["city_id", "name_ko", "name_en", "country_id", "lat", "lng",
               "meal_price", "flight_price", "stay_price"]
    return cities[columns].sort_values("city_id")


def upsert_cities(rows):
    if not DB_URL:
        raise RuntimeError("SUPABASE_DB_URL이 설정되어 있지 않습니다. data-pipeline/.env를 확인하세요.")

    conn = psycopg2.connect(DB_URL)
    try:
        with conn.cursor() as cur:
            cur.execute(CREATE_TABLE_SQL)
            cur.execute(CREATE_INDEX_SQL)
            cur.executemany(UPSERT_SQL, rows)
        conn.commit()
    finally:
        conn.close()


def main():
    cities = build_cities()

    os.makedirs(os.path.dirname(OUTPUT_CSV), exist_ok=True)
    cities.to_csv(OUTPUT_CSV, index=False, encoding="utf-8-sig")
    print(f"저장 완료: {OUTPUT_CSV} ({len(cities)}개 도시)")

    rows = cities.where(pd.notna(cities), None).to_dict("records")
    upsert_cities(rows)
    print(f"Supabase cities 테이블 upsert 완료 ({len(rows)}개 도시)")


if __name__ == "__main__":
    main()
