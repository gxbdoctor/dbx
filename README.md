# DBX Virtual Groups Fork

> 基于开源项目 [t8y2/dbx](https://github.com/t8y2/dbx) 的功能增强分支。
>
> This fork adds **Virtual Groups / 虚拟文件夹** for organizing database objects in the DBX sidebar without changing the real database schema.

## ✨ 本 Fork 的主要改动：Virtual Groups / 虚拟文件夹

在大型 PostgreSQL / MySQL 等数据库中，表、视图、物化视图等对象数量很多时，仅依赖数据库原生 schema 往往不方便做“项目级”分类。

本 Fork 增加了 **Virtual Groups（虚拟分组 / 虚拟文件夹）**，允许你在 DBX 左侧对象树中按自己的逻辑整理数据库对象，同时**不修改数据库本身的 schema、表名、视图名或任何真实对象结构**。

### 核心能力

- ✅ 创建虚拟分组 / 文件夹
- ✅ 将数据库对象移动到虚拟分组中
- ✅ 重命名虚拟分组
- ✅ 删除虚拟分组
- ✅ 未分组对象仍然正常显示
- ✅ 分组信息本地持久化保存
- ✅ 不执行 `CREATE SCHEMA`，不会改变 PostgreSQL / MySQL 的真实命名空间
- ✅ 特别适合大量 **Views / Materialized Views / Tables** 的项目型管理

### 典型使用场景

例如数据库中已经存在大量科研分析对象：

```text
Database
├─ AKI
│  ├─ aki_cohort
│  ├─ aki_features
│  └─ aki_outcomes
├─ DIC
│  ├─ dic_score
│  ├─ dic_labs
│  └─ dic_cohort
├─ Sepsis
│  ├─ sepsis3
│  └─ infection_site
└─ Feature Engineering
   ├─ vitals_24h
   ├─ labs_24h
   └─ treatments_24h
```

这些目录只是 **DBX UI 中的虚拟分类**。数据库真实对象仍然保留在原有 schema 中，因此不会影响 SQL、依赖关系、权限、其他数据库客户端或现有程序。

## 🆚 Virtual Groups 与 PostgreSQL Schema 的区别

| 项目 | Virtual Groups | PostgreSQL Schema |
|---|---|---|
| 是否改变数据库结构 | 否 | 是 |
| 是否影响对象完整名称 | 否 | 是，例如 `aki.table_name` |
| 是否需要迁移对象 | 否 | 通常需要 |
| 是否影响现有 SQL | 否 | 可能影响 |
| 是否仅用于 DBX 界面整理 | 是 | 否 |
| 适合科研/项目分类 | 非常适合 | 取决于数据库设计 |

## 🧪 当前状态

Virtual Groups 当前位于：

- Branch: [`feature/virtual-groups`](https://github.com/gxbdoctor/dbx/tree/feature/virtual-groups)
- Permanent Preview Release: [`virtual-groups-v0.1.0-preview`](https://github.com/gxbdoctor/dbx/releases/tag/virtual-groups-v0.1.0-preview)
- Windows build workflow: [`Build Virtual Groups Windows`](https://github.com/gxbdoctor/dbx/actions/workflows/virtual-groups-windows.yml)
- 已验证的 Windows x64 构建：[`GitHub Actions run #34185049849`](https://github.com/gxbdoctor/dbx/actions/runs/34185049849)

当前为**测试版 / Preview**，建议先用于功能测试，不建议在没有备份的关键生产环境中直接替换正式版 DBX。

## 🪟 Windows x64 永久下载

已将 Windows x64 测试包发布到 **GitHub Release**，Release 文件不会像 Actions Artifact 那样按 14 天自动过期。

### 1. 安装版

[**下载 DBX-Virtual-Groups-Windows-x64-setup.exe**](https://github.com/gxbdoctor/dbx/releases/download/virtual-groups-v0.1.0-preview/DBX-Virtual-Groups-Windows-x64-setup.exe)

### 2. 绿色免安装版

[**下载 DBX-Virtual-Groups-Windows-x64-portable.zip**](https://github.com/gxbdoctor/dbx/releases/download/virtual-groups-v0.1.0-preview/DBX-Virtual-Groups-Windows-x64-portable.zip)

解压后运行：

```text
DBX-Virtual-Groups.exe
```

### 3. SHA256 校验

[**下载 SHA256SUMS.txt**](https://github.com/gxbdoctor/dbx/releases/download/virtual-groups-v0.1.0-preview/SHA256SUMS.txt)

👉 **Release 页面：** [DBX Virtual Groups v0.1.0 Preview](https://github.com/gxbdoctor/dbx/releases/tag/virtual-groups-v0.1.0-preview)

> 注意：当前测试包为未签名构建，Windows SmartScreen 可能提示风险警告。这不代表构建失败，而是因为该 Preview 版本没有正式代码签名。
>
> 当前 Release 为 Pre-release / Preview；除非仓库维护者主动删除 Release，否则下载文件会持续保留。

## 🔧 从源码运行 / 构建

### 环境要求

- Node.js 22+
- pnpm 10+
- Rust 1.88+
- Windows x64（Windows 测试构建）

### 获取代码

```bash
git clone https://github.com/gxbdoctor/dbx.git
cd dbx
git checkout feature/virtual-groups
pnpm install --frozen-lockfile
```

### 开发运行

```bash
pnpm tauri dev
```

### Windows NSIS 构建

```bash
pnpm tauri build --bundles nsis
```

本项目使用 Cargo workspace，Windows release 输出位于仓库根目录：

```text
target/release/
```

NSIS 安装包位于：

```text
target/release/bundle/nsis/
```

## 📦 关于 DBX

DBX 是一个轻量级、跨平台、开源数据库客户端，支持 PostgreSQL、MySQL、SQLite、Redis、MongoDB、DuckDB、ClickHouse、SQL Server、Oracle 等大量数据库，并提供桌面端、Docker、CLI、AI SQL Assistant 和 MCP Server。

原项目：

- GitHub: [t8y2/dbx](https://github.com/t8y2/dbx)
- Releases: [t8y2/dbx/releases](https://github.com/t8y2/dbx/releases)
- Documentation: [dbxio.com](https://dbxio.com/)

本 Fork 会尽量保持与上游 DBX 的兼容，同时增加适合大型数据库对象管理的增强功能。

## 🗺️ 后续计划

- [x] Virtual Groups 基础数据结构
- [x] 创建分组
- [x] 移动对象到分组
- [x] 重命名分组
- [x] 删除分组
- [x] 未分组对象显示
- [x] 本地持久化
- [x] Windows x64 安装包构建
- [x] Windows x64 绿色版构建
- [x] 发布永久 GitHub Preview Release
- [ ] 继续完善拖拽交互和细节体验
- [ ] 更多数据库对象类型兼容性测试
- [ ] 长期使用稳定性测试
- [ ] 根据测试反馈继续优化

## 🤝 Upstream / 致谢

感谢原始 DBX 项目及其贡献者：

[https://github.com/t8y2/dbx](https://github.com/t8y2/dbx)

本 Fork 仅针对特定工作流增加功能增强，DBX 原有功能、架构及大量实现均来自上游项目。

## License

[Apache-2.0](LICENSE)