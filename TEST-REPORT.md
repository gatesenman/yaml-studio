# YAML Studio 1.3.3 · 验证报告

日期：2026-11-24（Asia/Shanghai，UTC+8）。基线为已发布的 1.3.2（https://github.com/gatesenman/yaml-studio ，commit `07923776e0666259102682d2df88d57197785a60`，tag/Release v1.3.2）。本轮未推送 GitHub。

**68 项 npm 测试＋1 项真实 HTTP 服务测试，共 69 项通过，0 失败、0 跳过。** typecheck 与 lint 通过；npm audit 0 个漏洞（以本轮实际输出为准）。不给成熟度分数，不称全面 E2E 通过，也未做新的真实浏览器复验。

## 本轮自动测试覆盖的修复

| 项 | 验证方式 | 结果 |
| --- | --- | --- |
| 多文档状态栏诚实性 | 单元测试 `yamlStatusText` + 加载后文档流的 `otherIssueCount` | 通过 |
| 查询不安全数字不改写精度 | `interpretScalarInput` 单元测试 + SearchPanel 批量修改工作流 | 通过 |
| Schema 编译/校验一致且中文错误 | `compileSchema`/`compileSchemaDetail` 与 `validateAgainstSchema` 单元测试 + 设置页与测试面板工作流 | 通过 |
| AI 新建生成过期预览 | 模拟 fetch 的 AiPanel 工作流：重置文档后拒绝应用 | 通过 |
| 断言中文类型与通过/未通过 | `runAssertions` 单元测试 + TestPanel 工作流 | 通过 |
| 查询仅当前文档 | SearchPanel 多文档工作流（结构化结果与范围说明） | 通过 |
| 1.3.2 表单行布局与安全类型转换 | 既有卡片布局与 port 转换工作流测试仍通过 | 未回退 |

## Windows x64 NSIS（交叉构建）

- 文件：`YAML-Studio-Setup-1.3.3-x64.exe`（123285319 字节，SHA256 `d0971dbe95a0cd62ae0b9e1e45f4d3b068496d09a134a527b9fe532e29b0127d`）
- Linux 标准交叉构建退出码 0；从实际 EXE 按 7z 头长度/CRC 提取完整载荷，7zip 解压退出 0；app.asar 内版本 1.3.3，dist 与 electron 共 9 个文件与构建源逐字节一致；应用 PE 为 AMD64。未签名。
- 已按 20 MiB 分成 6 片并在本机重组，哈希与原 EXE 一致。合并 CMD 为 ASCII、预检缺片/大小/SHA，不覆盖、不自动执行。
- 证据：verification/windows-build.log、windows-extract.log、windows-asar-check.json、installer-parts-check.json。
- **未在 Windows 实机验证安装、卸载、文件关联或合并 CMD。**

## 未在本轮验证的项

- 未做新的真实浏览器目视复验（1.3.2 的四项布局/转换复验记录仍在 verification/browser-acceptance-1.3.2/，本轮未重做）
- 未在真实 Windows 上测试安装、卸载、文件关联或合并 CMD
- 未连接真实或付费 AI 接口
- 顶栏下载、部分快捷键、Diff/设置的完整目视流程本轮未再人工操作
- 安装包未签名

## 1.3.2 基线记录（历史）

# YAML Studio 1.3.2 · 最终验证报告

日期：2026-11-23（Asia/Shanghai，UTC+8）。环境：Linux x64、Node.js 24.22.1、Vite 8.3.8、Electron 45.4.1、electron-builder 26.18.1。没有调用真实付费 AI。

## 当前结论

**61 项 npm 核心/React/文件流程/Electron 测试＋1 项真实 HTTP 服务测试，共 62 项通过，0 失败、0 跳过。** 1.3.2 真实浏览器复验四项全部通过。随后进行 Windows x64 NSIS 交叉构建与实际 EXE 载荷校验。不给成熟度分数，不称全面 E2E 通过。

| 检查 | 结果 |
|---|---|
| npm run typecheck / lint | 通过，无 lint 警告 |
| npm test | 61/61 通过 |
| npm run build | 通过，230 模块；JS 999.31 kB/gzip 319.04 kB，CSS 34.29 kB；仍提示主块 >500 kB |
| npm run test:web | 1/1 通过；真实子进程 HTTP，拒绝越界与写入 |
| npm audit | 0 已知漏洞；不等于绝对安全 |
| 1.3.2 真实浏览器复验 | 四项全部通过，范围见下文；不是全产品 E2E |
| 1.3.2 Windows x64 NSIS | Linux 标准交叉构建退出码 0；从实际 EXE 提取载荷，版本 1.3.2、9 个 dist/Electron 文件及 AMD64 校验通过；未签名 |
| 安装六分卷 | 前五片各 20971520 字节，末片 18426529 字节；重组 SHA256 与原 EXE 一致，临时重组文件已删除 |
| Windows 实机 / 合并 CMD 实际执行 / 真实 AI | 未测 |

截图归档于 verification/browser-acceptance-1.3.2/（源自动自 /workspace/yaml-studio-v1.3.2-screenshots/）。

## 1.3.2 真实浏览器复验（已通过）

2026-11-23（Asia/Shanghai，UTC+8），父助手安排真实浏览器复验并回传，非本执行器自行操作。四项全部通过：

1. **390 窄屏**：叶字段（name / enabled / port 等）类型徽标紧跟左侧勾选组，不再单独右漂或留下大块空白；值可换到下一整行。见 01-390px-form-top-types-tight.png。
2. **对象名称**：`metadata` 完整显示，不被「1 字段」截成 `metada`。见 02-390px-form-metadata-full-name.png。
3. **桌面与 900px**：类型在名称前等宽对齐，数量紧跟名称，名称与值相邻，相对 1.3.1 已通过布局无回退。见 03-desktop-form-alignment.png、04-900px-form-workspace.png。
4. **类型转换**：`port` 由数字改为文本保留 8080，由文本改回数字仍为 8080；无法安全转换时出现中文提示且可撤销。见 05-port-number-to-text-keeps-8080.png、06-port-text-to-number-keeps-8080.png、07-nonconvertible-toast-undoable.png。
5. **紧凑对齐**：无类型列。见 08-compact-align-no-type-column.png。

以上只覆盖所列操作。本轮**未作为复验项、不得夸大通过**的包括：顶栏下载按钮、保存/下载快捷键、未保存离开全流程、错误列表跳转、Schema/断言、Diff、设置、查询替换、多文档、大文件、草稿重载、Windows 实机与真实 AI。对应自动化通过不能冒充这些人工验收。

## 本补丁自动化证据

- 窄屏样式：`max-width: 560px` 下卡片行三列网格，勾选到类型固定第一列且不换行，值占下一整行，操作按钮在第一行第三列。字段名按内容宽度，数量可换行。JSDOM 不计算 390×943 真实像素；像素结论以本次浏览器复验为准。
- 核心与组件转换：`8080`↔`"8080"` 保留；无法安全表示时回退默认值并提示可撤销。

既有 1.3.0/1.3.1 自动化范围（YAML 安全边界、Schema/断言、草稿、Electron 模拟壳与临时目录 IO、AI Mock 等）仍通过，不等于 Windows 实机或真实供应商验收。

## 最终安装包身份

- 文件：`YAML-Studio-Setup-1.3.2-x64.exe`
- 大小：123284129 字节
- SHA256：`bfac9a16f25d8c4c25d04ce290f3c6485f46931dd9f83a5def621c92b8cee930`
- 从实际 EXE 按 7z 头长度/CRC 提取完整载荷，7zip 解压退出 0；app.asar 与构建应用一致，内含版本 1.3.2，dist 与 electron 共 9 个文件逐字节一致。不是只检查打包前目录，也不是旧版安装器。
- 六片完整大小、顺序、哈希见 parts/manifest.json 与 SHA256SUMS-parts.txt；请勿混用 1.3.0/1.3.1 分片。
- 证据：verification/final-checks.log、windows-build.log、windows-extract.log、windows-asar-check.json、installer-parts-check.json、browser-acceptance-1.3.2/。

## 空间与打包过程

只检查本任务目录和已知挂载，未扫描或清理其他项目或共享缓存。应用目录与 Electron 缓存放在已核实可用的私有 /dev/shm；NSIS 输出在项目 release/，持续监测 512MiB 安全底线。最终交付在持久磁盘。Debian Wine 对子进程取消 TMPDIR/TEMP/TMP 以避免已知缺陷，未跳过标准 NSIS 步骤。未生成免安装 ZIP。校验完成后仅删除本任务 release 中间文件和私有临时目录。1.3.0/1.3.1 完整交付保持不变。

## 限制

- 安装包由 Linux 交叉构建，**未签名**，可能出现信誉提示或通用 Electron 图标。Windows 实机安装/卸载、文件关联、系统对话框、合并 CMD 实际执行均未测。CMD 仅经 ASCII/CRLF、缺片/大小/输出预检与最终 SHA256 静态核对，并在本机构独立二进制重组验证；不自动执行安装器。
- AI 仅 Mock：真实供应商、计费、网络/CORS 未测。Key 只留内存。本地存储不加密，不是备份。
- 导入/原生保存上限 2MiB；解析另有字符/行/文档/深度/节点/别名边界。Web 下载不等于已写回原文件。
- 主 JS 仍约 1MB，构建有体积提示。
