# backend(Express) + data-pipeline(Python/Playwright)를 한 컨테이너에서 실행한다.
# cityBatchRunner.js가 python main_batch.py를 같은 파일시스템의 자식 프로세스로
# spawn하는 구조라, 컨테이너를 나누지 않고 하나로 합쳐야 코드 수정 없이 그대로 동작한다.
FROM mcr.microsoft.com/playwright/python:v1.47.0-jammy

# curl 설치 후 Node.js 설치 (Express 백엔드 실행 + 헬스체크용)
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 파이썬 의존성 (data-pipeline)
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# requirements.txt가 playwright 버전을 고정하지 않아서, 베이스 이미지에 미리
# 설치된 브라우저 버전과 pip이 새로 받은 playwright 버전이 어긋날 수 있다.
# 여기서 다시 install해서 pip으로 실제 설치된 버전에 브라우저를 맞춘다.
RUN playwright install --with-deps chromium

# 백엔드 의존성 (package*.json만 먼저 복사해서 레이어 캐시 활용)
COPY backend/package.json backend/package-lock.json backend/
RUN npm ci --omit=dev --prefix backend

# 소스 복사
COPY data-pipeline ./data-pipeline
COPY backend ./backend

# .env는 이미지에 넣지 않는다(.dockerignore로 제외). docker-compose의 env_file로
# 런타임에 주입한다 — main_batch.py는 자식 프로세스로 실행되며 부모(Node)의
# 환경변수를 그대로 물려받으므로 이렇게만 해도 SUPABASE_DB_URL 등을 읽는다.
ENV PYTHON_BIN=python3
ENV DATA_PIPELINE_DIR=/app/data-pipeline
ENV PORT=4000

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:$PORT/health || exit 1

CMD ["node", "backend/src/server.js"]
