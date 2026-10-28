# 任务栏悬浮条

起因是手柄打到一半断连。摘下来看灯也不亮，去设置里翻：蓝牙和其他设备 → 设备 → 更多蓝牙选项，三四层才看到一个 12%。

Windows 明明知道，就是不摆在你面前。托盘偶尔能显示电量，时灵时不灵，还挑设备。

后来做了个托盘程序，顺手在任务栏上挂一条，把连着的设备电量都摆出来。

![任务栏悬浮条](/blogs/wpf-taskbar/432307edf5b44b6b.png)

## 第一版

做法很直白：无边框透明窗口，`Topmost = true`，自己算坐标盖在任务栏上。

能跑。三个问题。

任务栏自动隐藏，它就悬在半空，下面是壁纸。全屏打游戏时它也不消失，压在画面上。任务栏换位置、改缩放，坐标全得重算。

本来想监听任务栏状态。要监听的东西太多：自动隐藏设置、位置、全屏应用、分辨率、DPI。每样单独处理，还都不准。

## 思路

翻到 Lyricify Lite、TaskbarLyrics，都是在任务栏上放东西的。看代码发现根本没算坐标，是把窗口 `SetParent` 到 `Shell_TrayWnd`。

任务栏本身就是个窗口。变成子窗口之后，隐藏、移动、被全屏盖住，全跟着父窗口走。一行监听不用写。

## 透明

`SetParent` 不难，难的是让它透明。

先试 WinForms 分层窗口，`UpdateLayeredWindow` 返回 87（`ERROR_INVALID_PARAMETER`）。

换 `TransparencyKey`，窗口整个消失，连内容都看不见。

再换 `HwndSource` 加 `UsesPerPixelOpacity`，这回能看见了，但背景纯黑，鼠标也收不到，像贴在任务栏上的一张图。

三条都堵死，花了大半天。

最后用的是最重的那个：完整 WPF `Window`。`AllowsTransparency` 走 DirectComposition，`SetParent` 之后逐像素透明还是有效的。这点反直觉，之前一直以为子窗口和逐像素 alpha 天生互斥。

## 坐标

挂上了，透明了，然后悬浮条跑到屏幕最上面。

`SetWindowPos` 对 `WS_CHILD` 窗口用的是父窗口客户区坐标。我按屏幕坐标算，系统当成"离任务栏左上角一千多像素"。

改起来一行：

```csharp
ScreenToClient(taskbar, ref point);
```

x 从托盘那儿量：`FindWindowEx` 找 `TrayNotifyWnd`，取左边，往左让出自己的宽度，再留 8px。

## 鼠标

透明了，但鼠标移上去没反应。

查半天：alpha 为 0 的像素不参与命中测试。对 WPF 来说那块区域压根不存在。

背景 alpha 设成 `1.0 / 255.0`。肉眼看不出来，命中测试能过。

```csharp
_backgroundBrush.Opacity = 1.0 / 255.0;
```

悬停在 1/255 和 1.0 之间做 170ms `CubicEase`，起手快收尾慢。

不悬停是这样，背景完全是桌面：

![非悬停](blogs/wpf-taskbar/taskbar-overlay-2.png)

移上去，卡片淡入，右边多出刷新按钮：

![悬停](taskbar-overlay-3.png)

按钮按下缩到 0.86，松开回弹同时转一圈。没什么实际用处，但没有这一帧，点着没反馈。

## Explorer 重启

任务栏的子窗口跟着一起死。

WPF `Window` 销毁后状态是已关闭，再 `Show()` 抛异常。不能重新显示，只能重建。

所以另外养一个隐藏窗口，收 `RegisterWindowMessage("TaskbarCreated")` 广播。收到就重建悬浮条，重新挂到新任务栏上。悬浮条自己已经死了，收不到这个消息。

## 零碎

启动时不能直接 `Show()`，得延迟到 `DispatcherPriority.ApplicationIdle`。否则第一次启动不出现，要去菜单里取消勾选再勾一次。

WPF 初始化和布局时会把父窗口关系改回去。所以每次定位前查一遍 `GetParent`，不等于任务栏就重新 `SetParent`。不查的表现是偶尔飘成一个独立窗口，很难复现。

悬停多出刷新按钮，窗口会变宽。尺寸变了要在 `DispatcherPriority.Loaded` 里重新定位，否则卡片从托盘那边溢出去。

主题读注册表 `SystemUsesLightTheme`，配 `SystemEvents.UserPreferenceChanged`。不跟的话，浅色任务栏上白字基本看不见。

## 边界

只处理了底部主任务栏。顶部、侧边、多显示器各一条都没做。副屏那条是另一个窗口类，`Shell_TrayWnd` 只管主屏。

`Shell_TrayWnd` 这个类名没有官方文档。XP 用到现在，稳得离谱，但严格说是能用、微软没保证。

StartAllBack 那类工具改过任务栏结构，兼容性得单独试。

## 后面

想啃 2.4G 接收器。RK 那个 dongle 已经被认出来，但电量走厂商私有协议，得抓包看哪个字节在变。罗技 HID++ 有公开文档，打算先拿它练手。