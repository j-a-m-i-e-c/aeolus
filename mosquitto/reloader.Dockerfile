FROM alpine:3.22

# inotify-tools lives in Alpine's `main` repository. When the APKINDEX fetch
# for one repository times out, apk warns and carries on with whatever indexes
# it did manage to get, then reports the package as "no such package" — so a
# slow CDN response surfaces as a missing-package error and fails the deploy.
# apk has no retry option of its own (only --timeout), hence the loop.
#
# The trailing check is load-bearing: a `for` loop's exit status is the status
# of its last command (`sleep`), so without it an install that failed every
# attempt would still produce an image, and the sidecar would crash at runtime
# instead of failing the build.
RUN for attempt in 1 2 3 4 5; do \
        apk add --no-cache inotify-tools && break; \
        echo "apk add failed (attempt ${attempt}/5), retrying in 5s"; \
        sleep 5; \
    done; \
    command -v inotifywait > /dev/null

ENTRYPOINT ["/bin/sh", "-c"]
