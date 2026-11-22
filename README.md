# YAML Studio 1.3.2

中文 YAML 配置工作台。1.3.2 修复窄屏表单行类型徽标右漂、对象名称被数量截断，以及数字改文本时丢失原值的问题。桌面/900px 的类型列对齐与紧凑模式（无类型列）保持 1.3.1 已通过的行为。

- [中文使用说明](使用说明.md)
- [1.3.2 变更说明](CHANGELOG-1.3.2.md)
- [1.3.1 变更说明](CHANGELOG-1.3.1.md)
- [测试证据与未验证边界](TEST-REPORT.md)

```bash
npm ci --ignore-scripts
npm run dev
```

生产 Web：`npm run build && npm run serve:web`，访问 http://127.0.0.1:4173 。1.3.2 真实浏览器复验四项已通过。本轮交付源码、Web 与 Windows x64 NSIS（未签名，实机未测）。1.3.1 及更早交付保持不变。
