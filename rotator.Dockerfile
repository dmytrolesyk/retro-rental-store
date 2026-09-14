# syntax=docker/dockerfile:1
FROM postgres:18
COPY --chmod=755 scripts/rotate-loop.sh /usr/local/bin/rotate-loop.sh
ENTRYPOINT ["rotate-loop.sh"]
