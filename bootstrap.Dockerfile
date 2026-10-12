# syntax=docker/dockerfile:1
FROM postgres:18
COPY --chmod=755 scripts/bootstrap.sh /usr/local/bin/bootstrap.sh
ENTRYPOINT ["bootstrap.sh"]
