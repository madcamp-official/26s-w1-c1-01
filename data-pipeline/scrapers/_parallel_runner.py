"""
flight_scraper.py/stay_scraper.py의 main_parallel()이 각자 구현하던 보일러플레이트
(대상 목록을 workers개 청크로 나눠 ProcessPoolExecutor로 동시 처리하고 rows를 합치는
로직)를 공통화한 헬퍼. 목적지가 하나뿐이면 프로세스 풀을 띄우지 않고 바로 처리한다.

봇 탐지 회피용 목적지/도시 간 랜덤 딜레이 범위(초)도 여기서 공유한다 - 값을 늘리면
안전하지만 느려지고, 줄이면 빠르지만 차단 위험이 커진다. 두 스크래퍼 모두 3~10초로
맞춰 왔던 값을 그대로 상수화한 것.
"""

from concurrent.futures import ProcessPoolExecutor

SCRAPE_DELAY_RANGE = (3, 10)


def run_sequential_or_parallel(items, worker_fn, workers, *worker_args):
    """items가 1개 이하면 worker_fn(items, *worker_args)을 바로 호출하고,
    그보다 많으면 workers개 프로세스로 나눠 동시에 처리해 rows를 합쳐 반환한다."""
    if len(items) <= 1:
        return worker_fn(items, *worker_args)

    workers = min(workers, len(items))
    chunks = [items[i::workers] for i in range(workers)]

    rows = []
    with ProcessPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(worker_fn, chunk, *worker_args) for chunk in chunks]
        for future in futures:
            rows.extend(future.result())

    return rows
