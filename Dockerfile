FROM node:22-alpine

WORKDIR /app

# 复制依赖文件并安装
COPY package*.json ./
RUN npm install --production

# 复制所有项目文件
COPY . .

# 确保数据目录存在
RUN mkdir -p data

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
