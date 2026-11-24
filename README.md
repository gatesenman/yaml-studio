# YAML Studio 1.3.3

中文 YAML 配置工作台。1.3.3 在 1.3.2 已发布基线上修复多文档状态栏、查询批量改写精度、Schema 提示一致性、AI 新建生成过期应用、断言中文类型，以及查询范围。不回退 1.3.2 的表单行布局与安全类型转换。

- [使用说明](使用说明.md)
- [1.3.3 变更说明](CHANGELOG-1.3.3.md)
- [1.3.2 变更说明](CHANGELOG-1.3.2.md)
- [测试报告](TEST-REPORT.md)

```bash
npm install
npm test
npm run dev
```

生产 Web：`npm run build && npm run serve:web`，访问 http://127.0.0.1:4173 。1.3.3 以自动测试验证（见测试报告），未做新的真实浏览器复验。Windows 安装包如已交付则为未签名的 Linux 交叉构建，实机未测。
