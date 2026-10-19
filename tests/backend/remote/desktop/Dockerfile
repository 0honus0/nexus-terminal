FROM alpine:latest

RUN apk add --no-cache tigervnc xrdp xterm xdotool font-dejavu openssl
COPY start.sh /fixture/start.sh
COPY xrdp.ini /etc/xrdp/xrdp.ini
ENTRYPOINT ["sh", "/fixture/start.sh"]
