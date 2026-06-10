# 世界杯实时预测网站部署说明

这个目录是纯静态网站，可以部署到 Vercel、Netlify、Cloudflare Pages、GitHub Pages 或任何静态主机。

## 当前状态

- 本地地址：http://localhost:8787
- 临时公网地址由 Cloudflare Tunnel 提供，会变化，不适合作为永久网址。
- 要获得永久固定网址，必须至少具备一个托管平台账号，或一个你拥有的域名。

## 推荐方案

### 方案一：Vercel 固定免费域名

部署后会得到类似：

`https://worldcup-live-prediction-site.vercel.app`

需要：

1. 注册/登录 Vercel。
2. 导入本目录为静态项目。
3. Framework Preset 选择 `Other`。
4. Build Command 留空。
5. Output Directory 设为 `.`。

### 方案二：Netlify 固定免费域名

部署后会得到类似：

`https://worldcup-live-prediction-site.netlify.app`

需要：

1. 注册/登录 Netlify。
2. 将本目录上传或连接 Git 仓库。
3. Publish directory 设置为 `.`。

### 方案三：绑定自己的域名

如果你有域名，例如：

`worldcup.example.com`

可以在 Vercel/Netlify/Cloudflare Pages 中添加 Custom Domain，然后按平台提示配置 DNS。

## 文件说明

- `index.html`：网站入口
- `styles.css`：页面样式
- `app.js`：筛选、实时修正和前端交互
- `data.js`：全部小组赛预测数据
- `assets/stadium-dashboard.png`：顶部视觉素材
- `vercel.json`：Vercel 静态部署配置
- `netlify.toml`：Netlify 静态部署配置
- `.nojekyll`：GitHub Pages 静态文件兼容标记
