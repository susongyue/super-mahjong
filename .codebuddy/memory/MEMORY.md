# 项目长期记忆

## 项目概述
Super Mahjong — 一个多人在线麻将游戏 Web 应用，包含登录、大厅、房间、选角、对战等页面。

## CloudBase 部署
- 环境 ID: `sr-mahjong-d0g8mp6w19f37dd37`（上海 ap-shanghai）
- CloudRun 容器服务: `super-mahjong`（0.5核/1GB/1-5实例/端口3000/公网）
- 在线地址: `https://super-mahjong-267217-4-1324905494.sh.run.tcloudbase.com`
- Dockerfile 位于项目根目录（Node 18, npm start）

## 技术栈
- 前端: 原生 HTML/CSS/JS，无框架
- 后端: Node.js (server.js)
- 主题: 通过 CSS 变量实现深色 (`:root`) 和浅色 (`[data-theme="notion"]`) 双主题

## 主题约定
- 所有颜色应使用 CSS 自定义属性（变量），避免硬编码 `#xxxxxx` 或 `rgba()` 值
- 统一边框粗细为 `2px`
- `--hairline`, `--hairline-soft`, `--hairline-strong` 用于边框颜色
- "备注" 标签统一使用 `.fs-skill-label.note` 类

## 数据同步约定
- `tools/sync_characters.py` — JSON → xlsx 同步时必须保护格式：
  - 只修改 `.value`，不改字体/颜色/边框/对齐/填充
  - 写入前从已有数据行提取格式模板（微软雅黑/12/white fill/center/center/wrap）
  - K 列（片假名）不在 JSON schema 中，永不覆盖
  - 格式模板通过 `copy.copy()` 复制（避免 openpyxl 3.1+ 弃用警告）

## 版本管理约定
- 每次完成实质性改动后，将修改内容追加写入 `CHANGELOG.md`（按版本号分段），**仅在推送后**才递增版本号（默认 +0.0.1），未推送时在当前版本号下追加
- **仅在用户明确发出推送指令后**才执行 `git push`，否则只 commit 不 push
- 当前版本：**v1.1.0**

## 项目文件结构
- `public/` — 前端静态文件
  - `*.html` — 各页面
  - `style.css` — 全局样式
  - `themes.css` — 主题变量定义
  - `js/lib/` — 工具库 (api.js, auth.js, components.js, theme-switcher.js, utils.js)
- `server.js` — 后端服务
- `data/` — JSON 数据文件
- `tools/` — 工具脚本（`sync_characters.py` xlsx↔JSON 双向同步，格式保护设计）
- `CHANGELOG.md` — 版本变更记录

---

## 全部可用 Skills（按来源/类别分组）

### 一、项目级 Skills (`.codebuddy/skills/`)
| 名称 | 描述 |
|------|------|
| find-skills | 技能发现流程，优先 skillhub 后回退 clawhub |
| skillhub-preference | skillhub 优先策略 |

### 二、用户级 Skills
| 名称 | 描述 |
|------|------|
| gsap-animation-assistant | GSAP 动画助手：时间轴、ScrollTrigger、框架集成、性能优化 |

### 三、Manager/内置 Skills
| 名称 | 描述 |
|------|------|
| 多模态内容生成 | 文生视频/图生视频/文生图片/文生3D/图生3D、图片视频特效 |
| skill-creator | 创建/修改/评估 skill |
| pptx | PowerPoint 创建/读取/编辑/合并 |
| pdf | PDF 读取/合并/拆分/旋转/水印/OCR 等 |
| docx | Word 文档创建/读取/编辑 |
| xlsx | Excel 电子表格创建/编辑/格式化/图表 |

### 四、设计/前端类 Skills（最相关）

#### 4.1 taste-skill 系列（来自 https://github.com/Leonxlnx/taste-skill）
| 名称 | 描述 |
|------|------|
| design-taste-frontend | **v2 实验版** — 反slop前端设计，可推断设计语言，调节 VARIANCE/MOTION/DENSITY 三大旋钮(1-10) |
| design-taste-frontend-v1 | v1 稳定版，向后兼容 |
| gpt-taste | GPT/Codex 严格版，Python 驱动真随机布局、AIDA 结构、GSAP ScrollTriggers |
| image-to-code | 图片优先流水线：先生成参考图，再深度分析后实现前端代码 |
| redesign-existing-projects | UI 审计升级：诊断现有项目，识别通用 AI 模式，应用高端设计标准 |
| high-end-visual-design | 高端代理级设计：定义字体/间距/阴影/卡片/动画，消除廉价感 |
| minimalist-ui | 极简编辑风：暖色调单色、排版对比、平面 bento 网格、无渐变无阴影 |
| industrial-brutalist-ui | 工业粗野风：瑞士排版+军用终端美学，硬网格、极端字号对比 |
| stitch-design-taste | Google Stitch 语义设计系统：生成 DESIGN.md 强制高端 UI 标准 |
| full-output-enforcement | 强制完整代码输出：禁止占位模式，处理 token 截断 |
| brandkit | 品牌套件图生成：Logo 系统、色板、字体、应用示例 |
| imagegen-frontend-web | 网站参考图生成（仅图片）：每部分独立横版图片，强排版 |
| imagegen-frontend-mobile | 移动端参考图生成（仅图片）：iOS/Android 多屏流程 |

#### 4.2 内置设计 Skills
| 名称 | 描述 |
|------|------|
| frontend-design | 创建独特的生产级前端界面，高设计质量 |
| design-to-code-workflows | Figma/截图/自定义到代码的完整工作流 |
| ardot-design-assistant | 视觉设计创建/编辑，设计稿转代码 |
| image-to-ui | 截图/线框图 → 可编辑 ardot 设计稿 |
| image-understanding-native | 图片结构化语义分析 |
| theme-factory | 10 个预设主题或即时生成，可应用到任何制品 |
| web-artifacts-builder | React + Tailwind + shadcn/ui 创建复杂 Web 制品 |
| lucide-icons | Lucide 图标库 |

### 五、游戏开发 Skills
| 名称 | 描述 |
|------|------|
| weixin-minigame-helper | 微信小游戏：AI调试/预览/运行/真机测试/上传发布 |
| minecraft-bukkit-pro | Minecraft Bukkit/Spigot/Paper 插件开发 |
| unity-developer | Unity 6 LTS 游戏开发（URP/HDRP/跨平台） |

### 六、浏览器/Automation Skills
| 名称 | 描述 |
|------|------|
| agent-browser | 浏览器自动化：打开/截图/提取/点击/表单/测试 |
| playwright-cli | Playwright：表单填写/截图/数据提取/Web 测试 |
| webapp-testing | Playwright 与本地 Web 应用交互测试 |

### 七、安全/文件操作 Skills
| 名称 | 描述 |
|------|------|
| skills-security-check | 腾讯云鼎实验室：skill 安全审查工具 |
| safe-file-operations | 防止误删文件的安全操作规范 |

### 八、其他工具 Skills
| 名称 | 描述 |
|------|------|
| apple-notes | macOS 备忘录管理（memo CLI） |
| apple-reminders | macOS 提醒事项管理（remindctl CLI） |
| agentmail | AI 代理邮箱：收发邮件 @agentmail.to |

---

### 九、external_plugins 内置专业 Skills 汇总

#### 9.1 前端/移动开发（frontend-mobile-development）
- nextjs-app-router-patterns、react-native-architecture、react-state-management、tailwind-design-system

#### 9.2 后端开发（backend-development）
- api-design-principles、architecture-patterns、cqrs-implementation、event-store-design、microservices-patterns、projection-patterns、saga-orchestration、temporal-python-testing、workflow-orchestration-patterns

#### 9.3 无障碍（accessibility-compliance）
- screen-reader-testing、wcag-audit-patterns

#### 9.4 工具类
- brand-guidelines、canvas-design、changelog-generator、competitive-ads-extractor、content-research-writer、developer-growth-analysis、domain-name-brainstormer、image-enhancer、internal-comms、invoice-organizer、lead-research-assistant、mcp-builder、meeting-insights-analyzer、raffle-winner-picker、slack-gif-creator、tailored-resume-generator、youtube-downloader

#### 9.5 通用（all-skills）
- artifacts-builder、file-organizer、json-canvas、obsidian-bases、obsidian-markdown、skill-share

#### 9.6 UI/UX
- ui-ux-pro-max（ui-ux-pro-max-skill）

#### 9.7 科学计算（scientific-skills）— 138 个
包括 biopython、matplotlib、networkx、plotly、polars、dask、cirq、deepchem、geopandas 等 Python 科学计算库的专门 skills。在需要数据处理/可视化/科学计算时可用。

**Skills 总数估算：~200+ 个**
