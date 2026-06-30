FROM node:22-alpine

WORKDIR /work

RUN apk add --no-cache git

CMD ["sh"]
