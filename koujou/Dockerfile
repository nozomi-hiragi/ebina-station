FROM denoland/deno:latest

EXPOSE 3456

WORKDIR /app

COPY deps.ts .
RUN deno cache deps.ts

COPY . .

RUN mkdir logs
RUN deno cache index.ts

CMD ["run", "-A", "index.ts"]
