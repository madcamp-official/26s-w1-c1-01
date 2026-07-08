"""
psycopg2 커넥션을 새로 열거나, 이미 열려 있는 커넥션을 재사용하기 위한 공통 헬퍼.

main_batch.run_for_city처럼 한 도시에 대해 여러 단계(스크래핑 대상 조회, 로그 upsert,
캐시 동기화, 여행경보 갱신)를 이어서 실행할 때, 단계마다 새 커넥션을 여는 대신 하나를
공유해서 쓸 수 있게 한다. conn을 넘기지 않으면 각 함수가 기존처럼 자체 커넥션을 열고
닫는다 - 스크립트를 단독 실행할 때의 동작은 그대로 유지된다.
"""

import psycopg2


def get_connection(db_url, conn=None):
    """conn이 있으면 그대로 재사용하고, 없으면 db_url로 새로 연다.

    반환값: (connection, 이 함수가 새로 열었는지 여부). 새로 연 경우에만 호출부가
    commit/close를 책임지고, 재사용한 경우에는 커넥션을 공유한 상위 호출부(예:
    main_batch.run_for_city)가 생명주기를 관리한다.
    """
    if conn is not None:
        return conn, False
    if not db_url:
        raise RuntimeError("SUPABASE_DB_URL이 설정되어 있지 않습니다. data-pipeline/.env를 확인하세요.")
    return psycopg2.connect(db_url), True
