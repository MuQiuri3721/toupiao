# ThreeUI 按钮来源与改编

- 上游：MengTo/threeui Community，https://github.com/MengTo/threeui
- 源文件：`src/shaders/neuform-isolated/sources/gradient-cta.html` 与 `gradient-pill-button.html`。
- 读取本地仓库缓存日期：2026-10-27。保留原始 MIT 许可于同目录 `THREEUI-LICENSE`。
- 本项目 `style.css` 的 `.button` 取自 gradient-cta 的圆角渐变按钮、内部高光与悬停覆盖层结构；`.secondary` 取自 gradient-pill-button 的圆角轮廓与多层阴影视觉。标签内容使用内部 `span`，以保留层叠交互结构。
- 按产品配色改为雾紫、桃粉、深色正文，改用本地原生 CSS；移除 Tailwind CDN、预览包装器、自动居中脚本和上游图标。
- 本次未安装 ThreeUI npm 包，未使用 React 或动态 3D 组件，不依赖远程字体、脚本和图像。
- 产品预览为静态界面结构，标记“独立投票系统界面示意”，不提供实际投票操作；示例评价不作为真实客户评价呈现。

页面采用单一浅色主题与系统中文字体。CSS 提供手机布局、键盘焦点以及减少动态效果偏好的降级。购买、付款申请、订单查询和内部订单管理均使用同页原生 dialog，不提供独立工作台、用户中心或投票页面。
