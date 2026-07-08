"""
build_flights.py/build_stay.py가 거의 동일하게 구현하던 "스크래핑 원본 로그를
Supabase에 upsert" 로직(city_id 필터링, NaN -> None 정리, CREATE TABLE/INDEX 실행,
executemany + commit)을 공통화한 헬퍼.

각 파일은 자신의 CREATE_TABLE_SQL/CREATE_INDEX_SQL/UPSERT_SQL과 NaN 정리가 필요한
컬럼 목록만 정의하고, 실제 실행은 이 모듈의 upsert_scrape_log()에 위임한다.
"""

import pandas as pd

from _db import get_connection


def rows_from_df(df, nullable_cols, city_id=None):
    """city_id가 있으면 해당 도시의 마지막 행(가장 최근 스크랩)만 남기고,
    price/nullable_cols에 대해 NaN을 None으로 정리한 딕셔너리 리스트를 반환한다."""
    if city_id:
        df = df[df["city_id"] == city_id].tail(1)

    rows = df.to_dict("records")
    for row in rows:
        if "price" in row:
            row["price"] = int(row["price"]) if pd.notna(row["price"]) else None
        for col in nullable_cols:
            row[col] = row[col] if pd.notna(row[col]) else None

    return rows


def upsert_scrape_log(df, db_url, create_table_sql, create_index_sql, upsert_sql,
                        nullable_cols, table_label, city_id=None, conn=None):
    """df를 city_id 스코프로 정리해 upsert_sql로 upsert한다.

    conn을 주면 그 커넥션을 재사용하고 commit/close는 호출부(main_batch.run_for_city 등)가
    책임진다. conn이 없으면 이 함수가 직접 커넥션을 열고 commit 후 닫는다(단독 실행 시
    기존 build_flights.py/build_stay.py와 동일한 동작).
    """
    rows = rows_from_df(df, nullable_cols, city_id=city_id)

    connection, owns_conn = get_connection(db_url, conn)
    try:
        with connection.cursor() as cur:
            cur.execute(create_table_sql)
            if create_index_sql:
                cur.execute(create_index_sql)
            cur.executemany(upsert_sql, rows)
        if owns_conn:
            connection.commit()
    finally:
        if owns_conn:
            connection.close()

    print(f"Supabase {table_label} 테이블 upsert 완료 ({len(rows)}행)")
    return rows
