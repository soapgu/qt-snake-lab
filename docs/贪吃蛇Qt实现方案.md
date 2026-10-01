# 贪吃蛇 Qt 实现方案

## 1. 目标与边界

依据已通过评审的[交互原型说明](贪吃蛇交互原型说明.md)和[离线原型](../prototype/index.html)，实现首页、难度选择、游戏、暂停、重开/返回确认及结算。沿用深色棋盘、绿色蛇身、橙色食物和简体中文界面，不要求像素级复制网页。

学习基线为 Qt 6.8.3、QML、C++17、MVVM、CMake 和 Ninja，目标平台为 macOS arm64、银河麒麟 Linux x86_64。重点练习属性通知、模型角色、对象所有权，以及参考 WPF Caliburn.Micro（CM）的 ViewModel 组合、生命周期、操作守卫和视图定位。

首版为 20 × 20 棋盘、三档难度、按难度最高分、撞墙/撞身体失败及满格胜利；不含联网排行、存档续玩、障碍、穿墙、音效、移动端和原型评审工具。网页 JavaScript 和 localStorage 成绩不迁移到 Qt。

**当前状态：软件设计已通过用户评审，Qt 实现尚未开始。** 2026-09-30 用户确认 CM 风格展示层设计，并明确删除存储异常的产品反馈；2026-10-01 确认新增 SettingsService，分离设置管理与存储读写，并细化变化通知；同日确认采用 Boost.Ext.DI 装配业务 VM，Game 按需创建、返回首页后释放。目标文件及待实现接口见[源码结构设计](贪吃蛇Qt源码结构设计.md)；设计批准不代表 Qt 构建、测试或平台验收通过。

## 2. 现状与目标结构

当前可运行内容只有 prototype 下的三份网页资源；仓库已有 README 和三份设计说明，没有 Qt 工程、C++/QML 源码或正式测试。

下面为目标结构，全部 Qt 类型待实现：

```text
组合根 main.cpp：存储 → SettingsService 并 load → 计时源 → 会话 → 弹窗服务 → Game 工厂 → DI 装配 Shell → QML 引擎
ShellViewModel（Conductor） → ShellView.qml（根窗口）
  ├─ activeItem：HomeViewModel 或 GameViewModel，由 C++ 导航
  │   ├─ HomeViewModel → HomeView.qml
  │   │   └─ DifficultyViewModel → DifficultyView.qml
  │   └─ GameViewModel（开始时由工厂通过 DI 创建，返回首页后释放） → GameView.qml
  │       ├─ BoardViewModel → BoardView.qml → BoardCellModel（400 格投影）
  │       ├─ GameStatusViewModel → GameStatusView.qml
  │       └─ overlay（Conductor）：空 / PauseViewModel / ResultViewModel
  │                                  → PauseView.qml / ResultView.qml
  └─ dialog：借用弹窗服务的临时 ConfirmActionViewModel → ConfirmActionView.qml

ViewRegistry + ViewHost：从 ViewModel 类型定位 View，并注入唯一 viewModel 属性
ActionBinding：绑定操作、监听 canXxx、执行前复核守卫
GameSessionService：唯一持有 SnakeGame，借用 ITickSource 与 SettingsService
SettingsService：唯一设置缓存、业务校验、最高分计算和精确通知，借用 ISettingsStore
IGameViewModelFactory：Shell 借用创建接口；应用装配层实现通过 DI 创建完整 Game 子树
ISettingsStore：仅 load / save；生产 QSettingsStore，测试 MemorySettingsStore
SnakeGame：普通 C++，唯一保存蛇、食物、方向、分数及规则结束原因
```

每个业务 View 对应一个明确类型的 ViewModel，父 ViewModel 组合子 ViewModel。QML 负责装配、绑定和视觉行为；导航、操作条件和确认流程放在 C++ 展示层。同级 ViewModel 不直接互相调用，具名意图信号由父 ViewModel 在 C++ 中连接。

Shell 唯一管理当前页面；启动时只有 Home/Difficulty，进入游戏时才创建 Game 子树。Game 唯一管理覆盖层的选择，Running 为空、Paused 为 Pause、GameOver/Won 为 Result。页面导航与五种会话状态分开：激活页面不自动开始游戏，停用页面不自动销毁游戏；正常返回必须先执行会话用例，再由 Shell 切回首页并显式移除 Game。暂停、结算和再玩一次保留同一个 Game，Game 的寿命覆盖一次进入游戏页到离开游戏页的过程，可以包含多局游戏。

**学习重点**：MVVM 的 Model 不限于列表模型。规则核心保存业务事实，BoardCellModel 只是快照投影；ViewModel 的 Screen 状态用于界面激活，不能替代会话状态。

## 3. 接口与基础设施

### 3.1 CM 风格的最小 MVVM 支撑

以下均为本项目计划实现的支撑类型，不是 Qt 自带 API，也不引入 .NET CM 库。参考 [CM 组合与生命周期](https://caliburnmicro.com/documentation/composition)、[操作与守卫](https://caliburnmicro.com/documentation/actions)、[命名约定](https://caliburnmicro.com/documentation/conventions)，只实现本项目需要的能力。

| CM 概念 | Qt 目标类型 | 约定与边界 |
| --- | --- | --- |
| PropertyChangedBase | ViewModelBase + QObject 属性 | 动态只读属性用 Q_PROPERTY/NOTIFY；恒定子对象入口用 CONSTANT |
| Screen | ScreenViewModel | 一次初始化、激活、停用；不把生命周期操作暴露为 QML 游戏命令 |
| Conductor | ConductorViewModel | 通过 unique_ptr 接管子 Screen，只激活一个 activeItem；切换先停用旧项再激活新项，非活动项可显式移除并延迟释放 |
| IoC / 构造注入 | Boost.Ext.DI + 应用装配入口 | 递归创建业务 VM，父 VM 接收子 VM；服务绑定已有实例，Game 通过类型化工厂按需装配 |
| ViewLocator / ViewModelBinder | ViewRegistry、ViewHost | 从固定类型表定位 View；加载前注入 required viewModel；View 不创建业务 VM |
| ActionMessage / CanXxx | ActionBinding、ActionButton、KeyActionBinding | action=pauseGame 对应 canPauseGame；通知刷新 enabled，执行再次检查 |
| WindowManager | IDialogService、DialogService、DialogHost | 服务持有临时弹窗 VM，View 只显示；结果异步返回，不嵌套阻塞事件循环 |

操作统一使用 public Q_INVOKABLE void 方法，首版支持无参数或一个 int 参数，不支持重载和传递控件。每个操作必须有对应 bool canXxx 属性及 NOTIFY；缺失方法、守卫或视图映射产生开发诊断并在装配测试中失败。按钮、快捷键共用 ActionBinding，ViewModel 和会话仍检查业务前置条件，不能只靠按钮禁用。

QML 根和每个业务 View 只接收一个明确类型的 viewModel。父 View 使用 ViewHost 将其子 VM 装配成 View，不转发一组分数、条件及业务信号；纯样式、按钮及格子 delegate 无需独立业务 VM。ViewModel 不持有 QML Item、按钮或窗口引用。

### 3.2 规则、会话与计时

| 能力 | 目标入口或依赖 | 契约 |
| --- | --- | --- |
| 规则 | SnakeGame.initialize / clear / requestDirection / step / snapshot | 普通 C++，值快照，不访问 Qt 或真实时间 |
| 用例 | GameSessionService | 管理 Ready/Running/Paused/GameOver/Won、难度、暂停原因与终局结算 |
| 下一步调度 | ITickSource.arm(delayMs) / disarm / timeout | 可替换单次依赖；一次超时一步，取消/替换后旧调度失效 |
| 设置管理 | SettingsService | 唯一内存记录、业务校验、最高分计算与精确通知，不提供界面提示 |
| 存储读写 | ISettingsStore.load / save | 普通 C++ 接口；不持有应用缓存、不计算最高分、不发布变化通知 |

QtTickSource 使用单次 QTimer、Qt::PreciseTimer；超时先清除 armed，再在 GUI 线程同步通知会话。开始、继续和合法移动完成后安排完整间隔；暂停、重开、返回、终局取消旧调度。不累计时间差，不追赶积压。测试用 ManualTickSource 手动触发。[QTimer 官方说明](https://doc.qt.io/qt-6.8/qtimer.html)

核心持有 RandomIndex 函数：输入非空空格集合大小 n，返回 [0,n) 索引。生产 lambda 按值持有已播种的 mt19937 和均匀分布；测试提供固定序列。按行优先枚举空格，满格直接胜利且不调用随机函数。

### 3.3 设置服务、存储与精确通知

SettingsService 是 QObject 应用服务，借用 ISettingsStore，唯一持有 SettingsRecord、启动加载标记和内部未保存标记。它不注册为 QML 服务；ViewModel 只读取与订阅，合法设置修改和终局成绩更新仍由会话发起。DI 将同一个 SettingsService 直接注入 Difficulty、GameStatus、Result；Shell/Home/Game 的构造函数不再接收或转交该服务，只接收自身直接使用的服务与所需子 VM。

| 边界 | 职责 | 公开能力 |
| --- | --- | --- |
| SettingsService | 默认值、业务校验、唯一内存记录、最高分取 max、保存组织与变化通知 | load、records、selectedDifficulty、highScore、setSelectedDifficulty、recordScore，以及两类精确信号 |
| ISettingsStore | 加载可解码字段、保存完整记录 | SettingsLoadResult load、bool save；无应用缓存、业务修改方法或通知 |
| QSettingsStore | 类型解码、序列化、QSettings 身份/键名与实际读写 | 生产和隔离 INI 两种构造；每次操作创建局部 QSettings |

QSettingsStore 使用 NativeFormat、UserScope，固定身份 soapgu / QtSnakeLab，关闭组织及系统级回退。启动由 SettingsService.load 调用存储读取，完成内存初始化后再创建会话和展示层。[QSettings 官方说明](https://doc.qt.io/qt-6.8/qsettings.html)

| 键 | 持久化有效值 | 服务对缺失或无效值的处理 |
| --- | --- | --- |
| v1/difficulty | easy / normal / hard 字符串 | 使用普通难度 |
| v1/highScores/easy | 0～3970 整数，10 的倍数 | 使用 0 |
| v1/highScores/normal | 同上 | 使用 0 |
| v1/highScores/hard | 同上 | 使用 0 |

存储负责严格解码：缺失或无法解码的字段返回空值，拒绝布尔、小数、非完整整数文本和 int 溢出；难度字符串映射到可选 Difficulty。服务负责业务范围与10分倍数校验，合法字段保留，无效字段独立恢复默认。读取失败仍返回已取得的字段及失败标记，服务使用合法值和默认值继续初始化。首次 load 使用同样的变化判定，重复 load 不覆盖运行记录；加载不主动写盘。

服务先完整提交内存记录，再完成必要保存尝试并发送变化通知，保存失败不回滚内存、不抑制真实数据通知。合法选择难度均尝试全量保存；成绩只在提高最高分或有未保存数据时保存。失败由服务保留内部未保存标记，下一次正常选择难度或终局成绩更新重试完整缓存；成功清除标记。存储仅写四个键并保留其他键，sync 后检查 status，不长期复用错误 QSettings 实例。

| 变化 | 服务信号 | 观察者的处理 |
| --- | --- | --- |
| 所选难度实际改变 | selectedDifficultyChanged() | Difficulty 更新选择、名称、间隔及所选最高分 |
| 某档最高分提高 | highScoreChanged(difficulty) | Difficulty 更新该档最高分；匹配所选难度时更新所选最高分 |
| 当前展示难度最高分提高 | 同上，按难度过滤 | GameStatus 只更新匹配难度的最高分 |
| 当前终局难度最高分提高 | 同上，按终局与难度过滤 | Result 仅在终局且难度匹配时更新最高分 |
| 重复选择、未提高成绩或纯保存重试 | 无数据变化信号 | 不触发额外展示同步 |

服务不提供 recordsChanged 聚合通知；初始化加载时最高分实际改变也使用 highScoreChanged。会话变化仍通过 sessionChanged，同步 GameStatus/Result 的本局信息；设置信号只同步相关设置属性。同档选择和保存重试没有会话事实变化，不发 sessionChanged。所有通知发出前完整记录已提交，观察者读取其他字段也得到新记录。

服务修改方法的 bool 表示业务请求是否接受，存储 save 的 bool 表示写盘是否成功。读取/修复/保存异常仅内部诊断，无产品提示、故障模拟入口、后台重试或通用事件体系。未结束本局重开、返回或退出不结算，不保存进行中棋盘，不承诺多进程记录合并。

### 3.4 类型注册、组合根与生命周期

QtSnakeLab 1.0 模块使用 qt_add_qml_module 显式登记源码和 QML 文件。业务 ViewModel、模型与基类使用 QML_ELEMENT / QML_UNCREATABLE；GameEnums 暴露领域枚举，核心保持无 Qt 依赖。ViewRegistry 是引擎持有的只读单例，ActionBinding 为可创建的声明式绑定类型。[C++ 属性与方法暴露](https://doc.qt.io/qt-6.8/qtqml-cppintegration-exposecppattributes.html)

ViewRegistry 固定登记九对 View/VM，不让业务 VM 保存 qrc 地址。组合根通过同一注册表定位 ShellView，在加载前用 setInitialProperties 注入 viewModel: ShellViewModel。ViewHost 使用 Loader.setSource(url, {viewModel: model})，在创建前满足 required 属性；空 model 清空 View。加载失败明确诊断，不静默回退。[Loader 初始属性](https://doc.qt.io/qt-6.8/qml-qtquick-loader.html)

组合根用 RAII 依次创建存储、SettingsService 并 load、计时源、会话、DialogService、GameViewModelFactory、ShellViewModel 和 QML 引擎。入口拥有服务、工厂和根 Shell；Shell 由 `std::unique_ptr` 管理且无 QObject 父对象。启动装配只递归创建 Shell、Home、Difficulty，不提前创建 Game。GameViewModelFactory 为普通 C++ 类型，借用会话、设置及弹窗服务，寿命长于 Shell。

固定使用 [Boost.Ext.DI v1.3.2](https://github.com/boost-ext/di/releases/tag/v1.3.2)，单头文件与 Boost Software License 1.0 随源码保存；以独立 CMake INTERFACE 目标提供头文件，仅应用装配目标和装配测试依赖它，不使领域、应用服务或业务 VM 依赖 DI。文件校验值见源码结构设计4.1，不跟随移动分支，也不在每次构建时下载最新版本。应用装配层用外部 `ctor_traits` 明确列出八个业务 VM 的注入参数，排除 `QObject *parent`，让新对象保持无父状态；构造参数变化时同步更新对应 traits。[构造适配与生命周期策略](https://boost-ext.github.io/di/user_guide.html)

`buildShell` 在局部注入器中将会话、设置、弹窗服务和 Game 工厂绑定为已有实例引用，再调用 `injector.create<std::unique_ptr<ShellViewModel>>()`。工厂每次 `create()` 建立自己的局部注入器，绑定同一批服务并解析 `std::unique_ptr<GameViewModel>`，同时创建 Board、Status、Pause、Result。返回后局部注入器即可销毁；工厂不保存其引用，VM 不获取容器或全局服务定位器。可恢复的工厂创建失败返回空并作开发诊断，缺失接口绑定由编译期装配检查发现。

子 VM 通过按值 `std::unique_ptr<T>` 交接：父对象先验证非空、无既有 parent、同 GUI 线程，成功设置 parent 后 `release()`，随后成员指针仅用于访问，QObject 父子树唯一负责删除。Shell 接管 Home 及成功开始后的 Game，Home 接管 Difficulty；Game 接管 Board/Status，并在内部创建覆盖层 Conductor，由覆盖层接管传入的 Pause/Result。Board 内部创建唯一 BoardCellModel；DialogService 按确认请求动态创建临时 ConfirmAction VM。根 Shell 的 unique_ptr 与子项的 QObject 所有权各有明确边界，同一子 VM 不再由容器或智能指针长期持有。[QObject 对象树](https://doc.qt.io/qt-6.8/objecttrees.html)

进入游戏的顺序为：Home 的 `startGame()` 复核守卫并发 `startRequested()`；Shell 复核 Home.canStartGame、首页仍活动且无当前 Game，以内部开始处理中标记拒绝重复或重入请求；通过工厂创建完整 Game 子树，确认候选无 parent 且同 GUI 线程，连接导航意图并调用 `initialize()`；然后调用仅 C++ 可用的 `GameViewModel::beginSession()`，检查已初始化、Ready、无模态且无待确认操作，执行会话 start。成功后才登记、接管并激活 Game，并清除处理中标记；工厂返回空或开始被拒绝时释放未发布的候选对象、清除标记并保留首页。构造和初始化不自行开始游戏，也不发布半装配页面；Game 激活后刷新已提交会话事实。

返回首页时，Game 先执行成功的 `returnHome()`，停止计时、清理本局并发 `homeRequested()`。Shell 核对请求来自当前 Game，先停用它以禁用交互、停用覆盖层并取消弹窗请求，再切换活动项到 Home；通知 ViewHost 替换旧页面后清空 Game 访问指针，调用 `removeItem()` 取消登记并 `deleteLater()`。待删除对象保持 Shell 父所有权，退出时即使延迟删除尚未执行也会随 Shell 释放；旧信号源或异步结果不得作用于后来创建的 Game。不得在 Game 自身信号或确认回调栈中同步删除它，QML 不保存旧页面或旧 VM 引用。

退出先销毁引擎与 QML，再销毁 Shell 及仍存活或待删除子项、Game 工厂、弹窗服务、会话、计时源、SettingsService、存储；会话析构取消计时。服务与工厂长于所有借用者，普通 C++ 存储与工厂不设 QObject 父对象；顶层 RAII QObject 无父对象，QtTickSource 值成员 QTimer 不设置父对象。暴露给 QML 的 C++ VM/模型统一为 CppOwnership。难度元类型在应用层声明/登记，领域头不依赖 Qt，全部协作在 GUI 线程。

## 4. 游戏操作与数据规则

### 4.1 棋盘、转向与推进

坐标零基，`x` 向右、`y` 向下。初始蛇从头到尾为 `(10,10)`、`(9,10)`、`(8,10)`，方向向右，分数 0；按难度设置 240 / 160 / 100 ms，默认普通。长度每增加一格得 10 分，满格长度 400，最高分数 3970；本局间隔不随得分改变。

每周期相对于已提交方向检查请求；同向、反向、无效枚举和已经存在待转向时拒绝，只有第一次有效请求进入待转向槽。待转向只在下一步消费，暂停保留该请求，继续后在下一步应用；重开或返回清除。方向输入仅在运行且没有确认弹窗时有效。

单步先计算目标头格和是否增长，再检查墙及身体。未增长时身体碰撞检查排除即将腾出的尾格；增长时包含尾格。碰撞只记录失败原因和本步尝试的方向，不把越界或重叠的头格写入蛇，食物、分数和蛇格保持最后合法棋盘。合法移动插入新蛇头，未增长则移除尾部；增长则加分并重新生成食物。吃完最后一个空格后进入胜利，不继续生成食物。未初始化或已终局的核心再次推进不产生变化。

### 4.2 会话状态转换

| 当前状态 | 事件或命令 | 目标状态 | 数据、计时与结算 |
| --- | --- | --- | --- |
| `Ready` | 开始 | `Running` | 从所选难度创建新局，安排完整间隔 |
| `Ready` | 选择难度 | `Ready` | 更新设置；保存结果内部处理，不创建游戏 |
| `Running` | 有效转向 | `Running` | 仅记录核心待转向，计时不重置 |
| `Running` | 超时，移动或吃食物 | `Running` | 更新快照，处理完成后安排下一步 |
| `Running` | 暂停或失焦 | `Paused` | 取消调度，保留快照及待转向，记录暂停原因 |
| `Paused` | 继续，且无待确认操作 | `Running` | 清除暂停原因，重新安排完整间隔 |
| `Running / Paused` | 请求重开或返回 | `Paused` | 运行时先暂停；展示层记录确认操作，不结算 |
| `Paused` 且待确认 | 取消 | `Paused` | 清除确认操作，不自动继续 |
| `Paused` 且待确认 | 确认重开 | `Running` | 清除旧局，新局分数 0，安排完整间隔 |
| `Paused` 且待确认 | 确认返回 | `Ready` | 清理棋盘、结束及暂停原因，不结算 |
| `Running` | 撞墙或撞身体 | `GameOver` | 停止计时，更新本难度最高分，结算一次 |
| `Running` | 填满棋盘 | `Won` | 停止计时，无食物，结算一次 |
| `GameOver / Won` | 再玩一次 | `Running` | 无需确认，以所选难度创建新局 |
| `GameOver / Won` | 返回首页 | `Ready` | 无需确认，清理本局 |

未列出的命令拒绝且无副作用；重复暂停、终局超时或重复结算不改变结果。会话不负责弹窗：低层 `restart()` 和 `returnHome()` 只接受暂停或终局，QML 只能通过 GameViewModel 的请求/确认入口调用。终局先提交完整状态、停止调度并标记已结算，再调用 SettingsService.recordScore；保存错误仍保留终局，不重新结算。

### 4.3 输入与状态更新链路

**开始与返回**：开始按钮 → Home.startGame 发意图 → Shell 经工厂准备 Game → Game.beginSession 执行开始 → 成功后导航。返回用例成功 → Game 发意图 → Shell 切回 Home 并移除 Game → 延迟释放整棵子树；View 加载/卸载不代替业务用例。

1. **转向**：BoardView 识别方向键/WASD → KeyActionBinding 执行 BoardViewModel.turn → 会话检查运行条件 → 核心暂存方向 → 下一次超时提交移动 → BoardCellModel 通知变化格子 → delegate 刷新。
2. **吃食物**：核心增长、加分并放置食物 → 会话发布完整事实 → BoardViewModel 更新投影，GameStatusViewModel 更新统计缓存 → 模型和属性通知驱动绑定；此时不保存最高分。
3. **暂停继续**：ActionBinding 执行 GameViewModel 命令 → 会话停止/重新安排计时 → GameViewModel 将覆盖层 Conductor 的 activeItem 切换到 PauseViewModel 或空 → ViewHost 装配对应 View。
4. **确认**：GameViewModel 请求重开/返回 → 先暂停并锁定交互 → IDialogService 创建 ConfirmActionViewModel → DialogHost 按注册表装配确认 View → 异步结果回到原请求者，确认执行、取消保持暂停。
5. **终局**：核心返回失败/胜利 → 会话停止并结算一次 → SettingsService 更新最高分并尝试保存 → 精确通知相关展示属性 → 展示层读取最终事实 → 覆盖层激活 ResultViewModel。保存失败由服务保留未保存标记并内部处理。

每个 ViewModel 同步其完整缓存后再发必要通知，BoardCellModel 提交全部新格子后再通知。会话先提交完整终局事实并设置结算保护，再更新 SettingsService，因此任何订阅者读到的业务事实都是有效的；同值不重复通知，不创建第二份规则。

## 5. QML 页面与组件

| 页面或组件 | 展示层 | 操作与显示 | 条件与反馈 |
| --- | --- | --- | --- |
| ShellView.qml | ShellViewModel | 根窗口、activeItem 的 ViewHost、DialogHost、窗口活动变化 | 页面切换由 Conductor；失焦操作经 Shell 转发到活动 Game，不自动恢复 |
| HomeView.qml | HomeViewModel | 标题、操作说明、Difficulty 的 ViewHost、开始按钮 | 活动且 Ready、无弹窗才发开始意图；Shell 准备 Game，开始成功后导航 |
| DifficultyView.qml | DifficultyViewModel | 三档选择、所选最高分和间隔 | 父首页活动且 Ready、无弹窗才可选择；保存失败继续显示内存选择 |
| GameView.qml | GameViewModel | Board/Status/overlay 的 ViewHost、操作按钮及空格/Esc 输入 | 操作绑定 canXxx；终局不能暂停，模态期间隔离操作 |
| BoardView.qml | BoardViewModel | 400 格、蛇头方向、蛇身、食物及无障碍说明 | 方向/WASD 转发 turn；仅活动、运行、无模态时有效，忽略自动重复 |
| GameStatusView.qml | GameStatusViewModel | 本局分数、最高分、蛇长、难度、间隔 | 只读共享会话/SettingsService 事实，不扫描棋盘计分 |
| PauseView.qml | PauseViewModel | 暂停原因、继续、重开、返回 | 子 VM 发具名意图，Game 在 C++ 处理；继续才重新安排计时 |
| ResultView.qml | ResultViewModel | 胜负原因、分数、最高分、再玩一次、返回 | 终局直接再玩/返回，不显示放弃确认 |
| ConfirmActionView.qml | ConfirmActionViewModel | 服务提供的标题/说明及确认/取消按钮 | 与游戏会话无依赖；结果仅一次，默认取消焦点，Esc 取消、Tab 循环 |

Game 在请求确认前设内部交互锁，服务忙时操作守卫同样为 false。锁覆盖打开、关闭至异步结果处理的全过程，防止关闭弹窗与执行结果之间穿透快捷键。服务只接受一个弹窗，使用弱请求者检查；请求者失效或取消请求则丢弃回调。取消后保持暂停，服务拒绝请求时清锁并保留暂停。

ViewHost、DialogHost、ActionButton、KeyActionBinding 为通用 QML 支撑，不参与游戏状态判断。ViewHost 只定位、注入和装配；DialogHost 处理模态遮罩、焦点及视觉关闭，不能把确认后程序关闭再次解释为取消。Game 覆盖层选择由 C++ 完成，QML 不用会话枚举决定导航。

BoardView 用 Grid + Repeater，行优先索引对应模型 row/column/cellType。Theme 单例负责颜色与间距。动态属性经 NOTIFY 更新；例如方向请求只暂存，蛇头眼睛要等下一步已提交 direction 通知才更新。

焦点由 View/通用行为处理，View 提供 defaultFocusItem，不回传控件给 VM。开始、继续、重开后到棋盘；暂停/取消确认后到继续按钮；终局到再玩一次；返回到首页开始。Game 的视觉默认焦点采用现有覆盖层的默认项，否则棋盘。窗口失焦不抢焦点；恢复窗口不自动继续。

方向键仅由棋盘识别，空格/Esc 由游戏页在控件处理之后识别；按钮消费的空格不再触发页面暂停，确认框优先消费 Esc。模态遮挡、ActionBinding、VM 守卫共同隔离输入，ViewHost 不靠加载/卸载自行激活 VM。

初始窗口 1280 × 800，验收 800 × 600 和 1280 × 800；宽窗口左右布局，内容宽度小于 700 时上下布局，必要时纵向滚动，不横向溢出。棋盘正方形，覆盖层锚定棋盘，确认位于窗口层。无障碍文本使用中文、一基行列，含分数、蛇长、蛇头和食物位置。

## 6. 实施顺序与验收

1. **工程基础**：创建 CMake、QtSnakeLab 模块及临时静态窗口，登记 Core/Gui/Qml/Quick/QuickControls2 和测试 Test/QuickTest；固定 Boost.Ext.DI v1.3.2、文件校验与独立 INTERFACE 目标，保留第三方许可证；补充 presets、中文项目规则、贡献说明、变更记录、忽略文件、MIT 许可证和基础 CI。**验收**：两平台原生配置、构建、启动、资源加载正常；静态窗口不依赖未实现 VM，只证明工程基础。
2. **规则核心**：实现值类型、SnakeGame、固定随机输入及规则测试。**验收**：初始化、转向限制、移动增长、碰撞保留合法棋盘、尾格腾出、空格选食物、满格胜利及终局重复推进通过；规则库不链接 Qt。
3. **会话与基础设施**：实现单次计时、读写存储、SettingsService 与会话，使用真实设置服务、手动计时和内存存储验证。**验收**：五状态、暂停不推进、恢复完整间隔、取消旧调度、重开/返回清理、终局停止及结算一次通过；存储严格解码、服务缺省/非法数据处理、两类精确通知、同值去重、失败内存保留及下一次正常保存恢复通过，测试不触及用户设置。
4. **展示层、DI 与绑定闭环**：先实现并验证最小 MVVM 支撑的接管/移除接口，完成 Shell/Home/Difficulty/Game/Board/Status/Pause/Result 的构造接口、必要实现和模型，再接入外部 traits、buildShell 与 Game 工厂；实现基本 View。生产装配接入前完成 DialogService 的实际类型与构造，异步确认可先由测试替身验证，产品确认操作仍在下一阶段开放。**验收**：一次初始化、唯一 activeItem、所有权交接、服务身份、局部注入器销毁后引用有效、启动无 Game、首次开始创建完整子树、创建/开始拒绝保留首页、重复开始不重复创建及缺失接口绑定的编译期检查通过；资源映射、单 VM 注入、属性/模型通知与输入闭环通过。
5. **完整交互与动态生命周期**：完善 Pause/Result/Confirm View、DialogService 异步结果、覆盖层映射、模态锁、焦点、样式和无障碍，验证返回首页时移除 Game。**验收**：暂停/结算/再玩不重建 Game，成功返回后先卸载旧页面再延迟释放，所有子项只析构一次，再次开始取得新实例且仍共享同一服务；创建失败、重复点击、旧请求者/旧确认回调失效、QML 无悬挂引用，以及完整操作、键盘、失焦、尺寸和重启记录通过。Result 仅在终局且难度匹配时响应最高分通知；存储异常只用测试替身验证，不加入产品反馈或故障入口。
6. **跨平台交付**：完成 CI、原生 GUI 与分发记录。macOS 使用 .app 和 Qt QML 部署脚本；麒麟使用原生构建目录包，核对 Qt 库、QML 模块、平台插件、qt.conf 和系统依赖，启动脚本仅设置本进程路径。**验收**：脱离构建目录启动，检查架构、资源、键盘/失焦和重启设置；通用 Linux CI 不替代麒麟原生验收。Qt 6.8 部署便捷命令不保证麒麟完整依赖打包。[Qt QML 部署说明](https://doc.qt.io/qt-6.8/qt-generate-deploy-qml-app-script.html)

**契约更新节奏**：每步实施前，在[源码结构设计](贪吃蛇Qt源码结构设计.md)复核方法、通知、前置条件及所有权；实现后对照源码、绑定和测试修订状态。本文管理实施顺序和验收，源码结构设计按类型维护契约。

每步使用独立平台构建目录，核对 Qt/Kit/编译器/架构，执行相关测试与必要回归；C++ 和 QML 测试接入 CTest，涉及界面同时检查真实 GUI。验收记录区分自动验证、实机验证及未验证。

本次仅更新两份设计文档，不创建工程或占位源码。文档核查覆盖正文、接口表、关系图一致性、章节、链接和格式。已有仓库外的临时概念验证覆盖 Boost.Ext.DI v1.3.2、Qt 6.8.3、C++17、macOS arm64 下的静态整树装配、服务身份、QObject 所有权交接、moc/QML 属性、垃圾回收、编译期缺失绑定检查及析构，CTest 1/1 通过且 AddressSanitizer 未报告错误；不代表项目已实现或完成全面泄漏检测。Game 工厂懒加载、动态移除、真实页面与异步确认流程、银河麒麟兼容性，以及项目 Qt 构建、CTest、GUI 和分发验收仍待实施。
