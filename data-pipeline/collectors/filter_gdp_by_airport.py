"""
World Bank GDP 가격수준지수(PA.NUS.GDP.PLI, US=100 기준) 원본 데이터에서
airports.csv에 존재하는 국가의 값만 뽑아, 각 공항(IATA)에
국가별 최신 연도 PLI 값을 매핑한 표를 생성한다.

airports.csv의 Country 표기와 World Bank의 Country Name 표기가 달라
매칭에 필요한 별칭(alias) 매핑을 사용한다.

World Bank 데이터에 값이 아예 없는 국가(Taiwan, Guam, Northern Mariana
Islands)는 아래 MANUAL_PLI_OVERRIDES에 별도 조사한 값을 채워 넣는다.
이 값들은 World Bank의 US=100 PPP 기반 PLI와 산출 방식이 다른 근사치이므로
연도/출처를 함께 기록해 둔다.
"""

import os

import pandas as pd

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
AIRPORTS_CSV = os.path.join(BASE_DIR, "../data/processed/airports.csv")
GDP_CSV = os.path.join(BASE_DIR, "../data/raw/API_PA.NUS.GDP.PLI_DS2_en_csv_v2_2344.csv")
OUTPUT_CSV = os.path.join(BASE_DIR, "../data/processed/gdp_pli_by_airport.csv")

# airports.csv의 Country 표기 -> World Bank의 Country Name 표기
COUNTRY_ALIASES = {
    "Czech Republic": "Czechia",
    "HongKong": "Hong Kong SAR, China",
    "Italia": "Italy",
    "Laos": "Lao PDR",
    "Macao": "Macao SAR, China",
    "Republic of Korea": "Korea, Rep.",
    "Republic of Turkiye": "Turkiye",
    "United States of America": "United States",
    "Vietnam": "Viet Nam",
}

# World Bank 데이터에 존재하지 않는 국가에 대한 수동 보정값 (PLI, 연도, 근거)
# - Taiwan: World Bank 국가 목록 자체에 없음. ICP 2021년 자료(세계평균=100 기준 81.4)를
#   본 데이터셋의 US=100 기준으로 환산한 근사치.
# - Guam / Northern Mariana Islands: 미국령이라 자체 환율이 없어 PPP/환율 비율 개념의
#   PLI가 산출되지 않음. Numbeo 등 생활비 지수(미국 대비 상대값)로 대체 추정.
MANUAL_PLI_OVERRIDES = {
    "Taiwan": {"PLI": 51.0, "PLI_Year": "2021(est.)"},
    "Guam": {"PLI": 120.0, "PLI_Year": "2024(est.)"},
    "Northern Mariana Islands": {"PLI": 67.0, "PLI_Year": "2024(est.)"},
}

def latest_pli(row, year_cols):
    for year in reversed(year_cols):
        value = row[year]
        if pd.notna(value):
            return pd.Series({"PLI_Year": year, "PLI": value})
    return pd.Series({"PLI_Year": None, "PLI": None})

def main():
    airports = pd.read_csv(AIRPORTS_CSV)
    airport_countries = set(airports["Country"].dropna().unique())
    print(f"airports.csv 고유 국가 개수: {len(airport_countries)}")

    target_countries = {COUNTRY_ALIASES.get(c, c) for c in airport_countries}

    gdp = pd.read_csv(GDP_CSV, skiprows=4)
    year_cols = [c for c in gdp.columns if c.isdigit()]

    matched = gdp[gdp["Country Name"].isin(target_countries)].copy()
    matched[["PLI_Year", "PLI"]] = matched.apply(latest_pli, axis=1, year_cols=year_cols)
    country_pli = dict(zip(matched["Country Name"], matched[["PLI_Year", "PLI"]].to_dict("records")))

    for country in target_countries:
        has_value = country in country_pli and pd.notna(country_pli[country]["PLI"])
        if has_value:
            continue
        if country in MANUAL_PLI_OVERRIDES:
            country_pli[country] = MANUAL_PLI_OVERRIDES[country]
        else:
            print(f"경고: '{country}'에 대한 PLI 값을 찾지 못했습니다.")
            country_pli[country] = {"PLI_Year": None, "PLI": None}

    result = airports[["IATA", "Country"]].copy()
    result["PLI_Year"] = result["Country"].map(lambda c: country_pli.get(COUNTRY_ALIASES.get(c, c), {}).get("PLI_Year"))
    result["PLI"] = result["Country"].map(lambda c: country_pli.get(COUNTRY_ALIASES.get(c, c), {}).get("PLI"))

    result = result[["IATA", "PLI"]].sort_values("IATA")
    result.to_csv(OUTPUT_CSV, index=False, encoding="utf-8-sig")
    print(f"저장 완료: {OUTPUT_CSV} ({len(result)}행)")

if __name__ == "__main__":
    main()
