# Virtual Folders 源码增补包

此包把虚拟文件夹作为可重复安装、可卸载的独立源码增补维护。它支持 DBX 侧边栏的表、视图和物化视图分类；虚拟文件夹只记录本地分类，不执行数据库 DDL。

**它不能直接安装进官方 `DBX.exe`。** 当前 DBX 的外部插件接口提供数据库驱动能力，没有开放侧边栏 UI 插件接口。官方桌面更新会替换整个应用，因而带走自定义 UI。使用本包需要对相应版本的 DBX 源码增补后重新构建。要在官方应用内直接点击安装，需要上游先接入兼容的 UI 扩展接口。

## 推荐：在 GitHub 页面生成增强版

不需要在自己的电脑安装 Rust。新工作流需先合并到仓库默认分支，GitHub 才会显示手动运行入口；本 PR 分支的源码提交也会自动触发 **Build Virtual Groups Windows**，可先下载该次构建验证当前版本。

工作流合并后：

1. 打开本仓库 **Actions → Build Virtual Folders Add-on → Run workflow**。
2. 选择含有本插件的分支。`upstream_ref` 填官方 DBX 的 tag 或 commit；默认值是本插件的基准 commit。官方更新后填对应的新 tag 即可。
3. 等待源码兼容检查、前端测试和 Windows 构建完成。
4. 在该次运行的 **Artifacts** 下载安装版或绿色版；另有单独的源码增补 ZIP。产物默认保存 30 天。
5. 安装增强版。更新前可在虚拟文件夹菜单导出分类配置，需要时再导入。

新版本如果改变了侧边栏接入位置，兼容检查会停止构建并显示冲突，不会发布不完整的包。兼容通过表示源码补丁可应用；该次运行还会执行类型检查、相关测试与完整应用构建。它不代表未来所有 DBX 版本都兼容。

工作流只生成下载产物，不自动发布 Release、不合并分支，也不替换官方更新源。希望长期保存二进制时，可以手动运行独立的发布工作流，并明确选择成功的 Windows 构建 run ID。

## 本地安装到源码

需要 Git、Node.js 22+，以及 DBX 源码。编译桌面应用另需项目要求的 pnpm、Rust 和系统构建依赖。

将源码增补 ZIP 解压到源码目录以外的任意位置；Windows 可双击 `Install.cmd` 并填写 DBX **源码**目录。命令行同样支持：

```bash
node install.mjs check --target /path/to/dbx
node install.mjs apply --target /path/to/dbx
node install.mjs status --target /path/to/dbx
```

增补后，在 DBX 源码根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm tauri build
```

本地没有 Tauri 更新签名私钥时，需使用关闭 `bundle.createUpdaterArtifacts` 的构建配置；仓库提供的 Windows 工作流已处理此项。关闭的是本次构建的更新产物生成，应用内仍使用原有的官方更新验证与下载逻辑。

`check` 完整预检所有补丁文件并验证 SHA256；`apply` 已安装时不重复写入。目标源码有冲突时，整个操作停止，不会先改一半文件。工具不执行 reset、stash、checkout，不删除应用数据，也不修改更新公钥、更新地址或版本号。请从可信仓库获取此包，SHA256 只检查包内一致性，不构成发布者签名。

## 卸载与数据

```bash
node install.mjs remove --target /path/to/dbx
```

也可双击 `Uninstall.cmd`。卸载仅反向移除本包的源码改动，再次编译才会反映到应用。已有文件内与本包无关的修改会保留；如果你修改过插件新增文件或补丁所在位置，卸载会停止供人工处理。此工具不访问 localStorage、连接配置或数据库文件，因此不会清除虚拟文件夹数据。

继续使用官方版本更新是可行的，但官方版暂时不会显示这些虚拟文件夹。重新构建并安装兼容增强版，使用同一应用配置时可恢复分类；跨设备或配置目录迁移请使用分类导出/导入。

## 维护与重新打包

在包含插件改动的仓库根目录运行：

```bash
node --test plugins/virtual-folders/install.test.mjs
node plugins/virtual-folders/package.mjs --base 5814ff008882c57c275166431c3d9ef9055a9aa7
```

脚本以指定官方源码基准为比较对象，收集 `apps/desktop/src` 的已跟踪改动和新增文件，生成 `payload.patch`、`manifest.json` 以及 `artifacts/DBX-Virtual-Folders-source-addon.zip`。运行前确认该范围内只包含准备交付的插件改动。提交前重新打包，并一并提交两个 payload 文件；CI 会重新生成并校验它们，避免打包内容落后于源码。

旧的 `scripts/patch_virtual_groups*.py` 已改为调用本安装器；原自动提交源码的 integration workflow 已改为只读检查，避免老补丁重复执行。

## 原版本更新问题的代码依据

- 旧绿色包没有 `portable.dbx` 标记，会被程序识别为安装版并走安装器更新流程。现已在两个 Windows 构建工作流中补齐标记。
- 旧发布工作流固定读取 run `34185049849`，重新发布也可能仍是旧包。现改为明确输入并验证成功的构建 run ID。
- 虚拟分组分支未改动官方更新地址、公钥或应用版本。仅凭源码无法确认用户电脑上具体的更新报错；未签名构建也不等于客户端不能下载已签名的官方更新。
