"""
countries 테이블 시드 데이터를 raw 데이터에서 조립한다.

수집 대상 국가는 collectors/merge_airport_db.py의 결과물인
data/processed/airports.csv(openflights 'To' 기준 ICN 취항 공항)에 등장하는
국가로 한정한다. 즉 이 스크립트를 먼저 실행해 airports.csv를 만들어 둬야 한다.

- 국가명(한글/영문), ISO 3166-1 alpha-2: 외교부_국가_지역별 표준코드
  (airports.csv의 국가 표기가 다른 5개국은 COUNTRY_ALIASES로 보정)
- 지도 중심 좌표(center_lat/center_lng): average-latitude-longitude-countries.csv
- currency_code: exchange_rates.csv(수출입은행, 23개 주요 통화)만 커버한다.
  CURRENCY_ISSUER/EUROZONE에 없는 통화를 쓰는 국가(캄보디아, 베트남, 러시아,
  대만, 인도 등)는 currency_code를 NULL로 두고 이후 통화 데이터가 보강되면 채운다.
- alarm_level/special_advisory: scrapers/travel_alarm_scraper.py가 만든
  data/processed/travel_alarm.csv가 있으면 병합하고, 없으면 기본값(0, NULL)을 쓴다.
  이 스크래퍼는 국가를 ISO 3166-1 alpha-3(iso_code)로 식별하므로, 외교부
  표준코드의 ISO(3자리) 컬럼으로 country_id(alpha-2)와 연결한다.
"""

import os

import pandas as pd

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
AIRPORTS_CSV = os.path.join(BASE_DIR, "../data/processed/airports.csv")
MOFA_CSV = os.path.join(BASE_DIR, "../data/raw/외교부_국가_지역별 표준코드_20240716.csv")
LATLNG_CSV = os.path.join(BASE_DIR, "../data/raw/average-latitude-longitude-countries.csv")
EXCHANGE_RATES_CSV = os.path.join(BASE_DIR, "../data/processed/exchange_rates.csv")
TRAVEL_ALARM_CSV = os.path.join(BASE_DIR, "../data/processed/travel_alarm.csv")
OUTPUT_CSV = os.path.join(BASE_DIR, "../data/processed/countries.csv")

# airports.csv의 Country 표기 -> 외교부 국가명(영문) 표기
COUNTRY_ALIASES = {
    "Czech Republic": "Czech",
    "HongKong": "Hongkong",
    "Republic of Korea": "Korea",
    "Russian Federation": "Russia",
    "United Arab Emirates": "United Arab Emirates : UAE",
}

# 유로존 20개국(2023년 크로아티아 가입 이후 기준). EUR 외 통화는 발행국이 1곳뿐이라
# exchange_rates.csv의 currencyCode를 그대로 발행국 ISO2에 매핑한다.
EUROZONE = ["AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE",
            "IT", "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES"]

CURRENCY_ISSUER = {
    "AED": "AE", "AUD": "AU", "BHD": "BH", "BND": "BN", "CAD": "CA",
    "CHF": "CH", "CNH": "CN", "DKK": "DK", "GBP": "GB", "HKD": "HK",
    "IDR": "ID", "JPY": "JP", "KRW": "KR", "KWD": "KW", "MYR": "MY",
    "NOK": "NO", "NZD": "NZ", "SAR": "SA", "SEK": "SE", "SGD": "SG",
    "THB": "TH", "USD": "US",
}


def build_currency_by_country(available_currency_codes):
    currency_by_country = {
        iso2: code
        for code, iso2 in CURRENCY_ISSUER.items()
        if code in available_currency_codes
    }
    if "EUR" in available_currency_codes:
        currency_by_country.update({iso2: "EUR" for iso2 in EUROZONE})
    return currency_by_country


def main():
    airports = pd.read_csv(AIRPORTS_CSV)
    target_names = pd.Series(airports["Country"].dropna().unique(), name="airport_name")
    target = pd.DataFrame({
        "airport_name": target_names,
        "name_en": target_names.map(lambda c: COUNTRY_ALIASES.get(c, c)),
    })
    print(f"airports.csv 고유 국가 개수: {len(target)}")

    mofa = pd.read_csv(MOFA_CSV, encoding="utf-16", sep="\t")
    mofa = mofa.rename(columns={
        "국가명(영문)": "name_en",
        "국가명(국문)": "name_ko",
        "ISO(2자리)": "country_id",
        "ISO(3자리)": "iso3",
    })[["country_id", "iso3", "name_ko", "name_en"]].dropna(subset=["country_id"])

    countries = target.merge(mofa, on="name_en", how="left")
    unmatched = countries[countries["country_id"].isna()]["airport_name"].tolist()
    if unmatched:
        print(f"경고: 외교부 표준코드에서 매칭되지 않은 국가 {len(unmatched)}개: {unmatched}")
    countries = countries.dropna(subset=["country_id"]).drop(columns=["airport_name"])

    latlng = pd.read_csv(LATLNG_CSV).rename(columns={
        "ISO 3166 Country Code": "country_id",
        "Latitude": "center_lat",
        "Longitude": "center_lng",
    })[["country_id", "center_lat", "center_lng"]]

    countries = countries.merge(latlng, on="country_id", how="left")
    missing_latlng = countries[countries["center_lat"].isna()]["country_id"].tolist()
    if missing_latlng:
        print(f"경고: 위경도 매칭 안 된 국가 {len(missing_latlng)}개: {missing_latlng}")

    exchange_rates = pd.read_csv(EXCHANGE_RATES_CSV)
    currency_by_country = build_currency_by_country(set(exchange_rates["currencyCode"]))
    countries["currency_code"] = countries["country_id"].map(currency_by_country)

    no_currency = countries[countries["currency_code"].isna()]["country_id"].tolist()
    print(f"통화 매핑 없어 currency_code NULL인 국가 {len(no_currency)}개: {sorted(no_currency)}")

    countries["alarm_level"] = 0
    countries["special_advisory"] = None
    if os.path.exists(TRAVEL_ALARM_CSV):
        alarms = pd.read_csv(TRAVEL_ALARM_CSV).rename(columns={"iso_alpha3": "iso3"})
        countries = countries.merge(alarms, on="iso3", how="left", suffixes=("", "_scraped"))
        countries["alarm_level"] = countries["alarm_level_scraped"].fillna(0).astype(int)
        countries["special_advisory"] = countries["special_advisory_scraped"]
        countries = countries.drop(columns=["alarm_level_scraped", "special_advisory_scraped"])
        no_alarm_data = countries[countries["special_advisory"].isna() & (countries["alarm_level"] == 0)]["country_id"].tolist()
        print(f"여행경보 데이터 없어 alarm_level=0으로 둔 국가 {len(no_alarm_data)}개: {sorted(no_alarm_data)}")
    else:
        print(f"경고: {TRAVEL_ALARM_CSV}가 없어 alarm_level=0/special_advisory=NULL로 채웁니다.")

    columns = ["country_id", "name_ko", "name_en", "center_lat", "center_lng",
               "currency_code", "alarm_level", "special_advisory"]
    countries = countries[columns].sort_values("country_id")

    os.makedirs(os.path.dirname(OUTPUT_CSV), exist_ok=True)
    countries.to_csv(OUTPUT_CSV, index=False, encoding="utf-8-sig")
    print(f"저장 완료: {OUTPUT_CSV} ({len(countries)}개국)")


if __name__ == "__main__":
    main()
