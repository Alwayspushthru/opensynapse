# 历史脚本归档

`migrate-firestore-to-postgres.ts` 是从 Firebase Firestore 迁移到 PostgreSQL 的历史工具。迁移已完成，此文件仅供追溯，不属于安装、部署或日常运行流程。

根目录 `tsconfig.json` 将 `scripts/archive` 排除在日常 `npm run lint` 类型检查之外，其余活动脚本仍参与检查。不要从活动代码导入归档脚本，否则 TypeScript 仍会检查被导入的文件。

项目不再为此工具安装 `firebase-admin`。如未来确需重新启用，应先核对当前数据库 schema、用户 ID 映射和迁移逻辑，在隔离环境准备 Firebase 依赖与凭据，并单独进行类型检查和迁移验证。归档不代表该脚本已适配当前数据结构。
