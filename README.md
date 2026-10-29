# 你画我猜

多人在线画画猜词项目，使用 Node.js、Express 和 Socket.IO。与纯静态小游戏不同，联机玩法需要服务端运行。

## 入口与部署
- 前端页面：`public/index.html`
- 服务端：`server.js`
- 部署配置：`render.yaml`
- 启动命令：`npm start`
- [预期 GitHub Pages 静态页面地址（待实际访问核验）](https://z15314102792-arch.github.io/draw-and-guess/)

**注意：GitHub Pages 只负责静态网页，不能单独运行 `server.js`。** 即使静态页面能打开，也不代表多人联机后端在线。

## 本地运行
安装 Node.js 后，在项目目录执行：

```bash
npm install
npm start
```

再按服务端控制台显示的地址打开页面。公网联机还需要可访问的后端部署地址。
