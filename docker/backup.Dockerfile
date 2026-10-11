# Official Docker Library Alpine mirrored by AWS Public ECR. No Docker Hub auth needed.
FROM public.ecr.aws/docker/library/alpine:3.21
RUN apk add --no-cache postgresql16-client restic ca-certificates curl
COPY scripts/backup-postgres.sh /usr/local/bin/backup-postgres
RUN chmod 0755 /usr/local/bin/backup-postgres && mkdir -p /backup-status /home/backup/.cache/restic && chown -R 10001:10001 /backup-status /home/backup
ENV HOME=/home/backup
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/backup-postgres"]
