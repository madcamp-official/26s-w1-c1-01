"""
openflights export의 To 컬럼에서 고유 IATA 코드를 추출하고,
공항코드집.csv에서 해당 IATA에 매칭되는 공항 정보를 뽑아
IATA를 기본키로 하는 공항 DB(csv)를 생성한다.

스키마: IATA, Country, City, Name_kor, Name_eng
"""

import os

import pandas as pd

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OPENFLIGHTS_CSV = os.path.join(BASE_DIR, "../data/raw/openflights-export-2026-07-04-1120.csv")
AIRPORT_CODE_CSV = os.path.join(BASE_DIR, "../data/raw/공항코드집.csv")
OUTPUT_CSV = os.path.join(BASE_DIR, "../data/processed/airports.csv")

def main():
    flights = pd.read_csv(OPENFLIGHTS_CSV)
    target_iata = set(flights["To"].dropna().unique())
    print(f"openflights 'To' 고유 IATA 개수: {len(target_iata)}")

    codes = pd.read_csv(AIRPORT_CODE_CSV)
    codes = codes.rename(columns={
        "국가": "Country",
        "도시": "City",
        "국문 공항명": "Name_kor",
        "영문 공항명": "Name_eng",
    })

    matched = codes[codes["IATA"].isin(target_iata)].copy()
    matched = matched.drop_duplicates()

    dup_iata = matched[matched["IATA"].duplicated(keep=False)]
    if not dup_iata.empty:
        print("경고: 동일 IATA에 서로 다른 공항 정보가 존재하여 첫 항목만 유지합니다.")
        print(dup_iata.sort_values("IATA")[["IATA", "Name_kor", "Name_eng", "City", "Country"]].to_string(index=False))
    matched = matched.drop_duplicates(subset="IATA", keep="first")

    missing = target_iata - set(matched["IATA"])
    if missing:
        print(f"경고: 공항코드집에서 매칭되지 않은 IATA {len(missing)}개: {sorted(missing)}")

    result = matched[["IATA", "Country", "City", "Name_kor", "Name_eng"]].sort_values("IATA")
    result.to_csv(OUTPUT_CSV, index=False, encoding="utf-8-sig")
    print(f"저장 완료: {OUTPUT_CSV} ({len(result)}행)")

if __name__ == "__main__":
    main()
