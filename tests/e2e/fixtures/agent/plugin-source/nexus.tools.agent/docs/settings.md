# Memory recall policy / 记忆召回策略 / メモリ想起ポリシー

Configure each logical instance in Installed plugins → Agent Collaboration and Content Tools → Settings.
`maxRecallItems` (default 5) and `maxRecallBytes` (default 8192) are positive safe integers, with no additional Host policy ceiling.
The byte budget counts the UTF-8 JSON array of selected memory records, including metadata. A request can select fewer items.
All published authorized candidates are ranked; results spanning multiple transport pages are fully revalidated and combined.
Only users may change these preferences. Source permissions, expiry and current versions remain Host checks.

在已安装插件的设置中配置每个实例。条数默认 5、总字节默认 8192；字节预算包含选中记忆及元数据组成的 UTF-8 JSON 数组。
不叠加宿主召回上限。大结果分批核对后完整汇总，任一批失效则整次失败；模型不能修改该预算。

インストール済みプラグインの設定で、インスタンスごとに件数と合計バイト数を指定します。
既定値は5件と8192バイトです。メタデータを含むUTF-8 JSON配列を計測し、転送ページを超える結果も完全に再検証して結合します。
