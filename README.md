# dsh-effort-slider

Claude Code Desktop 风格的「思考强度（Effort）」滑条插件，用于 DeepSeek Harness
（DSH）。它把原生模型菜单里「推理等级 ›」**那一行原位替换为滑块**，打开菜单即见，
无需再点进子页；其余一切保持原样。

## 功能

### 滑轨与档位

- 档位从左到右为 **off → Default(Auto) → Low → High → Max**，来自当前选中模型
  的真实推理等级目录（`ctx.modelDirectories`，与原生菜单、`/model` 弹窗共享同一
  份状态），不是写死的名字。
- 「推理等级 ›」行的位置直接是**滑轨**，不再需要点击钻入；当前档位以 `· Max` 的
  形式显示在「模型」行模型名右侧，切换档位时档位名做模糊交叉淡切。
- 原生右下角 `GLM-x · Max` 药丸**不动**：点开后「模型 ›」行原样保留，点击即钻入
  原生模型列表（分组、搜索、勾选）。
- **档位文字随粒子场着色**：卡片内的档位徽标与输入框胶囊里的档位词都用对应场的
  主色（紫 / 蓝 / 绿 / 彩虹紫），Max 档加粗；Off 回到原生灰色。两处文案与颜色
  同源，永不漂移；Auto 档显示 **Default**，与胶囊完全一致。
- **按模型记忆档位**：每个模型上次选的档位会被记住（`localStorage`），切走再切
  回时通过原生同一条通路自动恢复，无需再打开菜单。在菜单里选完模型后**回到根视
  图**（滑块卡片），而不是把菜单整个关掉。

### 粒子场

- **四色粒子场**：**Default(Auto)** 在游标右侧铺**彩虹**，**Low** 绿、**High**
  蓝、**Max** 紫铺满整条轨道，Off 无场。四种色调全部复用同一套冻结的
  `drawPixelField`，仅由 CSS 重新着色（蓝绿用 `hue-rotate`）。
- **色相流动**：彩虹沿轨道以 6s 周期无缝滚动（红橙黄绿青蓝紫）；打开菜单时粒子
  **即时铺满**（无扫描等待），切换档位时重放 0.8s 的扫描动画。
- **逐格明暗错落**：彩虹着色只落在粒子格上（间隙无色），且明暗由 70% 低频区域
  采样 + 30% 逐格位置哈希构成——不规则、无棋盘格、无块状，与画布粒子自身的明暗
  同相，且**零时间抖动**。
- `prefers-reduced-motion` 时停用色相滚动、扫描与弹簧。

### 交互

- **松手不关菜单**：原生菜单有两类"不认识就关闭"的逻辑——`document` 上的
  `mousedown` 监听，以及卡片 React 树里的 `onBlur`。插件在宿主节点**冒泡阶段**
  截断滑块内所有指针/鼠标/焦点事件（键盘除外，Esc 仍可用），并在 `document`
  捕获阶段截断"焦点从原生行移入滑块"的 `focusout`。**失焦关闭**由插件自己实现
  ——滑块焦点离开卡片时向卡片转发 Escape，走原生关闭路径。
- 拖动时**磁吸预览**、松手**弹簧吸附**并只提交一次——通过
  `directory.select({provider, model, reasoningEffort})`，与原生 `chooseEffort`
  完全相同的写入通路，真正改变发给模型的思考强度。
- **双向同步**：滑杆读同一份会话投影，`/model` 或其他 DSH 实例改动强度时滑杆
  自动跟随；拖动滑杆后药丸标题「· xxx」同步变化。
- **拖动流畅**：拖动与弹簧动画期间，填充宽度直接写入 DOM 的 CSS 变量，不触发
  React 重渲染；只在**跨越档位**时重渲染一次。
- **无回闪**：弹簧结束时不把位置清回"已提交值"，而是保持在终点，等 store 回传
  确认后再切换——避免 RPC 往返期间游标跳回旧档位再跳回。
- **释放兜底**：指针捕获可能静默失败或被浏览器撤销（拖出窗口、系统手势），插件
  在 `document` 捕获阶段监听 `pointerup` / `pointercancel`，并以 `window` 失焦
  与指针离开视口作为兜底——无论松手位置在哪，滑块都正确吸附。
- 键盘：`←/→`、`Home`、`End` 换档；`Esc` 关闭菜单；`Tab` 走原生焦点链；
  深浅色主题自适应。
- **诊断**：若菜单仍在滑块交互期间被关闭，控制台会自动打印
  `[claude-effort-slider] menu card removed during slider interaction` 并附带
  当时的焦点元素与提交状态（Mac 打开控制台：`Cmd + Option + I` → Console）。

## 实现方式（纯插件，不改 DSH 本体）

1. 在 composer 会话作用域注册一个**不渲染的探针**（`conversation.input.right`），
   捕获与原生药丸同一个会话的 directory 面，并把已提交档位的色调镜像到
   `<html data-ces-tone>`，供胶囊文字常驻着色。
2. `MutationObserver` 监听 `document.body`，识别 portal 出来的原生菜单卡片
   （`role="menu"` 且直系 body 子节点），按**结构**取第二个 `role="menuitem"`
   行作为「推理等级」行（不依赖 locale 文本或哈希类名）。
3. 在该行**前**插入宿主节点 `div.ces-inject-host`（React 不认识它，协调时不会
   碰），隐藏原生行并移除其 `role`，使原生焦点查询跳过它；同时给卡片打上
   `data-ces-card` 把最小宽度拉到 300px；用独立 `createRoot` 挂载滑轨，
   滑块 `width: 100%` 填满卡片内容区。
4. **档位徽标**：在「模型」行值区域（含 `data-model-id` 的 span 的父节点）末尾
   植入徽标槽位，滑块用 `createPortal` 把档位名挂进去，读作 `GLM-5.4 · Max`。
   原生重渲染该行丢失槽位时，sweep 会重新植入并通知滑块重新 portal。
5. **页面切换感知**：点「模型 ›」钻入列表时，原生两行被卸载，注入器发现宿主的
   下一个兄弟不再是原生行 → 卸载滑块并移除宿主；返回根菜单时重新注入。选完模型
   菜单关闭时，若刚发生过模型选择则自动重开一次 trigger，落回根视图。
6. Observer **丢弃**宿主子树内自己引发的变动，并按动画帧合并扫描；菜单关闭 →
   宿主节点离开文档 → 自动卸载。
7. **彩虹着色掩模**：粒子着色层与画布同坐标系，靠两层 `mask` 交集限定——一张由
   画布同一几何公式生成的格子掩模（间隙不着色），一张游标右侧的硬边渐变；
   `clip-path` 负责圆角与活动边。

## 档位映射

档位按模型目录动态生成，与原生 `effortChoices` 对应，顺序调整为
off / Default(Auto) / Low / High / Max（`off` 按 id 识别）。目录没有 adapter
默认值时插入 **Default(Auto)** 档（提交时**不带** `reasoningEffort` 字段，回到
provider 默认）；其余各档按目录顺序一一对应，提交各自的 id。

## 动画参数来源

调研阶段对照了两份公开发布的 MIT 复刻实现（见下方来源）。弹簧参数
（stiffness 920 / damping 40）、档位标签 3px/180ms 模糊交叉淡切、磁吸半径
0.5、约 30fps 的画布刷新来自 zanwei/claude-model-selector 的源码；像素场的
三层渲染、每格 alpha/色散、行级双波、扫描时长来自 youqisibun 的
`ANIMATION.md`（按官方截图逐列实测）。这两份都是作者对 Claude Code Desktop
原版的逆向复刻，具体数值与 Anthropic 原版可能存在出入，属于合理推测而非
官方事实。

## 来源

- https://github.com/zanwei/claude-model-selector （MIT，Web Component 复刻）
- https://github.com/youqisibun/dsh-claude-effort-slider （MIT，DSH 插件复刻，ANIMATION.md）
- https://github.com/254558/claude-range-slider （WebGL 璨星复刻，分层渲染佐证）
- https://github.com/anthropics/claude-code/issues/106642 （原版交互描述）
- https://code.claude.com/docs/en/model-config （/effort 官方文档）

## 安装

```bash
git clone https://github.com/icedkong/dsh-effort-slider.git
dsh plugin --profile <你的 profile> add ./dsh-effort-slider
```

或在 DSH 的 **Plugins** 面板通过 Add plugin 选择克隆出的目录安装。安装后重启
DSH 客户端进程（仅关窗口不够）。

## 免责声明

非官方第三方插件，与 Anthropic、DeepSeek 无关联亦未获其认可。「Claude」、
「Claude Code」、「Ultracode」等名称仅用于描述设计灵感来源，相关商标与知
识产权归各自权利人所有。本包不含任何官方代码或素材，所有界面与动画均由
本仓库代码在运行时绘制。以 MIT 协议开源，详见 [LICENSE](LICENSE)。
