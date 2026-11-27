# Chat 回复版本与面对面动作格式审核（2026-11-27）

本轮以完整版 `95b101ad0d63c8300e5782e3300150b7f1e9ceec`、分享版 `cdf56834ba8da3354730eb7c713d871f5c991254` 的 main 为底稿。源码保存到测试分支 `test/chat-reply-versions-face-actions-20261127`，不合并 main。只修改 Chat 本轮功能及对应存储、备份、会话合并和测试；分享版保留独立实现。没有发布 APK 或资源更新包，已取消 092 打包任务。

## 审核发现与处理

- 原线下重回只覆盖指定轮，没有临时版本。新增加独立 KV 暂存，按会话和 turnId 隔离，保存初版和最近五次成功重回，使用单调编号。正文、rawText、summary、summaryTag、reasoningText、thinkingText、thinkingTag 同步保存及恢复。图片和音乐不复制。
- 正式剧情仍只有原 turn 的当前正文；切换不新增消息、不调用模型。未选中版本不混入上下文、总结、短长期记忆、群成员知情和归档。生成请求只读取正式 turn。
- 重回在返回成功的非空正文后才更新版本。提交前同时检查正式记录和暂存版本指纹；因此即使并发生成返回完全相同的正文，旧请求也不能覆盖新的版本列表。
- 下一段生成成功写入后才确认选中剧情并清理暂存；有效发送后生成失败、取消、空输出、识图验证失败或并发变化均保留选中正文及选择列表。围观群空输入推进使用同一成功提交节点。
- 删除整轮、删除以下、单独删除角色正文、清空会话及成功归档均清理对应暂存。暂停不清理；编辑更新当前选中版本；合并会话迁移 sidecar；备份模块与 KV 迁移注册包含新的前缀。
- 新增 15px History 入口，位于重回右侧；首次成功重回前隐藏。弹窗展示初版和重回编号、三行预览、全文比较、当前版本、黄色选择标记和明确的“使用此版本”。底部操作栏支持窄屏换行，沿用日夜主题和字体缩放。
- 旧 AI 提示词及解析只认识完整的现场动作标签。现在程序固定规则要求所有非语言内容独立使用 `【非语言正文】`，固定规则追加在自定义风格之后，不由可编辑风格替代。普通台词、语音、翻译、工具和状态协议保留。
- 单聊和群聊共用平衡括号扫描，支持多段、多行、嵌套、交错及旧的 `【现场动作】正文【/现场动作】`。内部仍保存 canonical 现场动作标签。群动作使用共享场景身份，不归属成员。
- 仅动作开关启用时识别新的简写括号；群聊解析同时核对实际应用 tags、custom prompt profile、语音/视频/线下以及围观限制。普通括号、第三人称句子不做语义猜测。
- 线上面对面动作模式在未完成的流式增量阶段不显示未解析气泡，包含重回入口；完整段落/模型轮次完成后以动作和台词的正确类型展示。重回、工具前后输出和整轮编辑沿用同一解析器。

## 源码提交

- 完整版：`6a52934d91e5b0aa4ac9656b6bb5b3f0d75e631c`。
- 分享版：`769ccf137a537e1294367df30d5a607b4c9247ba`。
- 两版测试分支：`test/chat-reply-versions-face-actions-20261127`，main 保留原有更新。

## 修改文件（两版路径相同）

- `components/chat/chat-room.tsx`
- `components/chat/offline-reply-version-dialog.tsx`
- `components/chat/offline-reply-version-dialog.module.css`
- `lib/chat-offline-storage.ts`
- `lib/chat-session-merge.ts`
- `lib/data-management/modules.ts`
- `lib/chat-face-to-face.ts`
- `lib/group-chat-engine.ts`
- `lib/rich-message-parser.ts`
- `scripts/check-offline-reply-versions.cjs`
- `scripts/check-offline-reply-versions-ui.cjs`
- `scripts/check-face-to-face-audit.cjs`
- `scripts/check-offline-empty-retry.cjs`
- `scripts/check-offline-speech-scenes.cjs`
- 本审核文档。

旧脚本修正仅更新组件图标/版本读取 mock 及新的重回提交函数契约；没有删减原有断言。

## 验证

| 检查 | 完整版 | 分享版 |
| --- | --- | --- |
| 回复版本/生产发送及重回处理器模拟 | 88 项通过 | 88 项通过 |
| 新旧动作格式、应用范围及后台场景 | 91 项通过 | 91 项通过 |
| React 真实点击：弹窗暂选、确认、取消、全文入口 | 通过 | 通过 |
| React 语音：切换版本使旧合成失效，仅播放新台词 | 通过 | 通过 |
| 旧版线下删除后重回与场景归档/知情边界 | 通过 | 通过 |
| 通话结束及正常聊天回归 | 通过 | 通过 |
| 跨 APP 记忆 | 45 项通过 | 40 项通过 |
| 美化与插件的日夜开关选择器回归 | 120 项通过 | 120 项通过 |
| TypeScript `tsc --noEmit` | 通过 | 通过 |
| `npm run build` | 通过 | 通过 |

模拟检查执行真实源码的存储、发送、重回、解析与组件事件，隔离模型调用、网络和不相关副作用。语音检查模拟延迟返回，验证切换版本后旧语音不会播放。两版初始源码快照已逐文件核对 Git blob 哈希。

## 未验证与边界

- 未调用用户的真实模型、识图或 TTS API，未进行手机实机和真实浏览器布局验收；DOM 检查不等同于字号/主题/滚动的实机视觉验收。
- 程序强化格式要求并解析明确标记，不猜测未标记的自然语言是否为动作。真实模型完全不遵守格式、把未标记旁白直接当台词返回时，不能宣称能百分之百自动纠正。
- 未改动本轮前已恢复的后台保活、三颗悬浮球、阅读翻页和通话折叠/美化。没有整体覆盖任一版本的差异文件。
- 分享版曾在并行生产构建时于类型检查阶段被运行环境以 137 终止；最终生产构建改为顺序执行，两版均完成并以 0 退出。

交互脚本需要 jsdom；可用 `JSDOM_PATH` 指向已安装的 jsdom 模块。本轮没有修改两版依赖或自动打包工作流。

两版 package-lock 中的直接依赖均与本次构建所用安装版本一致，没有缺失或替换版本。

复核命令：`npx tsc --noEmit`、`npm run build`、`node scripts/check-offline-reply-versions.cjs`、`node scripts/check-face-to-face-audit.cjs`、`node scripts/check-cross-app-memory.cjs`、`node scripts/check-offline-speech-scenes.cjs`、`node scripts/check-offline-empty-retry.cjs`、`node scripts/check-oct31-call-end.cjs`；交互及美化检查另带 `JSDOM_PATH` 运行 `check-offline-reply-versions-ui.cjs` 和 `check-face-menu-skins.cjs`。
