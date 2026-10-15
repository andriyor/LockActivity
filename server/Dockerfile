# No npm install: the server has no runtime dependencies and Node runs the .ts files directly.
FROM node:24-alpine
WORKDIR /app
COPY package.json *.ts ./
COPY lib lib
RUN mkdir /data && chown node /data
USER node
ENV STATE_FILE=/data/state.json
EXPOSE 8790
CMD ["node", "toggl-poll.ts"]