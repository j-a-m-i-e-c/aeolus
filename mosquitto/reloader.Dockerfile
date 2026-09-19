FROM alpine:3.22
RUN apk add --no-cache inotify-tools
ENTRYPOINT ["/bin/sh", "-c"]
