# syntax=docker/dockerfile:1
FROM postgres:18
COPY --chmod=755 scripts/init-db.sh /docker-entrypoint-initdb.d/
